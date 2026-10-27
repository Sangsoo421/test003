// @ts-check
// PRD §3 게임 룰을 실제 브라우저 여러 개로 플레이해서 확인한다.
// 판정 함수 자체는 tests/judge.test.js(node:test)가 모든 조합을 검사한다.
const { test, expect } = require('./helpers');

async function outNames(page) {
  return (await page.textContent('#summary-out')).trim();
}

test.describe('§3.4 판정 예시 (브라우저 플레이)', () => {
  test('@smoke 예시 1: A 파→B / B 아 → B 아웃', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    const r = await game.round(A, [[A, '파', B], [B, '아']], players);
    expect(r.eliminated).toEqual([B.pid]);
    await expect(B.locator('#summary-out')).toHaveText('OUT: 비이');
    await expect(A.locator('#summary-list')).toContainText('에이: 파 → 비이 — 명중! 아웃');
    // 2명 중 1명이 남았으므로 게임 종료
    expect(r.gameOver).toBe(true);
    expect(r.winnerId).toBe(A.pid);
  });

  test('예시 2·3: 파를 막으면, 서로를 겨눈 파는 상쇄', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    let r = await game.round(A, [[A, '파', B], [B, '막'], [C, '아']], players);
    expect(r.eliminated).toEqual([]);
    expect(r.attacks[0].outcome).toBe('blocked');
    await game.next(A, players);
    // B 기 1, C 기 2 → B 파→C, C 파→B 상쇄
    r = await game.round(A, [[A, '아'], [B, '파', C], [C, '파', B]], players);
    expect(r.eliminated).toEqual([]);
    expect(r.attacks.map((a) => a.outcome)).toEqual(['clash', 'clash']);
    await expect(A.locator('#summary-list')).toContainText('상쇄');
  });

  test('예시 4: A 파→B / B 파→C / C 막 → B 아웃', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const r = await game.round(A, [[A, '파', B], [B, '파', C], [C, '막']], players);
    expect(r.eliminated).toEqual([B.pid]);
    await expect(C.locator('#summary-out')).toHaveText('OUT: 비이');
  });

  test('예시 5: A 에→B / B 파→A → B 아웃, A 생존', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.charge(A, players, players, 2); // 모두 기 3
    const r = await game.round(A, [[A, '에', B], [B, '파', A], [C, '막']], players);
    expect(r.eliminated).toEqual([B.pid]);
    expect(r.attacks.find((a) => a.attackerId === B.pid).outcome).toBe('overpowered');
  });

  test('예시 6·8: 에는 막으로 못 막고, 순으로는 피함', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.charge(A, players, players, 2); // 모두 기 3
    const r = await game.round(A, [[A, '에', B], [B, '막'], [C, '순']], players);
    expect(r.eliminated).toEqual([B.pid]);
    await game.next(A, players);
    // A 기 0, C 기 2 → 기를 다시 모아 A의 에를 C가 순으로 피하는지 확인
    await game.charge(A, [A, C], players, 3); // A 기 3, C 기 5
    const r2 = await game.round(A, [[A, '에', C], [C, '순']], players);
    expect(r2.eliminated).toEqual([]);
    expect(r2.attacks[0].outcome).toBe('dodged');
  });

  test('예시 7: 서로를 겨눈 에는 상쇄', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.charge(A, players, players, 2);
    const r = await game.round(A, [[A, '에', B], [B, '에', A]], players);
    expect(r.eliminated).toEqual([]);
    expect(r.attacks.map((a) => a.outcome)).toEqual(['clash', 'clash']);
  });

  test('예시 9: A 에→B / B 아 / C 파→A → A, B 모두 아웃 (C 승리)', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.charge(A, players, players, 2);
    const r = await game.round(A, [[A, '에', B], [B, '아'], [C, '파', A]], players);
    expect([...r.eliminated].sort()).toEqual([A.pid, B.pid].sort());
    expect(r.winnerId).toBe(C.pid);
  });

  test('@smoke 예시 10: 순파는 순을 아웃, 순파를 쓴 사람은 순파를 피함', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.charge(A, players, players, 1); // 모두 기 2
    const r = await game.round(A, [[A, '순파', B], [B, '순'], [C, '순파', A]], players);
    // A의 순파 → B(순) 명중, C의 순파 → A(순파) 피함
    expect(r.eliminated).toEqual([B.pid]);
    expect(r.attacks.find((a) => a.attackerId === C.pid).outcome).toBe('dodged');
  });

  test('예시 11: 순파 → 아를 쓴 대상은 아무 일 없음', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.charge(A, players, players, 1);
    const r = await game.round(A, [[A, '순파', B], [B, '아']], players);
    expect(r.eliminated).toEqual([]);
    expect(r.attacks[0].outcome).toBe('no_effect');
    await expect(A.locator('#summary-list')).toContainText('효과 없음');
  });

  test('예시 12: 서로를 겨눈 순파는 상쇄', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.charge(A, players, players, 1);
    const r = await game.round(A, [[A, '순파', B], [B, '순파', A]], players);
    expect(r.eliminated).toEqual([]);
    expect(r.attacks.map((a) => a.outcome)).toEqual(['clash', 'clash']);
  });
});

test.describe('§3.2 기 규칙 (브라우저)', () => {
  test("'아'로 얻은 기는 판정 후에 더해지고, 막힌 공격도 기를 소모", async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    expect(await A.ki()).toBe(1);
    // 기 1로 에(3)·순파(2)는 못 쓴다
    await expect(A.locator('.skill-btn[data-skill="에"]')).toBeDisabled();
    await expect(A.locator('.skill-btn[data-skill="순파"]')).toBeDisabled();
    await game.round(A, [[A, '파', B], [B, '막']], players);
    await game.next(A, players);
    expect(await A.ki()).toBe(0); // 막혔어도 소모
    expect(await B.ki()).toBe(1);
    await expect(A.locator('.skill-btn[data-skill="파"]')).toBeDisabled();
    await expect(A.locator('.skill-btn[data-skill="파"]')).toContainText('기 1개 필요');
    await game.round(A, [[A, '아'], [B, '아']], players);
    await game.next(A, players);
    expect(await A.ki()).toBe(1);
    expect(await B.ki()).toBe(2);
  });

  test('공격자가 같은 라운드에 아웃돼도 그 공격은 유효', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const r = await game.round(A, [[A, '파', B], [B, '아'], [C, '파', A]], players);
    expect([...r.eliminated].sort()).toEqual([A.pid, B.pid].sort());
  });

  test('§3.5 전원 동시 아웃이면 무승부, 공동 순위', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const r = await game.round(A, [[A, '파', B], [B, '파', C], [C, '파', A]], players);
    expect(r.draw).toBe(true);
    await game.next(A, players, 'screen-end');
    await expect(B.locator('#end-title')).toHaveText('무승부');
    await expect(B.locator('#ranking-list .rank')).toHaveText(['🥇 1위', '🥇 1위', '🥇 1위']);
  });
});
