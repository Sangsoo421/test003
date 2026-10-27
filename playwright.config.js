// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// 서버 두 개를 띄운다.
// - FAST: 연출·유예·방 정리 시간을 줄여 테스트를 빠르게 돌리는 서버
// - REAL: 실제 기본값(공개 연출 4.5초 등)으로 F-19 시간과 기기 간 동기화를 재는 서버
const FAST_PORT = 3310;
const REAL_PORT = 3311;

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node server/index.js',
      port: FAST_PORT,
      reuseExistingServer: false,
      env: {
        PORT: String(FAST_PORT),
        DBG_REVEAL_MS: '1200',
        DBG_LEAVE_GRACE_MS: '2500',
        DBG_ROOM_TTL_MS: '3000',
      },
    },
    {
      command: 'node server/index.js',
      port: REAL_PORT,
      reuseExistingServer: false,
      env: { PORT: String(REAL_PORT) },
    },
  ],
  projects: [
    // 모든 테스트: 안드로이드 크롬 에뮬레이션
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    // @smoke 테스트만: iPhone 사파리(WebKit) 에뮬레이션
    { name: 'iphone-safari', use: { ...devices['iPhone 13'] }, grep: /@smoke/ },
  ],
});

module.exports.FAST_PORT = FAST_PORT;
module.exports.REAL_PORT = REAL_PORT;
