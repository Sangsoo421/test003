// @ts-check
// 서버 검증, 보안, 엣지 케이스 (PRD §7 공정성·보안, §8 저작권)
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, FAST_TIMING } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');

test.describe('서버 검증: 화면을 거치지 않은 소켓 요청', () => {
  test('@smoke 호스트가 아닌 사람의 호스트 전용 요청은 모두 거부', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    for (const ev of ['game:start', 'round:reveal', 'round:force', 'round:next', 'game:lobby']) {
      const r = await B.emitAck(ev);
      expect(r.ok, ev).toBe(false);
    }
    await game.start(players);
    for (const ev of ['round:reveal', 'round:force', 'round:next', 'game:lobby', 'game:start']) {
      const r = await B.emitAck(ev);
      expect(r.ok, ev).toBe(false);
      expect(r.error).toContain('호스트');
    }
    expect((await A.room()).status).toBe('choosing');
  });

  test('규칙에 어긋난 선택은 거부: 기 부족, 자기 자신·없는 대상, 대상 누락, 비공격 기술에 대상, 끝난 라운드', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    const cases = [
      [{ round: 1, skill: '에', targetId: B.pid }, '기가 모자'],
      [{ round: 1, skill: '순파', targetId: B.pid }, '기가 모자'],
      [{ round: 1, skill: '파', targetId: A.pid }, '자기 자신'],
      [{ round: 1, skill: '파', targetId: 'nobody-0000' }, '살아 있는'],
      [{ round: 1, skill: '파' }, '대상'],
      [{ round: 1, skill: '막', targetId: B.pid }, '대상'],
      [{ round: 1, skill: '카' }, '없는 기술'],
      [{ round: 0, skill: '아' }, '끝난 라운드'],
      [{ round: '1', skill: '아' }, '끝난 라운드'],
      [{ round: 1, skill: '파', targetId: { id: B.pid } }, ''],
    ];
    for (const [payload, msg] of cases) {
      const r = await A.emitAck('round:submit', payload);
      expect(r.ok, JSON.stringify(payload)).toBe(false);
      if (msg) expect(r.error).toContain(msg);
    }
    expect((await B.room()).players.find((p) => p.id === A.pid).submitted).toBe(false);
  });

  test('아웃된 사람·관전자의 선택, 공개 중·종료 후 선택은 거부', async ({ game }) => {
    const { code, host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const late = await game.player('관전');
    await late.join(code, '관전', 9);
    expect((await late.emitAck('round:submit', { round: 1, skill: '아' })).ok).toBe(false);
    await A.choose('파', B);
    await B.choose('아');
    await C.choose('아');
    await A.click('#btn-reveal');
    expect((await C.emitAck('round:submit', { round: 1, skill: '막' })).ok, '공개 중 선택').toBe(false);
    await Promise.all([...players, late].map((p) => p.waitSummary()));
    await game.next(A, [...players, late]);
    expect((await B.emitAck('round:submit', { round: 2, skill: '아' })).ok, '아웃된 사람').toBe(false);
    expect((await B.emitAck('round:cancel', { round: 2 })).ok).toBe(false);
  });

  test('@smoke 기술 이름 자리에 객체 속성 이름(__proto__, constructor 등)을 보내도 거부되어야 함', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    const accepted = [];
    for (const skill of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const r = await A.emitAck('round:submit', { round: 1, skill });
      if (r.ok) accepted.push(skill);
    }
    // 받아들여졌다면 어떤 결과가 나오는지도 기록
    let after = null;
    if (accepted.length) {
      await A.emitAck('round:submit', { round: 1, skill: accepted[0] });
      await B.choose('아');
      await A.click('#btn-reveal');
      await Promise.all(players.map((p) => p.waitSummary()));
      await game.next(A, players);
      const room = await B.room();
      const a = room.players.find((p) => p.id === A.pid);
      // 기가 망가진 뒤에도 '에'(기 3)가 통과되는지
      const e = await A.emitAck('round:submit', { round: 2, skill: '에', targetId: B.pid });
      after = { kiSeenByOthers: a.ki, ultimateAccepted: e.ok };
    }
    expect(accepted, `서버가 받아들인 가짜 기술: ${JSON.stringify(accepted)} → 결과 ${JSON.stringify(after)}`).toEqual([]);
  });

  test('결과 확인을 연타하거나 동시에 보내도 판정은 한 번', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await A.choose('아');
    await B.choose('아');
    const results = await A.evaluate(() => Promise.all(
      Array.from({ length: 5 }, (_, i) => new Promise((res) => socket.emit(i % 2 ? 'round:force' : 'round:reveal', res))),
    ));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await Promise.all(players.map((p) => p.waitSummary()));
    await game.next(A, players);
    expect(await A.ki()).toBe(2); // 아가 두 번 더해지지 않음
  });

  test('다음 라운드 연타도 한 번만 진행', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.round(A, [[A, '아'], [B, '아']], players);
    const results = await A.evaluate(() => Promise.all(
      Array.from({ length: 4 }, () => new Promise((res) => socket.emit('round:next', res))),
    ));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await expect(A.locator('#round-title')).toHaveText('라운드 2');
  });
});

test.describe('보안·입력 처리', () => {
  test('@smoke 닉네임의 HTML은 실행되지 않고 모든 화면에서 글자로 보임', async ({ game }) => {
    const host = await game.player('호스트');
    let dialogs = 0;
    const payload = '<img src=x onerror=alert(1)>';
    const code = await host.createRoom('호스트', 0);
    const evil = await game.player('악성');
    evil.on('dialog', (d) => {
      dialogs++;
      d.dismiss();
    });
    host.on('dialog', (d) => {
      dialogs++;
      d.dismiss();
    });
    await evil.goto(`${game.base}/room/${code}`);
    await evil.waitScreen('screen-join');
    // 입력창은 10자까지라 서버로 직접 보낸다 → 길이 제한으로 거부되는지, 10자 이내 HTML은 글자로 표시되는지
    const long = await evil.emitAck('room:join', { code, nickname: payload, avatarId: 'char-03' });
    expect(long.ok).toBe(false);
    const short = '<b>x</b>"\'';
    await evil.joinForm(short, 2);
    const players = [host, evil];
    await expect(host.locator('#lobby-players')).toContainText(short);
    await expect(host.locator('#lobby-players b')).toHaveCount(0);
    await game.start(players);
    await expect(host.locator('#status-list')).toContainText(short);
    await host.click('.skill-btn[data-skill="파"]');
    await expect(host.locator('#target-buttons')).toContainText(short);
    await host.click(`[data-target="${evil.pid}"]`);
    await host.click('#btn-decide');
    await evil.choose('아');
    await host.click('#btn-reveal');
    await Promise.all(players.map((p) => p.waitSummary()));
    await expect(host.locator('#summary-list')).toContainText(short);
    await game.next(host, players, 'screen-end');
    await expect(host.locator('#ranking-list')).toContainText(short);
    expect(await host.locator('main b, #status-list b').count()).toBe(0);
    expect(dialogs).toBe(0);
  });

  test('방 코드: 6자리, 헷갈리는 글자(0 O 1 I L) 없음, 겹치지 않음', async ({ game }) => {
    const p = await game.player('생성기');
    await p.goto(`${game.base}/`);
    const codes = await p.evaluate(() => Promise.all(
      Array.from({ length: 30 }, () => new Promise((res) => socket.emit('room:create', (r) => res(r.code)))),
    ));
    expect(new Set(codes).size).toBe(30);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const src = fs.readFileSync(path.join(ROOT, 'server', 'rooms.js'), 'utf8');
    expect(src).toContain('crypto.randomInt');
  });

  test('모든 참가자가 나간 방은 설정 시간 뒤 삭제', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    await host.ctx.close();
    const checker = await game.player('확인');
    await checker.goto(`${game.base}/`);
    expect((await checker.request.get(`${game.base}/qr/${code}`)).status()).toBe(200);
    await checker.waitForTimeout(FAST_TIMING.ttlMs + 1500);
    expect((await checker.request.get(`${game.base}/qr/${code}`)).status()).toBe(404);
    await checker.goto(`${game.base}/room/${code}`);
    await checker.waitScreen('screen-start');
    await expect(checker.locator('#start-error')).toContainText('찾을 수 없습니다');
  });

  test('누군가 접속해 있는 방은 삭제되지 않음', async ({ game }) => {
    const { code, host } = await game.lobby(2);
    await host.waitForTimeout(FAST_TIMING.ttlMs + 1500);
    expect((await host.request.get(`${game.base}/qr/${code}`)).status()).toBe(200);
  });

  test('잘못된 플레이어 ID로 접속하면 안내', async ({ game }) => {
    const p = await game.player('이상한ID');
    await p.goto(`${game.base}/`);
    await p.evaluate(() => localStorage.setItem('dbg.playerId', 'x'));
    await p.reload();
    // 짧은 ID는 새로 만들어지므로 정상 동작
    const id = await p.evaluate(() => state.playerId);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('localStorage가 막혀 있어도 게임 진행', async ({ game }) => {
    const host = await game.player('호스트');
    const code = await host.createRoom('호스트', 0);
    const p = await game.player('저장불가');
    await p.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await p.join(code, '저장불가', 1);
    await expect(host.locator('#lobby-players li')).toHaveCount(2);
    await p.click('#btn-music');
    await expect(p.locator('#btn-music')).toContainText('음악 꺼짐');
  });
});

test.describe('§8 저작권', () => {
  test('원작 이미지·음악 파일이 없고 CREDITS.md에 모든 자산의 출처가 있음', async () => {
    const files = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) walk(full);
        else files.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    };
    walk(path.join(ROOT, 'public'));
    const media = files.filter((f) => /\.(png|jpe?g|gif|webp|mp3|ogg|wav|m4a|aac|mp4|ttf|otf|woff2?)$/i.test(f));
    expect(media, '음원·이미지·글꼴 파일은 public/에 없어야 함 (SVG 아바타와 코드 합성 음원만)').toEqual([]);
    const svgs = files.filter((f) => f.endsWith('.svg'));
    expect(svgs).toHaveLength(20);
    for (const f of files) expect(f.toLowerCase()).not.toMatch(/goku|vegeta|dragon|db_|toriyama|kamehameha/);
    const credits = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    for (const word of ['audio.js', 'avatars', 'generate-avatars.js', 'Pretendard', 'Open Font License']) {
      expect(credits).toContain(word);
    }
  });
});
