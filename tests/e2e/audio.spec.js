// @ts-check
// F-30 ~ F-33 배경음악과 효과음
const { test, expect } = require('./helpers');

// AudioContext 생성과 오실레이터(음 하나) 생성을 센다.
async function instrumentAudio(page) {
  await page.addInitScript(() => {
    window.__audio = { contexts: 0, oscillators: 0 };
    const Orig = window.AudioContext || window.webkitAudioContext;
    if (!Orig) return;
    const Wrapped = function (...args) {
      window.__audio.contexts++;
      const ctx = new Orig(...args);
      window.__audio.ctx = ctx;
      return ctx;
    };
    Wrapped.prototype = Orig.prototype;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
    const create = Orig.prototype.createOscillator;
    Orig.prototype.createOscillator = function () {
      window.__audio.oscillators++;
      return create.call(this);
    };
  });
}

const audio = (page) => page.evaluate(() => ({
  contexts: window.__audio.contexts,
  oscillators: window.__audio.oscillators,
  state: window.__audio.ctx ? window.__audio.ctx.state : null,
}));

async function oscillatorsIn(page, ms) {
  const a = (await audio(page)).oscillators;
  await page.waitForTimeout(ms);
  return (await audio(page)).oscillators - a;
}

test('@smoke F-33 사용자가 처음 누르기 전에는 오디오를 만들지 않고, 누른 뒤 재생', async ({ game }) => {
  const p = await game.player('음악');
  const hasWebAudio = await p.evaluate(() => Boolean(window.AudioContext || window.webkitAudioContext));
  // Playwright의 Windows용 WebKit에는 Web Audio가 없다 (실제 iOS Safari에는 있음). 없을 때 에러 없이 동작하는지만 확인.
  if (!hasWebAudio) {
    await p.goto(`${game.base}/`);
    await p.click('#btn-rules');
    await p.click('#btn-music');
    await expect(p.locator('#btn-music')).toContainText('음악 꺼짐');
    test.info().annotations.push({ type: '환경 제한', description: '이 브라우저에 Web Audio 없음 → 재생 확인 생략, 에러 없음만 확인' });
    return;
  }
  await instrumentAudio(p);
  await p.goto(`${game.base}/`);
  await p.waitForTimeout(800);
  expect((await audio(p)).contexts, '첫 탭 전 AudioContext 생성 없음').toBe(0);
  await p.click('#btn-rules'); // 첫 누름
  await expect.poll(async () => (await audio(p)).contexts).toBe(1);
  await expect.poll(async () => (await audio(p)).state).toBe('running');
  expect(await oscillatorsIn(p, 1200), '대기 음악이 재생됨').toBeGreaterThan(0);
});

test('F-30 게임 중 배경음악 재생, 결과 공개 중에는 음악을 멈춤 / F-32 끄면 소리가 나지 않음', async ({ game }) => {
  const { host: A, players } = await game.lobby(2);
  const [, B] = players;
  await instrumentAudio(A);
  await A.reload();
  await A.waitScreen('screen-lobby');
  await A.click('#lobby-title'); // 첫 누름
  await game.start(players);
  const battle = await oscillatorsIn(A, 1500);
  expect(battle, '게임 중 음악').toBeGreaterThan(0);
  await A.click('#btn-music');
  await expect(A.locator('#btn-music')).toHaveAttribute('aria-pressed', 'false');
  await A.waitForTimeout(300);
  expect(await oscillatorsIn(A, 1200), '끄면 새 음 없음').toBe(0);
  // 결과 공개 중에도 꺼진 상태면 효과음 없음
  await A.choose('아');
  await B.choose('아');
  await A.click('#btn-reveal');
  expect(await oscillatorsIn(A, 800)).toBe(0);
  await A.click('#btn-music');
  await A.waitSummary();
});

test('@smoke F-32 모든 화면에 음악 버튼, 설정은 새로고침 후에도 유지', async ({ game }) => {
  const p = await game.player('설정');
  await p.goto(`${game.base}/`);
  await expect(p.locator('#btn-music')).toContainText('음악 켜짐');
  await p.click('#btn-music');
  await expect(p.locator('#btn-music')).toContainText('음악 꺼짐');
  await p.reload();
  await expect(p.locator('#btn-music')).toContainText('음악 꺼짐');
  await expect(p.locator('#btn-music')).toHaveAttribute('aria-pressed', 'false');
  for (const screen of ['screen-start', 'screen-rules']) {
    if (screen === 'screen-rules') await p.click('#btn-rules');
    await p.waitScreen(screen);
    await expect(p.locator('#btn-music')).toBeVisible();
  }
});
