'use strict';

// 게임 진행 (PRD §3.1, §3.5, F-11~F-28). 방 객체를 직접 바꾸고, 소켓·타이머는 다루지 않는다.
// 실패하면 { error }, 성공하면 { ok: true }를 돌려준다.
const { SKILLS, judge, validateAction, parseAction } = require('./judge');

const MIN_PLAYERS = 2;
const START_KI = 1;

function participants(room) {
  return room.players.filter((p) => p.inGame);
}

function alivePlayers(room) {
  return room.players.filter((p) => p.inGame && p.alive);
}

function allSubmitted(room) {
  return alivePlayers(room).every((p) => p.submitted);
}

// 시작(F-10, F-11)과 새 게임(F-28) 공통. 나간 사람은 빼고, 관전 대기자도 이때 참가한다.
function startGame(room) {
  if (room.status !== 'lobby' && room.status !== 'finished') return { error: '이미 게임이 진행 중입니다.' };
  room.players = room.players.filter((p) => !p.left);
  // 진행만 하는 호스트(playing: false)는 게임에 참가하지 않는다.
  if (room.players.filter((p) => p.playing).length < MIN_PLAYERS) {
    return { error: `참가자가 ${MIN_PLAYERS}명 이상이어야 시작할 수 있습니다.` };
  }
  for (const p of room.players) {
    p.inGame = p.playing;
    p.alive = true;
    p.ki = START_KI;
    p.submitted = false;
    p.action = null;
    p.eliminatedRound = null;
  }
  room.status = 'choosing';
  room.round = 1;
  room.history = [];
  room.lastResult = null;
  room.ranking = null;
  room.revealedAt = null;
  return { ok: true };
}

function toLobby(room) {
  if (room.status !== 'finished') return { error: '게임이 끝난 뒤에 대기실로 돌아갈 수 있습니다.' };
  room.players = room.players.filter((p) => !p.left);
  for (const p of room.players) {
    p.inGame = false;
    p.submitted = false;
    p.action = null;
  }
  room.status = 'lobby';
  room.round = 0;
  room.lastResult = null;
  room.ranking = null;
  return { ok: true };
}

function playerForChoice(room, playerId) {
  if (room.status !== 'choosing') return { error: '지금은 기술을 고를 수 없습니다.' };
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !player.inGame) return { error: '이번 게임의 참가자가 아닙니다.' };
  if (!player.alive) return { error: '아웃된 참가자는 기술을 고를 수 없습니다.' };
  return { player };
}

// F-12~F-14. round를 함께 받아, 이미 끝난 라운드에 대한 늦은 요청을 거부한다.
function submitAction(room, playerId, action, round) {
  if (round !== room.round) return { error: '이미 끝난 라운드입니다.' };
  const { player, error } = playerForChoice(room, playerId);
  if (error) return { error };
  const invalid = validateAction(player, action, alivePlayers(room));
  if (invalid) return { error: invalid };
  // 검증을 통과한 정규화된 값만 저장한다 (원본 요청 객체는 보관하지 않음).
  const { skill, targetId } = parseAction(action).action;
  player.action = { skill, targetId: SKILLS[skill].attack ? targetId : null };
  player.submitted = true;
  return { ok: true };
}

// F-14: 결과 확인 전까지는 결정을 취소하고 다시 고를 수 있다.
function cancelAction(room, playerId, round) {
  if (round !== room.round) return { error: '이미 끝난 라운드입니다.' };
  const { player, error } = playerForChoice(room, playerId);
  if (error) return { error };
  player.action = null;
  player.submitted = false;
  return { ok: true };
}

// 탈락 라운드가 늦을수록 높은 순위. 같은 라운드에 아웃된 사람은 공동 순위 (§3.5, F-27).
function computeRanking(players) {
  const lastRound = (p) => (p.eliminatedRound === null ? Infinity : p.eliminatedRound);
  return [...players]
    .sort((a, b) => lastRound(b) - lastRound(a))
    .map((p) => ({
      playerId: p.id,
      rank: 1 + players.filter((q) => lastRound(q) > lastRound(p)).length,
      eliminatedRound: p.eliminatedRound,
    }));
}

// F-16(결과 확인), F-17(강제 진행). 라운드당 한 번만 판정된다: 판정 후 status가 바뀌므로 두 번째 요청은 거부된다.
function reveal(room, { force = false, now = Date.now() } = {}) {
  if (room.status !== 'choosing') return { error: '이미 결과를 공개했습니다.' };
  if (!force && !allSubmitted(room)) return { error: '아직 선택하지 않은 참가자가 있습니다.' };

  const alive = alivePlayers(room);
  const forced = alive.filter((p) => !p.submitted).map((p) => p.id);
  const actions = {};
  for (const p of alive) if (p.submitted) actions[p.id] = p.action;
  const result = judge(alive.map((p) => ({ id: p.id, ki: p.ki })), actions);

  for (const p of alive) {
    p.ki = result.ki[p.id];
    p.submitted = false;
    p.action = null;
    if (result.eliminated.includes(p.id)) {
      p.alive = false;
      p.eliminatedRound = room.round;
    }
  }

  const survivors = alivePlayers(room);
  const gameOver = survivors.length <= 1;
  room.lastResult = {
    round: room.round,
    revealedAt: now, // 클라이언트가 같은 공개를 두 번 재생하지 않게 구분하는 값
    actions: result.actions,
    attacks: result.attacks,
    eliminated: result.eliminated,
    forced,
    gameOver,
    winnerId: survivors.length === 1 ? survivors[0].id : null,
    draw: survivors.length === 0,
  };
  room.history.push({
    round: room.round,
    actions: result.actions,
    eliminated: result.eliminated,
  });
  if (gameOver) room.ranking = computeRanking(participants(room));
  room.status = 'revealing';
  room.revealedAt = now;
  return { ok: true };
}

// F-21: 공개 연출이 끝난 뒤에만 다음 라운드(또는 게임 종료 화면)로 넘어간다.
function nextRound(room, { now = Date.now(), revealMs = 0 } = {}) {
  if (room.status !== 'revealing') return { error: '지금은 다음 라운드로 넘어갈 수 없습니다.' };
  if (now - room.revealedAt < revealMs) return { error: '결과 공개가 끝난 뒤에 진행할 수 있습니다.' };
  if (room.lastResult.gameOver) {
    room.status = 'finished';
  } else {
    room.status = 'choosing';
    room.round += 1;
  }
  return { ok: true };
}

module.exports = {
  MIN_PLAYERS,
  START_KI,
  participants,
  alivePlayers,
  allSubmitted,
  startGame,
  toLobby,
  submitAction,
  cancelAction,
  reveal,
  nextRound,
  computeRanking,
};
