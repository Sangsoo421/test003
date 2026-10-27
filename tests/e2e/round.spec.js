// @ts-check
// F-06 재접속, F-11 ~ F-17 라운드 진행
const { test, expect } = require('./helpers');

test.describe('F-11 ~ F-14 기술 고르기', () => {
  test('@smoke F-11·F-12 기 1개로 시작, 기가 모자란 기술은 비활성 + 필요 개수 표시', async ({ game }) => {
    const { players } = await game.lobby(2);
    await game.start(players);
    for (const p of players) {
      await expect(p.locator('#round-title')).toHaveText('라운드 1');
      expect(await p.ki()).toBe(1);
      await expect(p.locator('.skill-btn[data-skill="에"]')).toBeDisabled();
      await expect(p.locator('.skill-btn[data-skill="에"]')).toContainText('기 3개 필요');
      await expect(p.locator('.skill-btn[data-skill="순파"]')).toContainText('기 2개 필요');
      for (const s of ['아', '막', '파', '순']) await expect(p.locator(`.skill-btn[data-skill="${s}"]`)).toBeEnabled();
    }
  });

  test('F-13 공격 기술은 대상 선택: 자신 제외 생존자를 캐릭터 이미지로', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.round(A, [[A, '파', B], [B, '아'], [C, '아']], players);
    await game.next(A, players);
    await C.click('.skill-btn[data-skill="파"]');
    await expect(C.locator('#target-area')).toBeVisible();
    await expect(C.locator('.target-btn')).toHaveCount(1); // A만 (자신·아웃된 B 제외)
    await expect(C.locator(`[data-target="${A.pid}"] img`)).toBeVisible();
    await expect(C.locator('#btn-decide')).toBeDisabled();
    await C.click('.skill-btn[data-skill="막"]');
    await expect(C.locator('#target-area')).toBeHidden();
    await expect(C.locator('#btn-decide')).toBeEnabled();
  });

  test('F-14 결정 후 결과 확인 전까지 바꿀 수 있고, 바뀐 선택으로 판정', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await A.choose('파', B);
    await expect(A.locator('#choice-summary')).toContainText('선택 완료');
    await expect(A.locator('.skill-btn[data-skill="아"]')).toBeDisabled();
    await A.click('#btn-change');
    await expect(A.locator('#btn-decide')).toBeVisible();
    await expect(B.locator('#status-list')).toContainText('… 선택 중');
    await A.choose('아');
    const r = await game.round(A, [[B, '아']], players);
    expect(r.actions.find((a) => a.playerId === A.pid).skill).toBe('아');
  });
});

test.describe('F-15 공정성: 공개 전 선택 비공개', () => {
  test('@smoke F-15 공개 전에는 다른 사람의 선택이 어떤 프레임에도 실려 오지 않음', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await A.choose('파', B);
    await B.choose('막');
    // 공개 직전까지의 프레임과 화면 상태 검사
    const before = Date.now();
    for (const p of [B, C]) {
      const leaked = p.frames_
        .filter((f) => f.t <= before)
        .map((f) => f.payload)
        .filter((s) => s.startsWith('42'))
        .map((s) => JSON.parse(s.slice(2)))
        .filter(([ev]) => ev === 'room:state')
        .filter(([, data]) => JSON.stringify({ ...data, myAction: null }).includes('"skill"'));
      expect(leaked, `${p.playerName}가 받은 room:state에 다른 사람의 skill이 있음`).toEqual([]);
      expect(p.frames_.length, '검사한 프레임이 있어야 함').toBeGreaterThan(0);
      const domText = await p.locator('body').innerText();
      expect(domText).not.toContain('파 →');
      const own = await p.evaluate(() => state.room.myAction);
      if (p === B) expect(own).toEqual({ skill: '막', targetId: null });
      else expect(own).toBeNull();
    }
    await C.choose('아');
    await A.click('#btn-reveal');
    await Promise.all(players.map((p) => p.waitSummary()));
  });

  test('@smoke F-15 다른 참가자의 공개 ID로 접속해도 그 사람의 자리·선택을 가져갈 수 없음', async ({ game }) => {
    const { code, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await B.choose('순');

    // 상태 메시지에 실리는 ID는 공개 ID뿐이고, 브라우저의 비밀 값과 다르다.
    const bId = await C.evaluate((name) => state.room.players.find((p) => p.nickname === name).id, '비이');
    expect(bId).toBe(B.pid);
    const bSecret = await B.evaluate(() => state.playerId);
    expect(bId).not.toBe(bSecret);
    for (const p of players) {
      const text = p.frames_.map((f) => f.payload).join(' ');
      for (const q of players) {
        const secret = await q.evaluate(() => state.playerId);
        expect(text.includes(secret), `${p.playerName}가 받은 프레임에 ${q.playerName}의 비밀 값이 있음`).toBe(false);
      }
    }

    // 공개 ID를 자기 브라우저의 플레이어 ID로 넣고 방에 들어가 본다.
    const spy = await game.player('엿보기');
    await spy.goto(`${game.base}/`);
    await spy.evaluate((id) => localStorage.setItem('dbg.playerId', id), bId);
    await spy.goto(`${game.base}/room/${code}`);
    await spy.waitScreen('screen-join'); // 참가자로 인정되지 않고 입장 화면
    const peek = await spy.evaluate(() => (state.room ? state.room.myAction : null));
    expect(peek, `B의 공개 ID로 접속하자 B의 비공개 선택이 보임: ${JSON.stringify(peek)}`).toBeNull();
    // 진짜 B는 자리를 빼앗기지 않음
    await expect(B.locator('#screen-notice')).toBeHidden();
    await expect(B.locator('#choice-summary')).toContainText('선택 완료');
  });
});

test.describe('F-16 ~ F-17 결과 확인과 강제 진행', () => {
  test('@smoke F-16 결과 확인은 모든 생존자가 선택했을 때만 활성화, 호스트에게만', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await expect(A.locator('#btn-reveal')).toBeDisabled();
    await expect(B.locator('#btn-reveal')).toBeHidden();
    await A.choose('아');
    await B.choose('아');
    await expect(A.locator('#submit-progress')).toHaveText('선택 완료 2 / 3명');
    await expect(A.locator('#btn-reveal')).toBeDisabled();
    const early = await A.emitAck('round:reveal');
    expect(early.ok).toBe(false);
    await C.choose('아');
    await expect(A.locator('#btn-reveal')).toBeEnabled();
    await expect(A.locator('#btn-force')).toBeHidden();
  });

  test('F-17 강제 진행: 확인 창(취소 가능) → 선택하지 않은 생존자는 막', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await A.choose('파', B);
    await A.click('#btn-force');
    const dialog = A.locator('#force-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('비이');
    await expect(dialog).toContainText('씨이');
    await expect(A.locator('#force-cancel')).toBeFocused();
    await A.click('#force-cancel');
    await expect(dialog).toBeHidden();
    expect(await A.evaluate(() => state.room.status)).toBe('choosing');
    await A.click('#btn-force');
    await A.click('#force-confirm');
    await Promise.all(players.map((p) => p.waitSummary()));
    const r = await A.room();
    expect(r.lastResult.forced.sort()).toEqual([B.pid, C.pid].sort());
    expect(r.lastResult.attacks[0].outcome).toBe('blocked');
  });
});

test.describe('F-06 재접속', () => {
  test('@smoke F-06 선택 중 새로고침: 닉네임·캐릭터·기·생존·선택 완료 복구', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.charge(A, players, players, 1);
    await B.choose('파', A);
    await B.reload();
    await B.waitScreen('screen-round');
    expect(await B.ki()).toBe(2);
    await expect(B.locator('#choice-summary')).toContainText('선택 완료: 💥 파 → 에이');
    await expect(B.locator('#status-list .is-me')).toContainText('비이');
    await expect(B.locator('#status-list .is-me img')).toHaveAttribute('src', '/avatars/char-02.svg');
    await expect(A.locator('#status-list')).toContainText('✔ 선택 완료');
  });

  test('F-06 결과 공개 중 새로고침하면 처음부터 다시 재생하지 않고 이어서 보여줌', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await A.choose('아');
    await B.choose('아');
    await A.click('#btn-reveal');
    await B.waitScreen('screen-reveal');
    await B.waitForTimeout(700);
    await B.reload();
    await B.waitScreen('screen-reveal');
    const phase = await B.evaluate(() => state.reveal.phase);
    expect(['count3', 'count2']).not.toContain(phase);
    await B.waitSummary();
  });

  test('F-06 네트워크가 잠깐 끊겼다 돌아오면 같은 자리로 복귀', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await B.ctx.setOffline(true);
    await B.waitForTimeout(1500);
    await B.ctx.setOffline(false);
    // 끊긴 사이 상태가 바뀌어도(호스트 선택) 복귀 후 이어서 진행 가능
    await A.choose('아');
    await B.choose('아');
    await A.click('#btn-reveal');
    await Promise.all(players.map((p) => p.waitSummary()));
    game.allowErrors.push(/ERR_INTERNET_DISCONNECTED|WebSocket/);
  });

  test('F-23 휴대폰 네트워크가 끊기면 다른 사람 화면에 연결 끊김이 얼마나 빨리 뜨는지 측정', async ({ game }, testInfo) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    const t0 = Date.now();
    await B.ctx.setOffline(true);
    let seenAt = null;
    try {
      await expect(A.locator('#status-list')).toContainText('연결 끊김', { timeout: 60_000 });
      seenAt = Date.now() - t0;
    } catch {
      seenAt = null;
    }
    testInfo.annotations.push({ type: '측정', description: seenAt === null ? '60초 안에 표시 안 됨' : `${seenAt}ms` });
    await B.ctx.setOffline(false);
    game.allowErrors.push(/ERR_INTERNET_DISCONNECTED|WebSocket/);
    expect(seenAt, '네트워크가 끊긴 참가자가 10초 안에 연결 끊김으로 보여야 함').not.toBeNull();
    expect(seenAt).toBeLessThan(10_000);
  });

  test('같은 플레이어가 다른 탭을 열면 새 탭이 자리를 가져가고 이전 탭에 안내', async ({ game }) => {
    const { code, players } = await game.lobby(2);
    const [, B] = players;
    const tab2 = await B.ctx.newPage();
    tab2.on('pageerror', (e) => game.errors.push(`[tab2] ${e.message}`));
    await tab2.goto(`${game.base}/room/${code}`);
    await tab2.locator('#screen-lobby').waitFor();
    await B.waitScreen('screen-notice');
    await B.click('#btn-reopen');
    await B.waitScreen('screen-lobby');
    await tab2.locator('#screen-notice').waitFor();
  });
});
