// @ts-check
// F-01 ~ F-10 방 만들기·입장·대기실, F-29 호스트 승계
const path = require('node:path');
const { test, expect, FAST_TIMING, NAMES } = require('./helpers');

const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

test.describe('F-01 ~ F-02 방 만들기와 공유', () => {
  test('@smoke F-01 방 만들기 → 만든 사람이 호스트, 추측하기 어려운 6자리 코드', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    expect(code).toMatch(CODE_RE);
    await expect(host.locator('#lobby-players li')).toHaveCount(1);
    await expect(host.locator('#lobby-players')).toContainText('👑 호스트');
    await expect(host.locator('#btn-start')).toBeVisible();
  });

  test('F-02 고유 링크 /room/<코드>로 바로 입장 (소문자도 허용)', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const guest = await game.player('손님');
    await guest.goto(`${game.base}/room/${code.toLowerCase()}`);
    await guest.waitScreen('screen-join');
    await expect(guest.locator('#join-code')).toHaveText(code);
  });

  test('F-02 시작 화면의 방 코드 입력으로 입장', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const guest = await game.player('손님');
    await guest.goto(`${game.base}/`);
    await guest.fill('#input-code', ` ${code.toLowerCase()} `);
    await guest.press('#input-code', 'Enter');
    await guest.waitScreen('screen-join');
  });

  test('F-02 링크 복사 버튼과 QR 코드가 같은 링크(내부 IP)를 담는다', async ({ game }) => {
    const host = await game.player('호스트', { context: { permissions: ['clipboard-read', 'clipboard-write'] } });
    const code = await host.createRoom('호스트', 0);
    const link = await host.inputValue('#share-link');
    expect(link).toMatch(new RegExp(`^http://[\\d.]+:3310/room/${code}$`));
    expect(link, '휴대폰에서 열리도록 localhost가 아니어야 함').not.toContain('localhost');

    await host.click('#btn-copy');
    await expect(host.locator('#copy-status')).toContainText('복사했습니다');
    const clip = await host.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip !== null) expect(clip).toBe(link);

    const decoded = await decodeQr(host);
    expect(decoded).toBe(link);
  });

  test('인터넷 주소(배포·터널)로 들어오면 링크와 QR도 그 주소를 쓴다', async ({ game }) => {
    // 배포 서비스·터널은 원래 주소를 X-Forwarded-Host / -Proto 헤더로 넘긴다.
    const host = await game.player('호스트', {
      context: { extraHTTPHeaders: { 'X-Forwarded-Host': 'dbg-game.example.com', 'X-Forwarded-Proto': 'https' } },
    });
    const code = await host.createRoom('호스트', 0);
    const link = `https://dbg-game.example.com/room/${code}`;
    await expect(host.locator('#share-link')).toHaveValue(link);
    expect(await decodeQr(host)).toBe(link);

    // 같은 방이라도 같은 Wi-Fi(내부 IP)로 들어온 사람에게는 내부 주소를 보여준다.
    const lan = await game.player('이웃');
    await lan.join(code, '이웃', 1);
    await expect(host.locator('#lobby-players li')).toHaveCount(2);
    await expect(host.locator('#share-link')).toHaveValue(link);
  });

  test('없는 방 링크로 들어오면 안내 후 시작 화면', async ({ game }) => {
    const p = await game.player('손님');
    await p.goto(`${game.base}/room/ZZZZZZ`);
    await p.waitScreen('screen-start');
    await expect(p.locator('#start-error')).toContainText('방을 찾을 수 없습니다');
    expect(new URL(p.url()).pathname).toBe('/');
  });
});

test.describe('F-03 ~ F-04 닉네임과 캐릭터', () => {
  test('@smoke F-03 닉네임 검증: 빈 값·공백·11자 거부, 1자·10자 통과, 중복 거부', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('Goku', 0);
    const p = await game.player('손님');
    await p.goto(`${game.base}/room/${code}`);
    await p.waitScreen('screen-join');
    await p.click('#avatar-grid .avatar-option >> nth=3');

    for (const bad of ['', '   ']) {
      await p.fill('#input-nickname', bad);
      await p.click('#btn-join');
      await expect(p.locator('#join-error')).toContainText('1~10자');
    }
    // 입력창 maxlength=10이라 11자는 화면에서 입력되지 않는다 → 서버에 직접 보내 확인
    expect(await p.inputValue('#input-nickname').then(() => p.locator('#input-nickname').getAttribute('maxlength'))).toBe('10');
    const r11 = await p.emitAck('room:join', { code, nickname: '가나다라마바사아자차카', avatarId: 'char-05' });
    expect(r11.ok).toBe(false);
    const dup = await p.emitAck('room:join', { code, nickname: ' goku ', avatarId: 'char-05' });
    expect(dup.ok, '대소문자만 다른 중복 닉네임도 거부').toBe(false);
    expect(dup.error).toContain('닉네임');

    await p.fill('#input-nickname', '가나다라마바사아자차');
    await p.click('#btn-join');
    await p.locator('#app > .screen:not([hidden]):not(#screen-join)').waitFor();
    await p.closeRulesIfShown();
    await p.waitScreen('screen-lobby');
    await expect(host.locator('#lobby-players')).toContainText('가나다라마바사아자차');

    const one = await game.player('한글자');
    await one.join(code, '가', 6);
    await expect(host.locator('#lobby-players li')).toHaveCount(3);
  });

  test('F-03 보이지 않는 글자(제로폭 공백)만으로 된 닉네임은 빈 값으로 거부되어야 함', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const p = await game.player('손님');
    await p.goto(`${game.base}/room/${code}`);
    await p.waitScreen('screen-join');
    const res = await p.emitAck('room:join', { code, nickname: '​​', avatarId: 'char-04' });
    expect(res.ok, `제로폭 공백 닉네임이 받아들여짐: ${JSON.stringify(res)}`).toBe(false);
  });

  test('F-04 이미 고른 캐릭터는 선택 불가, 랜덤은 남은 캐릭터만, 입장 화면에 실시간 반영', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const p = await game.player('손님');
    await p.goto(`${game.base}/room/${code}`);
    await p.waitScreen('screen-join');
    await expect(p.locator('.avatar-option').first()).toBeDisabled();
    await expect(p.locator('.avatar-option').first()).toContainText('선택됨');
    await expect(p.locator('.avatar-option')).toHaveCount(20);

    // 다른 사람이 입장하면 대기 중인 입장 화면에도 바로 반영
    const q = await game.player('셋째');
    await q.join(code, '셋째', 4);
    await expect(p.locator('.avatar-option').nth(4)).toBeDisabled();

    for (let i = 0; i < 15; i++) {
      await p.click('#btn-random');
      const picked = await p.locator('.avatar-option[aria-pressed="true"]').getAttribute('data-avatar');
      expect(['char-01', 'char-05']).not.toContain(picked);
    }
  });

  test('F-04 두 사람이 동시에 같은 캐릭터를 고르면 한 명만 입장', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const a = await game.player('A');
    const b = await game.player('B');
    for (const p of [a, b]) {
      await p.goto(`${game.base}/room/${code}`);
      await p.waitScreen('screen-join');
    }
    const [ra, rb] = await Promise.all([
      a.emitAck('room:join', { code, nickname: '에이', avatarId: 'char-07' }),
      b.emitAck('room:join', { code, nickname: '비이', avatarId: 'char-07' }),
    ]);
    expect([ra.ok, rb.ok].sort()).toEqual([false, true]);
    const loser = ra.ok ? rb : ra;
    expect(loser.error).toContain('먼저 고른 캐릭터');
  });

  test('최대 8명: 9번째는 입장 화면에서 안내, 서버도 거부', async ({ game }) => {
    const { code, host } = await game.lobby(8);
    await expect(host.locator('#lobby-count')).toHaveText('참가자 8명 / 최대 8명');
    const ninth = await game.player('아홉째');
    await ninth.goto(`${game.base}/room/${code}`);
    await ninth.waitScreen('screen-join');
    await expect(ninth.locator('#join-notice')).toContainText('가득');
    await expect(ninth.locator('#btn-join')).toBeDisabled();
    const res = await ninth.emitAck('room:join', { code, nickname: '아홉', avatarId: 'char-20' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('가득');
  });
});

test.describe('F-05 ~ F-10 대기실과 룰 안내', () => {
  test('F-05 게임 중 들어온 사람은 관전하다가 다음 게임부터 참가', async ({ game }) => {
    const { code, host, players } = await game.lobby(2);
    await game.start(players);
    const late = await game.player('늦은이');
    await late.goto(`${game.base}/room/${code}`);
    await late.waitScreen('screen-join');
    await expect(late.locator('#join-notice')).toContainText('다음 게임부터');
    await late.joinForm('늦은이', 5);
    await late.waitScreen('screen-round');
    await expect(late.locator('#spectator-notice')).toBeVisible();
    await expect(late.locator('#choice-area')).toBeHidden();
    await expect(host.locator('#status-list')).toContainText('관전');
    // 관전자는 대상 목록에 없음
    await host.click('.skill-btn[data-skill="파"]');
    await expect(host.locator(`[data-target="${late.pid}"]`)).toHaveCount(0);
  });

  test('@smoke F-07 대기실 목록 실시간 갱신 (캐릭터 이미지, 닉네임, 호스트 표시)', async ({ game }) => {
    const { host, players } = await game.lobby(3);
    for (const p of players) {
      await expect(p.locator('#lobby-players li')).toHaveCount(3);
      await expect(p.locator('#lobby-players li img')).toHaveCount(3);
    }
    await expect(players[2].locator('#lobby-players li').first()).toContainText('👑 호스트');
    await expect(host.locator('#lobby-players')).toContainText(NAMES[2]);
  });

  test('F-08 처음 입장할 때만 룰 안내 자동 표시, 이후 룰 버튼으로 다시 보기', async ({ game }) => {
    const host = await game.player('호스트');
    await host.goto(`${game.base}/`);
    await host.click('#btn-create');
    await host.waitScreen('screen-join');
    await host.fill('#input-nickname', '호스트');
    await host.click('#avatar-grid .avatar-option >> nth=0');
    await host.click('#btn-join');
    await host.waitScreen('screen-rules');
    await host.click('#btn-rules-close');
    await host.waitScreen('screen-lobby');
    await host.reload();
    await host.waitScreen('screen-lobby');
    // 같은 기기에서 다른 방에 처음 들어가도 다시 뜨지 않음
    await host.goto(`${game.base}/`);
    await host.click('#btn-create');
    await host.waitScreen('screen-join');
    await host.fill('#input-nickname', '호스트2');
    await host.click('#avatar-grid .avatar-option >> nth=1');
    await host.click('#btn-join');
    await host.waitScreen('screen-lobby');
    await host.click('#btn-rules');
    await host.waitScreen('screen-rules');
    await host.click('#btn-rules-close');
    await host.waitScreen('screen-lobby');
  });

  test('F-09 룰 안내: 기술 카드 6장(이름·소모 기·효과·막는 것), 상성표, 예시 3~4개', async ({ game }) => {
    const p = await game.player('손님');
    await p.goto(`${game.base}/`);
    await p.click('#btn-rules');
    await p.waitScreen('screen-rules');
    const cards = p.locator('.skill-card');
    await expect(cards).toHaveCount(6);
    for (const skill of ['아', '막', '파', '에', '순', '순파']) {
      const card = p.locator(`.skill-card[data-skill="${skill}"]`);
      await expect(card.locator('.cost')).toContainText('기');
      await expect(card.locator('.defends')).toContainText(/막는 것|피하는 것/);
    }
    await expect(p.locator('.rule-table tbody tr')).toHaveCount(3);
    const examples = await p.locator('.rule-examples .example').count();
    expect(examples).toBeGreaterThanOrEqual(3);
    expect(examples).toBeLessThanOrEqual(4);
    await p.click('#btn-rules-close');
    await p.waitScreen('screen-start');
  });

  test('@smoke F-10 시작 버튼: 호스트에게만, 2명 이상일 때만 활성화', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    await expect(host.locator('#btn-start')).toBeDisabled();
    const solo = await host.emitAck('game:start');
    expect(solo.ok).toBe(false);
    const g = await game.player('손님');
    await g.join(code, '손님', 1);
    await expect(host.locator('#btn-start')).toBeEnabled();
    await expect(g.locator('#btn-start')).toBeHidden();
    const notHost = await g.emitAck('game:start');
    expect(notHost.ok).toBe(false);
    expect(notHost.error).toContain('호스트');
  });
});

test.describe('F-29 호스트 승계와 나가기', () => {
  test('@smoke F-29 대기실에서 호스트가 나가면 가장 먼저 입장한 참가자가 호스트', async ({ game }) => {
    const { host, players } = await game.lobby(3);
    const [, B, C] = players;
    await host.ctx.close();
    await expect(B.locator('#lobby-players')).toContainText('📵 연결 끊김');
    await expect(B.locator('#btn-start'), '잠시 끊긴 동안은 호스트 유지').toBeHidden();
    await expect(B.locator('#btn-start')).toBeVisible({ timeout: FAST_TIMING.graceMs + 5000 });
    await expect(C.locator('#lobby-players li')).toHaveCount(2);
    await expect(C.locator('#lobby-players li').first()).toContainText('👑 호스트');
  });

  test('F-29 게임 중 호스트가 나가도 새 호스트가 강제 진행으로 게임을 이어감', async ({ game }) => {
    const { host, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await host.ctx.close();
    await expect(B.locator('#btn-force')).toBeVisible({ timeout: FAST_TIMING.graceMs + 5000 });
    await B.choose('파', C);
    await C.choose('막');
    await B.click('#btn-force');
    await B.click('#force-confirm');
    await Promise.all([B, C].map((p) => p.waitSummary()));
    await expect(B.locator('#summary-list')).toContainText('에이: 막 (선택하지 않아 막 처리)');
  });

  test('F-29 방을 만든 사람이 입장 전에 나가면, 먼저 들어온 참가자가 호스트가 되어야 함', async ({ game }) => {
    // 만든 사람이 입장 화면에 있는 동안 손님이 먼저 입장 → 만든 사람이 입장하지 않고 나감
    const creator = await game.player('만든이');
    await creator.goto(`${game.base}/`);
    await creator.click('#btn-create');
    await creator.waitScreen('screen-join');
    const code = creator.url().split('/').pop();
    const a = await game.player('A');
    await a.join(code, '에이', 1);
    const b = await game.player('B');
    await b.join(code, '비이', 2);
    await creator.ctx.close();
    await a.waitForTimeout(FAST_TIMING.graceMs + 2000);
    const room = await a.room();
    const hostIsPlayer = room.players.some((p) => p.id === room.hostId);
    expect(hostIsPlayer, `호스트가 방에 없는 사람(${room.hostId.slice(0, 6)}…)으로 남아 아무도 시작할 수 없음`).toBe(true);
  });

  test('F-29 호스트가 브라우저 뒤로 가기로 방을 떠나면 나간 것으로 처리되어야 함', async ({ game }) => {
    const { host, players } = await game.lobby(2);
    const [, B] = players;
    await host.goBack(); // /room/CODE → / (같은 탭, 소켓은 유지)
    await host.waitScreen('screen-start');
    await B.waitForTimeout(FAST_TIMING.graceMs + 2000);
    const text = await B.textContent('#lobby-players');
    const bIsHost = await B.locator('#btn-start').isVisible();
    expect(
      bIsHost || text.includes('연결 끊김'),
      `떠난 호스트가 여전히 '연결됨' 호스트로 남음. B 화면: ${text.replace(/\s+/g, ' ')}`,
    ).toBe(true);
  });
});

// 대기실의 QR 이미지를 캔버스에 그려 jsQR로 해독한다.
async function decodeQr(page) {
  await expect.poll(() => page.evaluate(() => document.getElementById('qr-image').naturalWidth)).toBeGreaterThan(0);
  await page.addScriptTag({ path: path.join(__dirname, '..', '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js') });
  return page.evaluate(() => {
    const img = document.getElementById('qr-image');
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 400);
    ctx.drawImage(img, 20, 20, 360, 360);
    const data = ctx.getImageData(0, 0, 400, 400);
    const result = window.jsQR(data.data, 400, 400);
    return result ? result.data : null;
  });
}
