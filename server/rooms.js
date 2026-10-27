'use strict';

// 방·플레이어 상태 관리. 데이터 모델은 PRD §6을 따른다.
const crypto = require('node:crypto');

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 방 코드 문자 집합
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const NICKNAME_MAX = 10;
const AVATAR_COUNT = 20;
const MAX_PLAYERS = 8;

const rooms = new Map();

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

function avatarIds() {
  return Array.from({ length: AVATAR_COUNT }, (_, i) => `char-${String(i + 1).padStart(2, '0')}`);
}

// 앞뒤 공백을 지우고, 글자 수는 이모지도 1자로 센다.
function normalizeNickname(nickname) {
  return typeof nickname === 'string' ? nickname.normalize('NFC').trim() : '';
}

function nicknameKey(nickname) {
  return normalizeNickname(nickname).toLowerCase();
}

// 플레이어 식별은 두 가지로 나눈다 (F-15).
// - secret: 브라우저가 localStorage에 보관하고 접속할 때만 보내는 비밀 값. 서버 밖으로 절대 내보내지 않는다.
// - id: 서버가 만든 공개 ID. 다른 참가자에게 보내고 공격 대상 지정 등에 쓴다. 이것만으로는 접속할 수 없다.
function newPublicId() {
  return `p${crypto.randomBytes(8).toString('hex')}`;
}

function createRoom(creatorSecret) {
  const room = {
    code: generateCode(),
    hostId: null, // 호스트의 공개 ID. 방을 만든 사람이 입장하면 정해진다.
    creatorSecret, // 방을 만든 사람의 비밀 값 (입장 전 호스트 판별용, 밖으로 보내지 않음)
    status: 'lobby', // "lobby" | "choosing" | "revealing" | "finished"
    round: 0,
    players: [], // 입장 순서대로. F-29 호스트 승계에 쓴다.
    history: [],
    lastResult: null,
    ranking: null,
    revealedAt: null,
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(normalizeCode(code)) || null;
}

function count() {
  return rooms.size;
}

function deleteRoom(code) {
  rooms.delete(code);
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function findPlayerBySecret(room, secret) {
  if (typeof secret !== 'string' || !secret) return null;
  return room.players.find((p) => p.secret === secret) || null;
}

function takenAvatars(room) {
  return room.players.filter((p) => p.avatarId).map((p) => p.avatarId);
}

// 게임에 참가하는 사람 (진행만 하는 호스트는 빼고 센다)
function playingPlayers(room) {
  return room.players.filter((p) => p.playing);
}

function isFull(room) {
  return playingPlayers(room).length >= MAX_PLAYERS;
}

// F-03(닉네임), F-04(캐릭터), 최대 인원, F-05(게임 중 입장은 관전 대기)
// playing이 false면 게임에는 참가하지 않고 진행만 하는 호스트다. 캐릭터를 고르지 않고 인원에도 세지 않는다.
function addPlayer(room, { secret, nickname, avatarId, playing = true, id = newPublicId() }) {
  const name = normalizeNickname(nickname);
  const length = [...name].length;
  if (length < 1 || length > NICKNAME_MAX) {
    return { error: `닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.` };
  }
  if (playing && isFull(room)) {
    return { error: `방이 가득 찼습니다. (최대 ${MAX_PLAYERS}명)` };
  }
  if (room.players.some((p) => nicknameKey(p.nickname) === nicknameKey(name))) {
    return { error: '이미 이 방에서 쓰고 있는 닉네임입니다.' };
  }
  if (playing && !avatarIds().includes(avatarId)) {
    return { error: '캐릭터를 골라 주세요.' };
  }
  if (playing && takenAvatars(room).includes(avatarId)) {
    return { error: '다른 참가자가 먼저 고른 캐릭터입니다. 다른 캐릭터를 골라 주세요.' };
  }
  const player = {
    id,
    secret, // 비밀 값. publicState는 이 필드를 내보내지 않는다.
    nickname: name,
    avatarId: playing ? avatarId : null,
    playing: Boolean(playing), // false: 진행만 하는 호스트 (게임에 참가하지 않음)
    ki: 0,
    alive: true,
    connected: true,
    submitted: false,
    action: null, // { skill, targetId } — 공개 전에는 서버만 보관
    inGame: false, // 이번 게임 참가 여부. false면 대기실 또는 관전 대기
    eliminatedRound: null,
    left: false, // 끊긴 채 유예 시간이 지나 "나간 것"으로 처리됨
  };
  room.players.push(player);
  return { player };
}

function removePlayer(room, playerId) {
  room.players = room.players.filter((p) => p.id !== playerId);
}

// F-29: 가장 먼저 입장한 참가자(연결된 사람 우선)에게 호스트를 넘긴다.
// 진행만 하던 호스트가 나가도 게임에 참가하는 사람이 이어받는다.
function transferHost(room, leavingId) {
  const others = room.players.filter((p) => p.id !== leavingId && !p.left && p.playing);
  const next = others.find((p) => p.connected) || others[0];
  if (next) room.hostId = next.id;
  return next || null;
}

// 받는 사람별로 걸러서 보내는 상태. 이번 라운드의 다른 사람 선택(action)은 절대 포함하지 않는다 (F-15).
// 본인의 선택만 myAction으로 돌려줘 재접속 때 복구한다 (F-06).
// viewerId는 받는 사람의 공개 ID. 플레이어 필드는 허용 목록으로만 복사해 secret·action이 섞여 나가지 않게 한다.
function publicState(room, viewerId, extra = {}) {
  const me = findPlayer(room, viewerId);
  const showResult = room.status === 'revealing' || room.status === 'finished';
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    round: room.round,
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatarId: p.avatarId,
      playing: p.playing,
      ki: p.ki,
      alive: p.alive,
      connected: p.connected,
      submitted: p.submitted,
      inGame: p.inGame,
      eliminatedRound: p.eliminatedRound,
    })),
    myAction: me && room.status === 'choosing' && me.action ? { skill: me.action.skill, targetId: me.action.targetId } : null,
    lastResult: showResult ? room.lastResult : null,
    ranking: room.status === 'finished' ? room.ranking : null,
    you: me ? me.id : null,
    isHost: Boolean(me) && room.hostId === me.id,
    ...extra,
  };
}

module.exports = {
  CODE_LENGTH,
  NICKNAME_MAX,
  MAX_PLAYERS,
  avatarIds,
  createRoom,
  getRoom,
  count,
  deleteRoom,
  findPlayer,
  findPlayerBySecret,
  takenAvatars,
  playingPlayers,
  isFull,
  addPlayer,
  removePlayer,
  transferHost,
  publicState,
};
