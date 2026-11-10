// @ts-check
'use strict';

const path = require('node:path');
const { test, expect, REAL } = require('./helpers');

const SHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');

// ---------- 원기옥 '원' ----------
test('원기옥: 기 5개 전에는 잠겨 있고, 쓰면 나머지 전원 아웃 → 승리', async ({ game }) => {
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await game.start(players);
  await expect(A.locator('.skill-btn[data-skill="원"]')).toBeDisabled();
  await expect(A.locator('.skill-btn[data-skill="원"]')).toContainText('기 5개 필요');
  await game.charge(A, players, players, 4); // 기 1 → 5
  await expect(A.locator('.skill-btn[data-skill="원"]')).toBeEnabled();
  await A.click('.skill-btn[data-skill="원"]');
  await expect(A.locator('#target-area')).toBeHidden(); // 대상을 고르지 않음
  await A.click('#btn-decide');
  await B.choose('파', A); // 원기옥에 흡수
  await C.choose('막'); // 막으로도 못 막음
  await A.click('#btn-reveal');
  await Promise.all(players.map((p) => p.waitSummary()));
  const r = await A.evaluate(() => state.room.lastResult);
  expect([...r.eliminated].sort()).toEqual([B.pid, C.pid].sort());
  expect(r.winnerId).toBe(A.pid);
  expect(r.attacks.find((x) => x.attackerId === B.pid).outcome).toBe('absorbed');
  await expect(B.locator('#summary-list')).toContainText('원기옥 발동! 2명 명중');
  await expect(B.locator('#summary-list')).toContainText('원기옥에 흡수');
  await game.next(A, players, 'screen-end');
  await expect(C.locator('#end-title')).toHaveText('승리!');
});

test('원기옥: 두 명이 함께 쓰면 모두 아웃, 무승부', async ({ game }) => {
  const { host: A, players } = await game.lobby(2);
  const [, B] = players;
  await game.start(players);
  await game.charge(A, players, players, 4);
  const r = await game.round(A, [[A, '원'], [B, '원']], players);
  expect(r.draw).toBe(true);
  expect(r.eliminated).toHaveLength(2);
  await game.next(A, players, 'screen-end');
  await expect(B.locator('#end-title')).toHaveText('무승부');
});

test('원기옥: 서버는 기가 모자라거나 대상을 지정한 원기옥을 거부', async ({ game }) => {
  const { host: A, players } = await game.lobby(2);
  await game.start(players);
  const round = (await A.room()).round;
  expect((await A.emitAck('round:submit', { round, skill: '원', targetId: null })).ok).toBe(false);
});

test('원기옥 연출: 금빛 무대·구체·충격 표시가 나오고, 움직임 줄이기에서도 글자는 전달', async ({ game }) => {
  game.base = REAL;
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await C.emulateMedia({ reducedMotion: 'reduce' });
  await game.start(players);
  await game.charge(A, players, players, 4);
  await A.choose('원');
  await B.choose('아');
  await C.choose('순');
  await A.click('#btn-reveal');
  await B.waitForFunction(() => state.reveal.phase === 'skills', null, { polling: 30 });
  await expect(B.locator('#arena')).toHaveClass(/is-genki/);
  await expect(B.locator('#arena-fx .genki-orb')).toHaveCount(1);
  await expect(C.locator('#arena-fx .genki-orb')).toHaveCount(0);
  await C.waitForFunction(() => state.reveal.phase === 'attacks', null, { polling: 30 });
  expect(await C.evaluate(() => document.querySelector('.genki-banner')?.textContent)).toContain('원기옥');
  // 단계가 짧아(0.6초) 상태를 한 번에 읽어 확인한다.
  await C.waitForFunction(() => state.reveal.phase === 'impact', null, { polling: 30 });
  const seen = await C.evaluate(() => ({
    impact: document.getElementById('arena').classList.contains('is-genki-impact'),
    labels: document.querySelectorAll('.impact-genki').length,
    caption: document.getElementById('reveal-caption').textContent,
  }));
  expect(seen).toEqual({ impact: true, labels: 2, caption: expect.stringContaining('원기옥: 전원 명중') });
  await B.waitSummary();
  await C.waitSummary();
});

// ---------- 채팅 (캐릭터 옆 말풍선) ----------
/** viewer 화면에서 speaker의 말풍선이 speaker 캐릭터 바로 위(또는 아래)에 붙어 있는지 */
async function bubbleNextToAvatar(viewer, speaker, scope) {
  const bubble = viewer.locator(`.chat-bubble[data-player="${speaker.pid}"]`);
  await expect(bubble).toBeVisible();
  await expect(bubble).not.toHaveClass(/is-floating/);
  await viewer.waitForTimeout(100); // 다음 프레임에 위치가 정해진다
  const b = await bubble.boundingBox();
  const a = await viewer.locator(`${scope} [data-chat-anchor="${speaker.pid}"]`).first().boundingBox();
  const centerX = a.x + a.width / 2;
  expect(centerX, '말풍선이 캐릭터와 가로로 겹침').toBeGreaterThanOrEqual(b.x - 1);
  expect(centerX).toBeLessThanOrEqual(b.x + b.width + 1);
  const gapAbove = a.y - (b.y + b.height);
  const gapBelow = b.y - (a.y + a.height);
  expect(Math.min(Math.abs(gapAbove - 12), Math.abs(gapBelow - 12)), '캐릭터 바로 위나 아래').toBeLessThan(3);
}

test('@smoke 채팅: 보낸 말이 모두의 화면에서 내 캐릭터 옆 말풍선으로 떴다가 사라짐', async ({ game }) => {
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await expect(A.locator('#btn-chat')).toBeVisible();
  await A.click('#btn-chat');
  await expect(A.locator('#chat-bar')).toBeVisible();
  await A.fill('#input-chat', '안녕 <b>모두</b>');
  await A.press('#input-chat', 'Enter');
  await expect(A.locator('#input-chat')).toHaveValue('');
  // 모두의 화면(보낸 사람 포함)에서 A 캐릭터 옆에
  for (const p of players) await bubbleNextToAvatar(p, A, '#lobby-players');
  await expect(B.locator(`.chat-bubble[data-player="${A.pid}"] .chat-bubble-text`)).toHaveText('안녕 <b>모두</b>'); // 글자 그대로
  await expect(B.locator('#chat-bubbles b')).toHaveCount(0);
  await expect(A.locator('.chat-bubble.is-mine')).toHaveCount(1);
  await expect(B.locator('.chat-bubble.is-mine')).toHaveCount(0);
  // 말풍선은 누르기를 막지 않는다
  expect(await B.locator('#chat-bubbles').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  const overflow = await B.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await B.screenshot({ path: path.join(SHOT_DIR, `chat-lobby-${test.info().project.name}.png`) });
  // 몇 초 뒤 사라진다
  await expect(B.locator('.chat-bubble')).toHaveCount(0, { timeout: 12_000 });

  // 입력줄이 열려 있어도 시작 버튼은 그 위로 올라와 누를 수 있다
  await game.start(players);
  // 게임 중: 상태창의 캐릭터 옆
  await C.click('#btn-chat');
  await C.fill('#input-chat', '파 조심해');
  await C.click('#btn-chat-send');
  await bubbleNextToAvatar(B, C, '#status-panel');
  await B.screenshot({ path: path.join(SHOT_DIR, `chat-round-${test.info().project.name}.png`) });
  // 같은 사람이 다시 말하면 말풍선이 바뀐다 (쌓이지 않음)
  await C.fill('#input-chat', '농담이야');
  await C.press('#input-chat', 'Enter');
  await expect(B.locator(`.chat-bubble[data-player="${C.pid}"]`)).toHaveCount(1);
  await expect(B.locator(`.chat-bubble[data-player="${C.pid}"]`)).toContainText('농담이야');
  // 캐릭터가 안 보이는 화면(룰 안내)에서는 이름을 붙여 띄운다
  await B.click('#btn-rules');
  await expect(B.locator(`.chat-bubble[data-player="${C.pid}"]`)).toHaveClass(/is-floating/);
  await expect(B.locator(`.chat-bubble[data-player="${C.pid}"] .chat-bubble-name`)).toBeVisible();
  await C.click('#btn-chat-close');
  await expect(C.locator('#chat-bar')).toBeHidden();
});

test('채팅: 서버는 빈·너무 긴 메시지, 방 밖 사람, 도배를 거부', async ({ game }) => {
  const { host: A, code } = await game.lobby(2);
  expect((await A.emitAck('chat:send', { text: '   ' })).ok).toBe(false);
  expect((await A.emitAck('chat:send', { text: '​' })).ok).toBe(false);
  expect((await A.emitAck('chat:send', { text: 'x'.repeat(101) })).ok).toBe(false);
  expect((await A.emitAck('chat:send', { text: { toString: 'x' } })).ok).toBe(false);
  for (let i = 0; i < 5; i++) expect((await A.emitAck('chat:send', { text: `m${i}` })).ok).toBe(true);
  expect((await A.emitAck('chat:send', { text: '도배' })).ok).toBe(false);

  // 입장 화면에만 있는 사람(참가 전)은 채팅을 보내지도 받지도 못한다.
  const outsider = await game.player('밖');
  await outsider.goto(`${outsider.baseUrl}/room/${code}`);
  await outsider.waitScreen('screen-join');
  await expect(outsider.locator('#btn-chat')).toBeHidden();
  expect((await outsider.emitAck('chat:send', { text: '몰래' })).ok).toBe(false);
  expect(outsider.frames_.some((f) => f.payload.includes('m0'))).toBe(false);
  await expect(outsider.locator('.chat-bubble')).toHaveCount(0);
});
