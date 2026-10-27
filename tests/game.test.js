'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rooms = require('../server/rooms');
const game = require('../server/game');

function makeRoom(names = ['A', 'B', 'C']) {
  const room = rooms.createRoom(names[0]);
  names.forEach((id, i) => {
    const { error } = rooms.addPlayer(room, { id, nickname: `닉${id}`, avatarId: rooms.avatarIds()[i] });
    assert.equal(error, undefined);
  });
  return room;
}

function player(room, id) {
  return rooms.findPlayer(room, id);
}

function submit(room, id, skill, targetId = null) {
  return game.submitAction(room, id, { skill, targetId }, room.round);
}

// ---------- 입장 (F-03, F-04, 최대 인원) ----------
test('닉네임: 빈 값·공백만·11자 거부, 1자·10자 통과, 앞뒤 공백 제거', () => {
  const room = rooms.createRoom('h');
  const ids = rooms.avatarIds();
  assert.ok(rooms.addPlayer(room, { id: 'p1', nickname: '', avatarId: ids[0] }).error);
  assert.ok(rooms.addPlayer(room, { id: 'p1', nickname: '   ', avatarId: ids[0] }).error);
  assert.ok(rooms.addPlayer(room, { id: 'p1', nickname: '가나다라마바사아자차카', avatarId: ids[0] }).error);
  assert.equal(rooms.addPlayer(room, { id: 'p1', nickname: '가', avatarId: ids[0] }).player.nickname, '가');
  assert.ok(rooms.addPlayer(room, { id: 'p2', nickname: '  가나다라마바사아자차  ', avatarId: ids[1] }).player);
  assert.equal(player(room, 'p2').nickname, '가나다라마바사아자차');
});

test('닉네임 중복(대소문자 무시)과 캐릭터 중복 거부', () => {
  const room = rooms.createRoom('h');
  const ids = rooms.avatarIds();
  rooms.addPlayer(room, { id: 'p1', nickname: 'Goku', avatarId: ids[0] });
  assert.ok(rooms.addPlayer(room, { id: 'p2', nickname: 'goku', avatarId: ids[1] }).error);
  assert.ok(rooms.addPlayer(room, { id: 'p2', nickname: '다른이름', avatarId: ids[0] }).error);
  assert.ok(rooms.addPlayer(room, { id: 'p2', nickname: '다른이름', avatarId: 'char-99' }).error);
});

test('최대 8명, 9번째는 거부', () => {
  const room = makeRoom(['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.match(rooms.addPlayer(room, { id: '9', nickname: '아홉', avatarId: rooms.avatarIds()[9] }).error, /가득/);
});

test('게임 중에 들어온 사람은 관전 대기, 새 게임부터 참가 (F-05, F-28)', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  rooms.addPlayer(room, { id: 'C', nickname: '늦은이', avatarId: rooms.avatarIds()[5] });
  assert.equal(player(room, 'C').inGame, false);
  assert.ok(submit(room, 'C', '아').error);
  assert.ok(submit(room, 'A', '파', 'C').error, '관전자는 공격 대상이 아님');
  submit(room, 'A', '파', 'B');
  submit(room, 'B', '아');
  game.reveal(room);
  game.nextRound(room);
  assert.equal(room.status, 'finished');
  game.startGame(room);
  assert.equal(player(room, 'C').inGame, true);
});

// ---------- 시작 (F-10, F-11) ----------
test('참가자 2명 이상일 때만 시작, 모두 기 1개·생존으로 1라운드', () => {
  const solo = makeRoom(['A']);
  assert.ok(game.startGame(solo).error);
  const room = makeRoom(['A', 'B']);
  assert.ok(game.startGame(room).ok);
  assert.equal(room.status, 'choosing');
  assert.equal(room.round, 1);
  for (const p of room.players) {
    assert.equal(p.ki, 1);
    assert.equal(p.alive, true);
  }
  assert.ok(game.startGame(room).error, '진행 중에는 다시 시작 불가');
});

// ---------- 선택 (F-12~F-14) ----------
test('기 부족, 자기 자신·없는 대상, 끝난 라운드에 대한 선택 거부', () => {
  const room = makeRoom();
  game.startGame(room);
  assert.ok(submit(room, 'A', '에', 'B').error);
  assert.ok(submit(room, 'A', '파', 'A').error);
  assert.ok(submit(room, 'A', '파', 'Z').error);
  assert.ok(game.submitAction(room, 'A', { skill: '아' }, room.round - 1).error);
  assert.ok(submit(room, 'Z', '아').error, '방에 없는 사람');
});

test('결정 후 바꾸면 바뀐 선택으로 판정 (F-14)', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  assert.ok(game.cancelAction(room, 'A', room.round).ok);
  assert.equal(player(room, 'A').submitted, false);
  submit(room, 'A', '아');
  submit(room, 'B', '아');
  game.reveal(room);
  assert.deepEqual(room.lastResult.eliminated, []);
  assert.equal(player(room, 'A').ki, 2);
});

test('모든 생존자가 선택해야 결과 확인 가능 (F-16), 판정은 라운드당 한 번', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '아');
  submit(room, 'B', '아');
  assert.equal(game.allSubmitted(room), false);
  assert.ok(game.reveal(room).error);
  submit(room, 'C', '아');
  assert.ok(game.reveal(room).ok);
  assert.ok(game.reveal(room).error);
  assert.ok(game.reveal(room, { force: true }).error);
  assert.equal(room.history.length, 1);
  assert.equal(player(room, 'A').ki, 2);
});

test('강제 진행: 선택하지 않은 생존자는 막 (F-17)', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  assert.ok(game.reveal(room, { force: true }).ok);
  assert.deepEqual(room.lastResult.forced, ['B', 'C']);
  assert.deepEqual(room.lastResult.eliminated, []);
  assert.equal(room.lastResult.attacks[0].outcome, 'blocked');
});

test('아웃된 사람은 선택할 수 없고 공격 대상도 아님 (F-26)', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  submit(room, 'B', '아');
  submit(room, 'C', '아');
  game.reveal(room);
  game.nextRound(room);
  assert.equal(player(room, 'B').alive, false);
  assert.ok(submit(room, 'B', '아').error);
  assert.ok(submit(room, 'C', '파', 'B').error);
  assert.equal(game.alivePlayers(room).length, 2);
});

// ---------- 공개와 진행 (F-21) ----------
test('공개 연출 시간이 지나야 다음 라운드', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  submit(room, 'A', '아');
  submit(room, 'B', '아');
  game.reveal(room, { now: 1000 });
  assert.ok(game.nextRound(room, { now: 2000, revealMs: 4500 }).error);
  assert.ok(game.nextRound(room, { now: 5500, revealMs: 4500 }).ok);
  assert.equal(room.round, 2);
  assert.equal(room.status, 'choosing');
  assert.equal(player(room, 'A').submitted, false);
});

// ---------- 게임 종료 (§3.5, F-27) ----------
test('승리: 마지막 1명, 탈락 순서대로 순위', () => {
  const room = makeRoom();
  game.startGame(room);
  // 1라운드: A가 C를 아웃
  submit(room, 'A', '파', 'C');
  submit(room, 'B', '아');
  submit(room, 'C', '아');
  game.reveal(room);
  assert.equal(room.lastResult.gameOver, false);
  game.nextRound(room);
  // 2라운드: B가 A를 아웃
  submit(room, 'A', '아');
  submit(room, 'B', '파', 'A');
  game.reveal(room);
  assert.equal(room.lastResult.gameOver, true);
  assert.equal(room.lastResult.winnerId, 'B');
  assert.deepEqual(
    room.ranking.map((r) => [r.playerId, r.rank]),
    [['B', 1], ['A', 2], ['C', 3]],
  );
  game.nextRound(room);
  assert.equal(room.status, 'finished');
});

test('무승부: 전원 동시 아웃이면 공동 순위', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  submit(room, 'B', '파', 'C');
  submit(room, 'C', '파', 'A');
  game.reveal(room);
  assert.equal(room.lastResult.draw, true);
  assert.equal(room.lastResult.winnerId, null);
  assert.deepEqual(room.ranking.map((r) => r.rank), [1, 1, 1]);
});

test('같은 라운드에 아웃된 사람은 공동 순위 (경쟁 순위 1, 2, 2, 4)', () => {
  const ranking = game.computeRanking([
    { id: 'W', eliminatedRound: null },
    { id: 'X', eliminatedRound: 3 },
    { id: 'Y', eliminatedRound: 3 },
    { id: 'Z', eliminatedRound: 1 },
  ]);
  assert.deepEqual(ranking.map((r) => [r.playerId, r.rank]), [['W', 1], ['X', 2], ['Y', 2], ['Z', 4]]);
});

test('새 게임: 모두 생존·기 1개로 초기화, 나간 사람은 제외 (F-28)', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  submit(room, 'B', '아');
  submit(room, 'C', '파', 'A');
  game.reveal(room);
  game.nextRound(room);
  player(room, 'C').left = true;
  assert.ok(game.startGame(room).ok);
  assert.deepEqual(room.players.map((p) => p.id), ['A', 'B']);
  for (const p of room.players) {
    assert.equal(p.alive, true);
    assert.equal(p.ki, 1);
    assert.equal(p.eliminatedRound, null);
  }
  assert.equal(room.history.length, 0);
});

test('게임 종료 후 대기실로', () => {
  const room = makeRoom(['A', 'B']);
  assert.ok(game.toLobby(room).error);
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  submit(room, 'B', '아');
  game.reveal(room);
  game.nextRound(room);
  assert.ok(game.toLobby(room).ok);
  assert.equal(room.status, 'lobby');
});

// ---------- 공정성 (F-15) ----------
test('공개 전 상태에는 다른 사람의 선택이 없고, 본인 선택만 myAction으로', () => {
  const room = makeRoom();
  game.startGame(room);
  submit(room, 'A', '파', 'B');
  const seenByB = rooms.publicState(room, 'B');
  const text = JSON.stringify(seenByB);
  assert.equal(seenByB.myAction, null);
  assert.ok(!text.includes('"skill"'), text);
  assert.equal(seenByB.players.find((p) => p.id === 'A').submitted, true);
  assert.deepEqual(rooms.publicState(room, 'A').myAction, { skill: '파', targetId: 'B' });
});

test('2라운드 선택 중에도 이번 라운드 선택은 보이지 않음', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  submit(room, 'A', '아');
  submit(room, 'B', '아');
  game.reveal(room);
  game.nextRound(room);
  submit(room, 'A', '파', 'B');
  const seenByB = rooms.publicState(room, 'B');
  assert.equal(seenByB.lastResult, null);
  assert.ok(!JSON.stringify(seenByB).includes('"skill"'));
});

// ---------- 호스트 승계 (F-29) ----------
test('호스트 승계: 가장 먼저 입장한 연결된 참가자에게', () => {
  const room = makeRoom(['A', 'B', 'C']);
  player(room, 'B').connected = false;
  rooms.transferHost(room, 'A');
  assert.equal(room.hostId, 'C');
  player(room, 'B').connected = true;
  rooms.transferHost(room, 'C');
  assert.equal(room.hostId, 'A');
});

// ---------- 비공개 값 노출 방지 (F-15) ----------
test('정의되지 않은 기술 제출은 거부되고 기가 망가지지 않음', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  for (const skill of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 7, null]) {
    assert.ok(submit(room, 'A', skill).error, String(skill));
  }
  assert.equal(player(room, 'A').submitted, false);
  submit(room, 'A', '아');
  submit(room, 'B', '아');
  game.reveal(room);
  assert.equal(player(room, 'A').ki, 2);
  game.nextRound(room);
  assert.ok(submit(room, 'A', '에', 'B').error, '기 2로 에는 불가');
});

test('제출한 선택은 정규화된 값만 저장 (원본 객체의 다른 필드는 버림)', () => {
  const room = makeRoom(['A', 'B']);
  game.startGame(room);
  assert.ok(game.submitAction(room, 'A', { skill: ' 파 ', targetId: 'B', extra: 'x' }, 1).ok);
  assert.deepEqual(player(room, 'A').action, { skill: '파', targetId: 'B' });
});

test('비밀 값(secret)은 상태에 절대 실리지 않고, 공개 ID와 다름', () => {
  const room = rooms.createRoom('creator-secret-123456');
  const a = rooms.addPlayer(room, { secret: 'secret-a-1234567890', nickname: '에이', avatarId: 'char-01' }).player;
  const b = rooms.addPlayer(room, { secret: 'secret-b-1234567890', nickname: '비이', avatarId: 'char-02' }).player;
  assert.notEqual(a.id, 'secret-a-1234567890');
  assert.match(a.id, /^p[0-9a-f]{16}$/);
  assert.equal(rooms.findPlayerBySecret(room, 'secret-b-1234567890'), b);
  assert.equal(rooms.findPlayerBySecret(room, b.id), null, '공개 ID로는 자리를 찾을 수 없음');
  room.hostId = a.id;
  game.startGame(room);
  game.submitAction(room, a.id, { skill: '파', targetId: b.id }, 1);
  const text = JSON.stringify(rooms.publicState(room, b.id));
  for (const secret of ['secret-a', 'secret-b', 'creator-secret']) assert.ok(!text.includes(secret), secret);
  assert.ok(!text.includes('"skill"'));
  const forB = rooms.publicState(room, b.id);
  assert.equal(forB.you, b.id);
  assert.equal(forB.isHost, false);
  assert.equal(rooms.publicState(room, a.id).isHost, true);
  assert.equal(rooms.publicState(room, null).you, null);
});

test('진행만 하는 호스트: 캐릭터 없이 입장, 인원·게임에 포함되지 않음', () => {
  const room = rooms.createRoom('creator-secret-123');
  const host = rooms.addPlayer(room, { secret: 'creator-secret-123', nickname: '진행자', avatarId: null, playing: false }).player;
  assert.equal(host.avatarId, null);
  assert.equal(host.playing, false);
  room.hostId = host.id;
  rooms.addPlayer(room, { id: 'a', nickname: '에이', avatarId: 'char-01' });
  assert.match(game.startGame(room).error, /2명 이상/);
  rooms.addPlayer(room, { id: 'b', nickname: '비이', avatarId: 'char-02' });
  for (let i = 2; i < rooms.MAX_PLAYERS; i++) {
    assert.ok(rooms.addPlayer(room, { id: `x${i}`, nickname: `닉${i}`, avatarId: rooms.avatarIds()[i] }).player);
  }
  assert.equal(rooms.isFull(room), true);
  assert.deepEqual(rooms.takenAvatars(room).includes(null), false);

  assert.ok(game.startGame(room).ok);
  assert.equal(host.inGame, false);
  assert.equal(game.participants(room).length, rooms.MAX_PLAYERS);
  assert.ok(game.submitAction(room, host.id, { skill: '아', targetId: null }, 1).error);
  // 진행자를 공격 대상으로 지정할 수 없음
  assert.ok(game.submitAction(room, 'a', { skill: '파', targetId: host.id }, 1).error);
  const state = rooms.publicState(room, host.id);
  assert.equal(state.isHost, true);
  assert.equal(state.players.find((p) => p.id === host.id).playing, false);

  // 진행자가 나가면 게임에 참가하는 사람이 호스트를 이어받는다.
  assert.equal(rooms.transferHost(room, host.id).id, 'a');
});
