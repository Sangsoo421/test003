// @ts-check
// 호스트가 게임에 참가하지 않고 진행만 하기
const { test, expect } = require('./helpers');

test.describe('진행만 하는 호스트', () => {
  test('@smoke 방을 만든 사람은 캐릭터 없이 진행만 하고, 참가자 2명으로 게임이 끝까지 진행됨', async ({ game }) => {
    const host = await game.player('진행자');
    await host.goto(`${game.base}/`);
    await host.click('#btn-create');
    await host.waitForURL(/\/room\/[A-Z0-9]+$/);
    const code = host.url().split('/').pop();
    await host.waitScreen('screen-join');
    await expect(host.locator('#host-only-option')).toBeVisible();
    await host.fill('#input-nickname', '진행자');
    await host.check('#input-host-only');
    await expect(host.locator('#avatar-fieldset')).toBeHidden();
    await host.click('#btn-join');
    // 처음 입장하면 룰 안내가 먼저 뜬다 (F-08).
    await host.locator('#app > .screen:not([hidden]):not(#screen-join)').waitFor();
    await host.closeRulesIfShown();
    await host.waitScreen('screen-lobby');
    await expect(host.locator('#lobby-players')).toContainText('🎙️ 진행만');
    await expect(host.locator('#lobby-count')).toHaveText('참가자 0명 / 최대 8명');

    // 다른 사람에게는 진행만 하기가 보이지 않고, 억지로 보내도 거부된다.
    const A = await game.player('에이');
    await A.goto(`${game.base}/room/${code}`);
    await A.waitScreen('screen-join');
    await expect(A.locator('#host-only-option')).toBeHidden();
    const rejected = await A.emitAck('room:join', { code, nickname: '몰래', avatarId: null, hostOnly: true });
    expect(rejected.ok).toBe(false);
    await A.joinForm('에이', 0);
    await expect(host.locator('#btn-start')).toBeDisabled(); // 참가자 1명
    const B = await game.player('비이');
    await B.join(code, '비이', 1);
    await expect(host.locator('#lobby-count')).toHaveText('참가자 2명 / 최대 8명');
    await expect(host.locator('#btn-start')).toBeEnabled();

    const everyone = [host, A, B];
    await game.start(everyone);
    await expect(host.locator('#host-only-notice')).toBeVisible();
    await expect(host.locator('#choice-area')).toBeHidden();
    await expect(host.locator('.my-ki')).toBeHidden();
    await expect(host.locator('#btn-reveal')).toBeDisabled();
    // 진행자는 공격 대상에 없다
    await A.click('.skill-btn[data-skill="파"]');
    await expect(A.locator('.target-btn')).toHaveCount(1);

    await game.round(host, [[A, '파', B], [B, '아']], everyone);
    const r = await host.evaluate(() => state.room.lastResult);
    expect(r.actions.map((a) => a.playerId)).not.toContain(host.pid);
    await game.next(host, everyone, 'screen-end');
    await expect(host.locator('#end-winner')).toContainText('에이 승리!');
    await expect(host.locator('#ranking-list li')).toHaveCount(2);
    await expect(host.locator('#btn-new-game')).toBeEnabled();
  });
});
