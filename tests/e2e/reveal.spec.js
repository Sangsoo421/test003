// @ts-check
// F-18 ~ F-21 결과 공개, F-22 ~ F-26 상태창, F-27 ~ F-28 게임 종료와 새 게임
const { test, expect, REAL } = require('./helpers');

// 페이지 안에서 결과 공개 단계가 바뀌는 시각을 기록한다 (같은 PC라 기기 간 시계가 같다).
async function recordPhases(page) {
  await page.evaluate(() => {
    window.__phases = [];
    // 서버의 공개 메시지를 받은 시각 (기기 간 동기화 측정용. 화면 타이머 지연과 무관)
    window.__revealReceived = null;
    socket.on('room:state', (s) => {
      if (s.status === 'revealing' && window.__revealReceived === null) window.__revealReceived = Date.now();
    });
    let last = null;
    setInterval(() => {
      const phase = state.reveal.phase;
      const status = state.room && state.room.status;
      const key = status === 'revealing' ? phase : null;
      if (key !== last) {
        last = key;
        if (key) window.__phases.push([key, Date.now()]);
      }
    }, 5);
  });
}

test.describe('F-18 ~ F-21 결과 공개 (실제 시간 설정 서버)', () => {
  test('@smoke F-18·F-19 모든 기기에서 동시에 같은 순서로, 5초 안에 공개', async ({ game }) => {
    game.base = REAL;
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    for (const p of players) await recordPhases(p);
    await A.choose('파', B);
    await B.choose('막');
    await C.choose('아');
    // 다음 라운드 버튼은 연출이 끝나기 전에는 서버도 거부
    await A.click('#btn-reveal');
    const early = await A.emitAck('round:next');
    expect(early.ok, '연출 도중 다음 라운드 요청은 거부').toBe(false);
    await expect(A.locator('#btn-next')).toBeHidden();
    await Promise.all(players.map((p) => p.waitSummary()));

    const timelines = await Promise.all(players.map((p) => p.evaluate(() => window.__phases)));
    const expected = ['count3', 'count2', 'count1', 'skills', 'attacks', 'impact', 'outs', 'done'];
    for (const t of timelines) expect(t.map(([ph]) => ph)).toEqual(expected);
    const received = await Promise.all(players.map((p) => p.evaluate(() => window.__revealReceived)));
    const spread = Math.max(...received) - Math.min(...received);
    expect(spread, `기기 간 공개 메시지 수신 시각 차이 ${spread}ms`).toBeLessThan(300);
    const starts = timelines.map((t) => t[0][1]);
    const drawSpread = Math.max(...starts) - Math.min(...starts);
    for (const t of timelines) {
      const total = t[t.length - 1][1] - t[0][1];
      expect(total, `공개 연출 전체 ${total}ms`).toBeLessThanOrEqual(5000);
    }
    test.info().annotations.push({
      type: '측정',
      description: `수신 차이 ${spread}ms, 화면 시작 차이 ${drawSpread}ms, 연출 ${timelines.map((t) => t[t.length - 1][1] - t[0][1]).join('/')}ms`,
    });
    await expect(A.locator('#btn-next')).toBeEnabled();
  });

  test('F-19 연출 순서: 카운트다운 숫자 → 기술 공개 → 공격 이펙트·결과 표시 → OUT', async ({ game }) => {
    game.base = REAL;
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await A.choose('파', B);
    await B.choose('아');
    await A.click('#btn-reveal');
    await expect(B.locator('.countdown')).toHaveText('3');
    await expect(B.locator('.reveal-bubble.is-hidden')).toHaveCount(2);
    await B.waitForFunction(() => state.reveal.phase === 'count1', null, { polling: 30 });
    await expect(B.locator('.countdown')).toHaveText('1');
    await expect(B.locator('.reveal-bubble[data-skill="파"]')).toBeVisible();
    await expect(B.locator('.reveal-target')).toHaveText('→ 비이');
    await A.waitForFunction(() => state.reveal.phase === 'attacks', null, { polling: 30 });
    await expect(A.locator('#arena-fx .projectile')).toHaveCount(1);
    await expect(B.locator('.impact-hit')).toContainText('명중');
    await expect(B.locator('.out-stamp')).toHaveText('OUT');
    // 공개 중 상태창은 결과를 미리 보여주지 않는다 → 끝나면 갱신
    await B.waitSummary();
    await expect(B.locator('#status-list .is-out')).toHaveCount(1);
  });

  test('F-20·F-21 라운드 요약, 기 갱신, 호스트에게만 다음 라운드 버튼', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.round(A, [[A, '파', B], [B, '막'], [C, '아']], players);
    const items = await C.locator('#summary-list li').allInnerTexts();
    expect(items).toEqual([
      '💥 에이: 파 → 비이 — 막힘 · 남은 기 0',
      '🛡️ 비이: 막 · 남은 기 1',
      '🔆 씨이: 아 — 기 +1 · 남은 기 2',
    ]);
    await expect(C.locator('#summary-out')).toHaveText('아무도 아웃되지 않았습니다.');
    await expect(A.locator('#btn-next')).toHaveText('다음 라운드');
    await expect(B.locator('#btn-next')).toBeHidden();
    await expect(B.locator('#next-wait')).toBeVisible();
    await expect(A.locator('#status-list')).toContainText('기 2');
    await game.next(A, players);
    await expect(A.locator('#round-title')).toHaveText('라운드 2');
  });
});

test.describe('F-22 ~ F-26 상태창', () => {
  test('@smoke F-22·F-23·F-24 상태창 항목과 선택 완료가 1초 안에 모두에게 반영', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    const items = C.locator('#status-list .status-item');
    await expect(items).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const item = items.nth(i);
      await expect(item.locator('img')).toBeVisible();
      await expect(item).toContainText('기 1');
      await expect(item).toContainText('… 선택 중');
    }
    await expect(items.first().locator('.host-crown')).toBeVisible();

    // 다른 사람 화면에 B의 '선택 완료'가 뜬 시각을 페이지 안에서 기록
    for (const p of [A, C]) {
      await p.evaluate(() => {
        window.__seen = null;
        const list = document.getElementById('status-list');
        new MutationObserver(() => {
          const item = [...list.querySelectorAll('.status-item')].find((li) => li.textContent.includes('비이'));
          if (item && item.textContent.includes('✔ 선택 완료') && window.__seen === null) window.__seen = Date.now();
        }).observe(list, { childList: true, subtree: true, characterData: true });
      });
    }
    await B.click('.skill-btn[data-skill="막"]');
    const t0 = await B.evaluate(() => {
      const t = Date.now();
      document.getElementById('btn-decide').click();
      return t;
    });
    for (const p of [A, C]) await expect.poll(() => p.evaluate(() => window.__seen)).not.toBeNull();
    const seen = await Promise.all([A, C].map((p) => p.evaluate(() => window.__seen)));
    const elapsed = Math.max(...seen) - t0;
    test.info().annotations.push({ type: '측정', description: `선택 완료 표시 반영 ${elapsed}ms` });
    expect(elapsed).toBeLessThan(1000);
  });

  test('F-23 연결이 끊긴 참가자는 상태창에 연결 끊김 표시', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B] = players;
    await game.start(players);
    await B.close();
    await expect(A.locator('#status-list .status-item').nth(1)).toContainText('📵 연결 끊김');
  });

  test('F-25·F-26 아웃된 참가자: 흑백 + OUT, 본인에게 아웃 안내와 관전 화면, 새 게임에서 복귀', async ({ game }) => {
    const { host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.round(A, [[A, '파', B], [B, '아'], [C, '막']], players);
    await game.next(A, players);
    const outItem = A.locator('#status-list .status-item').nth(1);
    await expect(outItem).toContainText('OUT');
    const filter = await outItem.locator('.avatar').evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('grayscale');
    await expect(B.locator('#out-notice')).toContainText('아웃되었습니다');
    await expect(B.locator('#choice-area')).toBeHidden();
    await expect(B.locator('#status-list')).toBeVisible();
    // 게임 끝내고 새 게임
    await game.round(A, [[A, '아'], [C, '파', A]], players);
    await game.next(A, players, 'screen-end');
    await A.click('#btn-new-game');
    await Promise.all(players.map((p) => p.waitScreen('screen-round')));
    await expect(A.locator('#status-list .is-out')).toHaveCount(0);
    await expect(B.locator('#choice-area')).toBeVisible();
  });
});

test.describe('F-27 ~ F-28 게임 종료와 새 게임', () => {
  test('@smoke F-27 승자를 크게, 탈락 순서대로 순위 / F-28 새 게임은 모두 생존·기 1·관전자 참가', async ({ game }) => {
    test.setTimeout(240_000); // Windows용 WebKit은 느리다
    const { code, host: A, players } = await game.lobby(3);
    const [, B, C] = players;
    await game.start(players);
    await game.round(A, [[A, '파', C], [B, '아'], [C, '아']], players);
    await game.next(A, players);
    const late = await game.player('늦은이');
    await late.join(code, '늦은이', 9);
    const everyone = [...players, late];
    await game.round(A, [[A, '아'], [B, '파', A]], everyone);
    await expect(A.locator('#btn-next')).toContainText('최종 결과 보기');
    await game.next(A, everyone, 'screen-end');

    await expect(C.locator('#end-title')).toHaveText('승리!');
    await expect(C.locator('.winner-name')).toHaveText('비이 승리!');
    const winnerImg = C.locator('.winner-avatar img');
    await expect(winnerImg).toHaveAttribute('src', '/avatars/char-02.svg');
    expect((await winnerImg.boundingBox()).width).toBeGreaterThanOrEqual(120);
    const rows = await C.locator('#ranking-list li').allInnerTexts();
    expect(rows.map((r) => r.replace(/\s+/g, ' ').trim())).toEqual([
      '🥇 1위 비이 생존',
      '🥈 2위 에이 2라운드 아웃',
      '🥉 3위 씨이 1라운드 아웃',
    ]);
    await expect(B.locator('#btn-new-game')).toBeHidden();

    await A.click('#btn-new-game');
    await Promise.all(everyone.map((p) => p.waitScreen('screen-round')));
    for (const p of everyone) {
      await expect(p.locator('#round-title')).toHaveText('라운드 1');
      expect(await p.ki()).toBe(1);
      await expect(p.locator('#choice-area')).toBeVisible();
    }
    await expect(A.locator('#status-list .status-item')).toHaveCount(4);
  });

  test('S-07 → S-04 대기실로 돌아가기', async ({ game }) => {
    const { host: A, players } = await game.lobby(2);
    const [, B] = players;
    await game.start(players);
    await game.round(A, [[A, '파', B], [B, '아']], players);
    await game.next(A, players, 'screen-end');
    await A.click('#btn-to-lobby');
    await Promise.all(players.map((p) => p.waitScreen('screen-lobby')));
  });

  test('§9 8명이 동시에 접속해 한 게임을 끝까지 (선택 완료·공개가 모든 기기에서 일치)', async ({ game }) => {
    test.skip(test.info().project.name !== 'android-chrome', '무거운 테스트는 한 프로젝트에서만');
    test.setTimeout(240_000);
    const { host: A, players } = await game.lobby(8);
    await game.start(players);
    // 1라운드: 모두 아 → 2라운드: 호스트가 한 명씩 파로 정리, 나머지는 아
    await game.round(A, players.map((p) => [p, '아']), players);
    await game.next(A, players);
    let alive = [...players];
    let guard = 0;
    while (alive.length > 1 && guard++ < 20) {
      // 호스트는 기가 있으면 마지막 생존자를 파로 공격, 없으면 아로 모은다. 나머지는 모두 아.
      const target = alive[alive.length - 1];
      const attack = (await A.ki()) >= 1;
      const choices = alive.map((p) => (p === A ? (attack ? [p, '파', target] : [p, '아']) : [p, '아']));
      const r = await game.round(A, choices, players);
      // 모든 기기가 같은 결과를 받았는지
      const seen = await Promise.all(players.map((p) => p.evaluate(() => JSON.stringify(state.room.lastResult))));
      expect(new Set(seen).size).toBe(1);
      expect(r.eliminated).toEqual(attack ? [target.pid] : []);
      if (attack) alive = alive.filter((p) => p !== target);
      await game.next(A, players, alive.length > 1 ? 'screen-round' : 'screen-end');
    }
    await expect(players[5].locator('.winner-name')).toHaveText('에이 승리!');
    await expect(players[5].locator('#ranking-list li')).toHaveCount(8);
  });
});
