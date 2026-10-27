// @ts-check
// UI·반응형·접근성: 화면마다 360 / 768 / 1440px 스크린샷, 가로 스크롤, 44px 터치 영역, axe 검사
const path = require('node:path');
const fs = require('node:fs');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, REAL } = require('./helpers');

const SHOT_DIR = path.join(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const WIDTHS = [360, 768, 1440];

/** 지금 화면을 세 너비로 검사하고 스크린샷을 남긴다. 문제는 issues 배열에 모은다. */
async function audit(page, name, issues, { axe = true } = {}) {
  const original = page.viewportSize();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const small = [...document.querySelectorAll('button, input, select, a')]
        .filter((el) => el.offsetParent !== null && !el.closest('dialog:not([open])'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el, r }) => `${el.id || el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
      const topbar = !!document.querySelector('#btn-music') && document.querySelector('#btn-music').offsetParent !== null
        && document.querySelector('#btn-rules').offsetParent !== null;
      return { overflow, small, topbar };
    });
    if (r.overflow > 0) issues.push(`${name} @${width}px: 가로 스크롤 ${r.overflow}px`);
    if (r.small.length) issues.push(`${name} @${width}px: 44px 미만 ${r.small.join(', ')}`);
    if (!r.topbar) issues.push(`${name} @${width}px: 음악·룰 버튼이 보이지 않음`);
    await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize(original || { width: 360, height: 800 });
  await page.waitForTimeout(100);
  if (axe) {
    const result = await new AxeBuilder({ page }).analyze();
    for (const v of result.violations) {
      issues.push(`${name} axe ${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
    }
  }
}

test.describe('화면별 스크린샷·반응형·접근성', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '스크린샷 세트는 크롬에서만');

  test('S-01 ~ S-04 시작·입장·룰·대기실', async ({ game }) => {
    const issues = [];
    const host = await game.player('호스트');
    await host.goto(`${game.base}/`);
    await audit(host, 'S01-start', issues);
    await host.click('#btn-create');
    await host.waitScreen('screen-join');
    await host.fill('#input-nickname', '번개주먹');
    await host.click('#avatar-grid .avatar-option >> nth=0');
    await audit(host, 'S02-join', issues);
    await host.click('#btn-join');
    await host.waitScreen('screen-rules');
    await audit(host, 'S03-rules', issues);
    await host.click('#btn-rules-close');
    const code = host.url().split('/').pop();
    const others = [];
    for (let i = 1; i < 8; i++) {
      const p = await game.player(`p${i}`);
      await p.join(code, ['노을빛', '가람', '하늬바람', '도담도담', '초롱이', '은빛날개', '열글자닉네임입니다'][i - 1], i * 2);
      others.push(p);
    }
    await expect(host.locator('#lobby-players li')).toHaveCount(8);
    await expect.poll(() => host.evaluate(() => document.getElementById('qr-image').naturalWidth)).toBeGreaterThan(0);
    await audit(host, 'S04-lobby-host-8', issues);
    await audit(others[0], 'S04-lobby-guest-8', issues);
    expect(issues).toEqual([]);
  });

  test('S-05 ~ S-07 라운드·공개·종료 (8명)', async ({ game }) => {
    test.setTimeout(300_000);
    game.base = REAL; // 공개 연출 단계별로 찍기 위해 실제 시간 서버
    const issues = [];
    const { host: A, players } = await game.lobby(8);
    await game.start(players);
    await game.round(A, players.map((p) => [p, '아']), players);
    await game.next(A, players);
    const [, B, C, D, E, F, G, H] = players;
    await B.choose('막');
    await C.choose('순');
    await A.click('.skill-btn[data-skill="파"]');
    await A.click(`[data-target="${D.pid}"]`);
    await audit(A, 'S05-round-choosing', issues);
    await A.click('#btn-decide');
    await A.click('#btn-force');
    await A.locator('#force-dialog').waitFor();
    await audit(A, 'S05-force-dialog', issues);
    await A.click('#force-cancel');
    await D.choose('아');
    await E.choose('파', B);
    await F.choose('파', G);
    await G.choose('파', F);
    await H.choose('순파', C);
    await A.click('#btn-reveal');
    for (const phase of ['count2', 'skills', 'attacks', 'impact', 'outs']) {
      // 백그라운드 페이지는 requestAnimationFrame이 멈추므로 시간 간격으로 확인
      await A.waitForFunction((ph) => state.reveal.phase === ph, phase, { polling: 30 });
      await A.screenshot({ path: path.join(SHOT_DIR, `S06-reveal-${phase}-360.png`), fullPage: true });
    }
    await A.waitSummary();
    await audit(A, 'S06-reveal-done', issues);
    await game.next(A, players);
    await audit(D, 'S05-out-player', issues);
    expect(issues).toEqual([]);
  });

  test('S-07 승리·무승부 화면, 관전 화면, 다른 탭 안내', async ({ game }) => {
    const issues = [];
    const { code, host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const late = await game.player('관전자');
    await late.join(code, '관전자', 7);
    await audit(late, 'S05-spectator', issues);
    const all = [...players, late];
    await game.round(A, [[A, '파', B], [B, '파', C], [C, '파', A]], all);
    await game.next(A, all, 'screen-end');
    await audit(A, 'S07-end-draw', issues);
    await A.click('#btn-new-game');
    await Promise.all(all.map((p) => p.waitScreen('screen-round')));
    await game.round(A, [[A, '파', B], [B, '아'], [C, '아'], [late, '파', C]], all);
    await game.next(A, all, 'screen-round');
    await game.round(A, [[A, '아'], [late, '아']], all);
    await game.next(A, all);
    await game.round(A, [[A, '파', late], [late, '아']], all);
    await game.next(A, all, 'screen-end');
    await audit(B, 'S07-end-win', issues);
    const tab2 = await B.ctx.newPage();
    await tab2.goto(`${game.base}/room/${code}`);
    await B.waitScreen('screen-notice');
    await audit(B, 'S00-other-tab-notice', issues);
    expect(issues).toEqual([]);
  });
});

test('@smoke 모바일 기기에서 가로 스크롤 없음 (시작·대기실·라운드)', async ({ game }) => {
  const { host: A, players } = await game.lobby(4);
  const check = async (label) => {
    const overflow = await A.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${label} 가로 스크롤`).toBeLessThanOrEqual(0);
  };
  await check('대기실');
  await game.start(players);
  await A.click('.skill-btn[data-skill="파"]');
  await check('라운드');
  const box = await A.locator('.skill-btn[data-skill="아"]').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await A.screenshot({ path: path.join(SHOT_DIR, `device-${test.info().project.name}-round.png`), fullPage: true });
});

test('움직임 줄이기 설정에서도 공개 정보(기술·결과·OUT)는 모두 전달', async ({ game }) => {
  game.base = REAL;
  const { host: A, players } = await game.lobby(2);
  const [, B] = players;
  await B.emulateMedia({ reducedMotion: 'reduce' });
  await game.start(players);
  await A.choose('파', B);
  await B.choose('아');
  await A.click('#btn-reveal');
  await B.waitForFunction(() => state.reveal.phase === 'impact', null, { polling: 30 });
  await expect(B.locator('#arena-fx .projectile')).toHaveCount(0);
  await expect(B.locator('.impact-hit')).toContainText('명중');
  await expect(B.locator('#reveal-caption')).toContainText('명중');
  await B.waitForFunction(() => state.reveal.phase === 'outs', null, { polling: 30 });
  await expect(B.locator('.out-stamp')).toBeVisible();
  await B.waitSummary();
});

test('색만으로 상태를 구분하지 않음: 선택·완료·OUT·연결 끊김·기 부족에 글자/아이콘', async ({ game }) => {
  const { host: A, players } = await game.lobby(3);
  const [, B, C] = players;
  await game.start(players);
  await A.click('.skill-btn[data-skill="파"]');
  const after = await A.locator('.skill-btn[data-skill="파"]').evaluate((el) => getComputedStyle(el, '::after').content);
  expect(after).toContain('✔');
  await expect(A.locator('.skill-btn[data-skill="에"]')).toContainText('🔒 기 3개 필요');
  await B.choose('아');
  await expect(A.locator('#status-list')).toContainText('✔ 선택 완료');
  await expect(A.locator('#status-list')).toContainText('… 선택 중');
  await C.close();
  await expect(A.locator('#status-list')).toContainText('📵 연결 끊김');
});
