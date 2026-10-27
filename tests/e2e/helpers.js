// @ts-check
'use strict';

const { test: base, expect } = require('@playwright/test');

const FAST = 'http://localhost:3310'; // 연출 1.2초, 나감 유예 2.5초, 방 정리 3초
const REAL = 'http://localhost:3311'; // 실제 기본값 (연출 4.5초, 유예 30초, 방 정리 30분)
const FAST_TIMING = { revealMs: 1200, graceMs: 2500, ttlMs: 3000 };

const DEVICE_KEYS = ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch'];

const NAMES = ['에이', '비이', '씨이', '디이', '이이', '에프', '지이', '에이치', '아이'];

/**
 * 플레이어 한 명 = 브라우저 컨텍스트 하나 (localStorage, 플레이어 ID가 따로).
 * 모든 페이지의 console error와 pageerror를 모아, 테스트가 끝날 때 하나라도 있으면 실패시킨다.
 */
const test = base.extend({
  game: async ({ browser }, use, testInfo) => {
    const contexts = [];
    const errors = [];
    const deviceOptions = Object.fromEntries(
      Object.entries(testInfo.project.use).filter(([k]) => DEVICE_KEYS.includes(k)),
    );

    const game = {
      base: FAST,
      errors,
      allowErrors: [], // 정규식 목록. 도구가 일으킨 소음만 넣는다.

      async player(name, options = {}) {
        const context = await browser.newContext({ ...deviceOptions, ...options.context });
        contexts.push(context);
        const page = await context.newPage();
        const label = name;
        // 받은 WebSocket 프레임을 접속 전부터 기록 (F-15 검사용)
        page.frames_ = [];
        page.on('websocket', (ws) => ws.on('framereceived', (f) => page.frames_.push({ t: Date.now(), payload: String(f.payload) })));
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
        });
        page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
        return decorate(page, { name, context, base: options.base || game.base });
      },

      // 호스트가 방을 만들고 나머지가 들어온 대기실 상태를 만든다.
      async lobby(count, { base: baseUrl } = {}) {
        const b = baseUrl || game.base;
        const host = await game.player(NAMES[0], { base: b });
        const code = await host.createRoom(NAMES[0], 0);
        const players = [host];
        for (let i = 1; i < count; i++) {
          const p = await game.player(NAMES[i], { base: b });
          await p.join(code, NAMES[i], i);
          players.push(p);
        }
        await expect(host.locator('#lobby-players li')).toHaveCount(count);
        return { code, host, players };
      },

      async start(players) {
        await players[0].click('#btn-start');
        await Promise.all(players.map((p) => p.waitScreen('screen-round')));
      },

      // choices: [[플레이어, 기술, 대상플레이어?], ...] → 결정 → 호스트가 결과 확인 → 모두 요약이 보일 때까지
      async round(host, choices, everyone) {
        for (const [p, skill, target] of choices) await p.choose(skill, target);
        await expect(host.locator('#btn-reveal')).toBeEnabled();
        await host.click('#btn-reveal');
        await Promise.all(everyone.map((p) => p.waitSummary()));
        return host.evaluate(() => state.room.lastResult);
      },

      async next(host, everyone, screen = 'screen-round') {
        await host.click('#btn-next');
        await Promise.all(everyone.map((p) => p.waitScreen(screen)));
      },

      // 모두 '아'를 써서 기를 모으는 라운드
      async charge(host, alivePlayers, everyone, times = 1) {
        for (let i = 0; i < times; i++) {
          await game.round(host, alivePlayers.map((p) => [p, '아']), everyone);
          await game.next(host, everyone);
        }
      },
    };

    await use(game);

    const unexpected = errors.filter((e) => !game.allowErrors.some((re) => re.test(e)));
    for (const c of contexts) await c.close().catch(() => {});
    expect(unexpected, '브라우저 콘솔 에러·페이지 에러가 없어야 함').toEqual([]);
  },
});

function decorate(page, { name, context, base: baseUrl }) {
  return Object.assign(page, {
    playerName: name,
    ctx: context,
    baseUrl,
    pid: '',

    async screenId() {
      return page.locator('#app > .screen:not([hidden])').getAttribute('id');
    },

    async waitScreen(id, timeout = 15_000) {
      await page.locator(`#${id}`).waitFor({ state: 'visible', timeout });
    },

    async waitSummary() {
      await page.locator('#reveal-summary').waitFor({ state: 'visible', timeout: 20_000 });
    },

    async closeRulesIfShown() {
      if (await page.locator('#screen-rules').isVisible()) await page.click('#btn-rules-close');
    },

    async createRoom(nickname, avatarIndex = 0) {
      await page.goto(`${baseUrl}/`);
      await page.click('#btn-create');
      await page.waitForURL(/\/room\/[A-Z0-9]+$/);
      const code = page.url().split('/').pop();
      await page.joinForm(nickname, avatarIndex);
      return code;
    },

    async join(code, nickname, avatarIndex) {
      await page.goto(`${baseUrl}/room/${code}`);
      await page.joinForm(nickname, avatarIndex);
    },

    async joinForm(nickname, avatarIndex) {
      await page.waitScreen('screen-join');
      await page.fill('#input-nickname', nickname);
      await page.click(`#avatar-grid .avatar-option >> nth=${avatarIndex}`);
      await page.click('#btn-join');
      // 처음 입장하면 룰 안내가 자동으로 뜬다 (F-08).
      await page.locator('#app > .screen:not([hidden]):not(#screen-join)').waitFor();
      await page.closeRulesIfShown();
      // 공개 ID (대상 지정·결과 비교용). localStorage의 비밀 값(state.playerId)과는 다르다.
      await page.waitForFunction(() => state.room && state.room.you, null, { polling: 30 });
      page.pid = await page.evaluate(() => state.room.you);
    },

    async choose(skill, target) {
      await page.click(`.skill-btn[data-skill="${skill}"]`);
      if (target) await page.click(`[data-target="${target.pid}"]`);
      await page.click('#btn-decide');
      await page.locator('#btn-change').waitFor({ state: 'visible' });
    },

    // 화면을 거치지 않고 소켓 이벤트를 직접 보낸다 (서버 검증 확인용).
    async emitAck(event, payload) {
      return page.evaluate(
        ([ev, data]) => new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ timeout: true }), 3000);
          const done = (res) => {
            clearTimeout(timer);
            resolve(res);
          };
          if (data === undefined) socket.emit(ev, done);
          else socket.emit(ev, data, done);
        }),
        [event, payload],
      );
    },

    async room() {
      return page.evaluate(() => state.room);
    },

    async ki() {
      return Number(await page.textContent('#my-ki'));
    },
  });
}

module.exports = { test, expect, FAST, REAL, FAST_TIMING, NAMES };
