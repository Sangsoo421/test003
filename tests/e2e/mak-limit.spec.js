// @ts-check
'use strict';

// v3: '막'은 연속 2번까지만
const path = require('node:path');
const { test, expect } = require('./helpers');

const SHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');

test('@smoke 막 연속 2회: 다음 라운드 막 버튼 잠김·안내, 상태창 막기불가, 서버도 거부, 다른 기술 쓰면 풀림', async ({ game }) => {
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await game.start(players);

  // 1라운드: B 막
  await game.round(A, [[A, '아'], [B, '막'], [C, '아']], players);
  await game.next(A, players);
  await expect(B.locator('.skill-btn[data-skill="막"]')).toBeEnabled();
  await expect(B.locator('.skill-btn[data-skill="막"]')).toContainText('쓰면 다음 턴 막 불가');
  await expect(A.locator('#status-list')).toContainText('🛡️ 막 1회 연속');

  // 2라운드: B 또 막 → 3라운드에는 막 불가
  await game.round(A, [[A, '아'], [B, '막'], [C, '아']], players);
  await game.next(A, players);
  const mak = B.locator('.skill-btn[data-skill="막"]');
  await expect(mak).toBeDisabled();
  await expect(mak).toContainText('연속 2회 사용 (이번 턴 불가)');
  for (const s of ['아', '파', '순']) await expect(B.locator(`.skill-btn[data-skill="${s}"]`)).toBeEnabled();
  // 다른 사람의 상태창에서도 보인다 (심리전용)
  for (const p of [A, C]) {
    const item = p.locator('#status-list .status-item', { hasText: '비이' });
    await expect(item).toContainText('막기불가');
  }
  // A·C는 막을 쓸 수 있다
  await expect(A.locator('.skill-btn[data-skill="막"]')).toBeEnabled();
  await B.screenshot({ path: path.join(SHOT_DIR, `mak-limit-${test.info().project.name}.png`), fullPage: true });

  // 화면을 거치지 않은 요청도 서버가 거부한다
  const round = (await B.room()).round;
  const res = await B.emitAck('round:submit', { round, skill: '막', targetId: null });
  expect(res.ok).toBe(false);
  expect(res.error).toContain('연속 2번');
  expect((await B.room()).players.find((p) => p.id === B.pid).submitted).toBe(false);

  // 공개 연출 중에는 상태창이 판정 전 값(막기불가)을 보여, B가 막을 안 썼다는 것을 미리 드러내지 않는다
  for (const [p, s] of [[A, '아'], [B, '아'], [C, '아']]) await p.choose(s);
  await A.click('#btn-reveal');
  const duringCount = await C.waitForFunction(
    () => state.reveal.phase && state.reveal.phase.startsWith('count') && document.getElementById('status-list').textContent,
    null,
    { polling: 30 },
  );
  expect(await duringCount.jsonValue()).toContain('막기불가');
  await Promise.all(players.map((p) => p.waitSummary()));
  await expect(C.locator('#status-list')).not.toContainText('막기불가'); // 연출이 끝나면 갱신
  await game.next(A, players);
  await expect(B.locator('.skill-btn[data-skill="막"]')).toBeEnabled();
  await expect(A.locator('#status-list .status-item', { hasText: '비이' })).not.toContainText('막');
});

test('막 연속 2회인 참가자를 강제 진행하면 에러 없이 막으로 처리', async ({ game }) => {
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await game.start(players);
  await game.round(A, [[A, '아'], [B, '막'], [C, '아']], players);
  await game.next(A, players);
  await game.round(A, [[A, '아'], [B, '막'], [C, '아']], players);
  await game.next(A, players);
  // B는 고르지 않음 → 호스트가 강제 진행
  await A.choose('파', B);
  await C.choose('아');
  await A.click('#btn-force');
  await A.click('#force-confirm');
  await Promise.all(players.map((p) => p.waitSummary()));
  const r = await A.evaluate(() => state.room.lastResult);
  expect(r.forced).toEqual([B.pid]);
  expect(r.actions.find((a) => a.playerId === B.pid).skill).toBe('막');
  expect(r.eliminated).toEqual([]); // 막으로 처리되어 파를 막음
  await expect(A.locator('#summary-list')).toContainText('선택하지 않아 막 처리');
  await game.next(A, players);
  await expect(B.locator('.skill-btn[data-skill="막"]')).toBeDisabled();
});

test('새 게임을 시작하면 연속 막 횟수가 초기화', async ({ game }) => {
  const { host: A, players } = await game.lobby(2);
  const [, B] = players;
  await game.start(players);
  await game.round(A, [[A, '아'], [B, '막']], players);
  await game.next(A, players);
  await game.round(A, [[A, '아'], [B, '막']], players);
  await game.next(A, players);
  await expect(B.locator('.skill-btn[data-skill="막"]')).toBeDisabled();
  // A가 기 3으로 에 → B는 막으로 못 막음 → 게임 끝
  await game.round(A, [[A, '에', B], [B, '아']], players);
  await game.next(A, players, 'screen-end');
  await A.click('#btn-new-game');
  await Promise.all(players.map((p) => p.waitScreen('screen-round')));
  await expect(B.locator('.skill-btn[data-skill="막"]')).toBeEnabled();
  await expect(A.locator('#status-list')).not.toContainText('막기불가');
});
