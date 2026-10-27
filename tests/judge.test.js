'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { judge, validateAction, SKILLS } = require('../server/judge');

// spec 예: { A: ['파', 'B'], B: ['아'] } — 기는 넉넉하게 10개로 둔다.
function run(spec, ki = {}) {
  const players = Object.keys(spec).map((id) => ({ id, ki: ki[id] ?? 10 }));
  const actions = {};
  for (const [id, a] of Object.entries(spec)) {
    if (a) actions[id] = { skill: a[0], targetId: a[1] ?? null };
  }
  return judge(players, actions);
}

function out(result) {
  return [...result.eliminated].sort();
}

function outcomeOf(result, attackerId) {
  return result.attacks.find((a) => a.attackerId === attackerId).outcome;
}

// ---------- PRD §3.4 판정 예시 12개 ----------
test('§3.4-1 A: 파→B / B: 아 → B 아웃', () => {
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['아'] })), ['B']);
});

test('§3.4-2 A: 파→B / B: 막 → 아무도 아웃 안 됨', () => {
  const r = run({ A: ['파', 'B'], B: ['막'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'blocked');
});

test('§3.4-3 A: 파→B / B: 파→A → 상쇄', () => {
  const r = run({ A: ['파', 'B'], B: ['파', 'A'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'clash');
  assert.equal(outcomeOf(r, 'B'), 'clash');
});

test('§3.4-4 A: 파→B / B: 파→C / C: 막 → B 아웃', () => {
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['파', 'C'], C: ['막'] })), ['B']);
});

test('§3.4-5 A: 에→B / B: 파→A → B 아웃, A 생존', () => {
  const r = run({ A: ['에', 'B'], B: ['파', 'A'] });
  assert.deepEqual(out(r), ['B']);
  assert.equal(outcomeOf(r, 'B'), 'overpowered');
});

test('§3.4-6 A: 에→B / B: 막 → B 아웃', () => {
  assert.deepEqual(out(run({ A: ['에', 'B'], B: ['막'] })), ['B']);
});

test('§3.4-7 A: 에→B / B: 에→A → 상쇄', () => {
  const r = run({ A: ['에', 'B'], B: ['에', 'A'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'clash');
});

test('§3.4-8 A: 에→B / B: 순 → B 생존', () => {
  const r = run({ A: ['에', 'B'], B: ['순'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'dodged');
});

test('§3.4-9 A: 에→B / B: 아 / C: 파→A → A, B 모두 아웃', () => {
  assert.deepEqual(out(run({ A: ['에', 'B'], B: ['아'], C: ['파', 'A'] })), ['A', 'B']);
});

test('§3.4-10 A: 순파→B / B: 순 → B 아웃', () => {
  assert.deepEqual(out(run({ A: ['순파', 'B'], B: ['순'] })), ['B']);
});

test('§3.4-11 A: 순파→B / B: 아 → 아무도 아웃 안 됨', () => {
  const r = run({ A: ['순파', 'B'], B: ['아'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'no_effect');
});

test('§3.4-12 A: 순파→B / B: 순파→A → 상쇄', () => {
  const r = run({ A: ['순파', 'B'], B: ['순파', 'A'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'clash');
});

// ---------- §3.3 상성표: 공격 3종 × 방어 6종 ----------
const DEFENDS = {
  // 공격 기술: { P가 쓴 기술(대상은 공격자): 방어 성공 여부 }
  파: { 아: false, 막: true, 파: true, 에: true, 순: true, 순파: true },
  에: { 아: false, 막: false, 파: false, 에: true, 순: true, 순파: true },
  순파: { 아: true, 막: true, 파: true, 에: true, 순: false, 순파: true },
};

for (const [attack, table] of Object.entries(DEFENDS)) {
  for (const [defense, survives] of Object.entries(table)) {
    test(`상성표: ${attack} → P(${defense}, A를 겨눔) → P ${survives ? '생존' : '아웃'}`, () => {
      const target = SKILLS[defense].attack ? 'A' : null;
      const r = run({ A: [attack, 'P'], P: [defense, target] });
      assert.equal(r.eliminated.includes('P'), !survives);
    });
  }
}

// ---------- 추가 경우 ----------
test('여러 명에게 동시에 공격받으면 하나라도 못 막을 때 아웃', () => {
  // B의 막은 A의 파는 막지만 C의 에는 못 막는다.
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['막'], C: ['에', 'B'] })), ['B']);
});

test('여러 명의 공격을 모두 막으면 생존', () => {
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['순'], C: ['에', 'B'] })), []);
});

test("서로 다른 사람을 겨눈 '에'끼리는 상쇄되지 않음", () => {
  // A 에→B, B 에→C, C 막 → B는 A를 겨누지 않았으므로 아웃, C도 에를 못 막아 아웃
  assert.deepEqual(out(run({ A: ['에', 'B'], B: ['에', 'C'], C: ['막'] })), ['B', 'C']);
});

test("3명 이상일 때 '에'를 써도 다른 참가자의 '파'에 맞으면 아웃 (§3.3)", () => {
  assert.deepEqual(out(run({ A: ['에', 'B'], B: ['막'], C: ['파', 'A'] })), ['A', 'B']);
});

test("'순'은 '순파'에 맞아 아웃", () => {
  assert.deepEqual(out(run({ A: ['순파', 'B'], B: ['순'], C: ['막'] })), ['B']);
});

test("'막'은 '순파'를 받아도 생존", () => {
  assert.deepEqual(out(run({ A: ['순파', 'B'], B: ['막'] })), []);
});

test("'순파'를 쓴 사람은 대상과 관계없이 '파'와 '에'를 피함", () => {
  const r = run({ A: ['파', 'C'], B: ['에', 'C'], C: ['순파', 'D'], D: ['막'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'dodged');
  assert.equal(outcomeOf(r, 'B'), 'dodged');
  assert.equal(outcomeOf(r, 'C'), 'no_effect');
});

test("서로 다른 사람을 겨눈 '순파'를 받아도 '순파' 사용자는 피함 (§10 #3)", () => {
  const r = run({ A: ['순파', 'B'], B: ['순파', 'C'], C: ['막'] });
  assert.deepEqual(out(r), []);
  assert.equal(outcomeOf(r, 'A'), 'dodged');
});

test('공격자가 같은 라운드에 아웃돼도 그 공격은 유효', () => {
  // A는 C에게 맞아 아웃되지만 A의 파도 B를 아웃시킨다.
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['아'], C: ['파', 'A'] })), ['A', 'B']);
});

test('전원 동시 아웃 (무승부 상황)', () => {
  assert.deepEqual(out(run({ A: ['파', 'B'], B: ['파', 'C'], C: ['파', 'A'] })), ['A', 'B', 'C']);
});

test('선택이 없는 참가자는 막으로 처리 (F-17 강제 진행)', () => {
  const r = run({ A: ['파', 'B'], B: null });
  assert.deepEqual(out(r), []);
  assert.equal(r.actions.find((a) => a.playerId === 'B').skill, '막');
});

// ---------- 기 계산 (§3.2) ----------
test('기 소모: 아 +1, 막 0, 파 -1, 에 -3, 순 -1, 순파 -2', () => {
  const r = run(
    { A: ['아'], B: ['막'], C: ['파', 'B'], D: ['에', 'B'], E: ['순'], F: ['순파', 'B'] },
    { A: 0, B: 0, C: 1, D: 3, E: 1, F: 2 },
  );
  assert.deepEqual(r.ki, { A: 1, B: 0, C: 0, D: 0, E: 0, F: 0 });
});

test('공격이 막혀도 기는 소모됨', () => {
  const r = run({ A: ['파', 'B'], B: ['막'] }, { A: 1, B: 0 });
  assert.equal(r.ki.A, 0);
});

test('기 상한 없음', () => {
  const r = run({ A: ['아'], B: ['막'] }, { A: 99, B: 0 });
  assert.equal(r.ki.A, 100);
});

test('입력을 바꾸지 않는 순수 함수', () => {
  const players = [{ id: 'A', ki: 1 }, { id: 'B', ki: 1 }];
  const actions = { A: { skill: '파', targetId: 'B' }, B: { skill: '아', targetId: null } };
  const before = JSON.stringify({ players, actions });
  judge(players, actions);
  assert.equal(JSON.stringify({ players, actions }), before);
});

// ---------- 선택 검증 ----------
const alive = [{ id: 'A', ki: 1 }, { id: 'B', ki: 1 }, { id: 'C', ki: 1 }];

test('검증: 기가 모자란 기술은 거부', () => {
  assert.ok(validateAction(alive[0], { skill: '에', targetId: 'B' }, alive));
  assert.ok(validateAction(alive[0], { skill: '순파', targetId: 'B' }, alive));
  assert.equal(validateAction(alive[0], { skill: '파', targetId: 'B' }, alive), null);
});

test("검증: '아'로 얻을 기는 같은 라운드에 쓸 수 없음 (기 0이면 파 불가)", () => {
  assert.ok(validateAction({ id: 'A', ki: 0 }, { skill: '파', targetId: 'B' }, alive));
});

test('검증: 공격 대상은 자신이 아닌 생존자', () => {
  assert.ok(validateAction(alive[0], { skill: '파', targetId: 'A' }, alive));
  assert.ok(validateAction(alive[0], { skill: '파', targetId: 'Z' }, alive));
  assert.ok(validateAction(alive[0], { skill: '파' }, alive));
});

test('검증: 없는 기술, 대상이 필요 없는 기술에 대상 지정은 거부', () => {
  assert.ok(validateAction(alive[0], { skill: '카' }, alive));
  assert.ok(validateAction(alive[0], { skill: '막', targetId: 'B' }, alive));
  assert.ok(validateAction(alive[0], null, alive));
  assert.equal(validateAction(alive[0], { skill: '막', targetId: null }, alive), null);
});

// ---------- 기술 이름 파싱·검증 강화 ----------
const { parseSkill, parseAction, safeKi } = require('../server/judge');
const PROTO_NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];

test('기술 이름: 객체 속성 이름(__proto__ 등)은 기술이 아님', () => {
  for (const name of PROTO_NAMES) {
    assert.equal(parseSkill(name), null, name);
    assert.equal(SKILLS[name], undefined, name);
    assert.ok(validateAction(alive[0], { skill: name }, alive), name);
  }
});

test('기술 이름: 문자열이 아니거나 너무 길면 거부', () => {
  for (const bad of [undefined, null, 1, true, {}, ['파'], { toString: () => '파' }, '파'.repeat(20), '']) {
    assert.equal(parseSkill(bad), null, String(bad));
    assert.ok(validateAction(alive[0], { skill: bad }, alive));
  }
});

test('기술 이름: 앞뒤 공백과 조합형 한글(NFD)은 정규화해서 받음', () => {
  assert.equal(parseSkill(' 파 '), '파');
  assert.equal(parseSkill('파'.normalize('NFD')), '파');
  assert.equal(parseSkill('순파'.normalize('NFD')), '순파');
});

test('선택 형식: 객체가 아니거나 대상이 문자열이 아니면 거부', () => {
  for (const bad of [null, '파', ['파', 'B'], 42]) assert.ok(parseAction(bad).error);
  assert.ok(parseAction({ skill: '파', targetId: { id: 'B' } }).error);
  assert.ok(parseAction({ skill: '파', targetId: 7 }).error);
  assert.ok(parseAction({ skill: '파', targetId: 'x'.repeat(65) }).error);
  assert.deepEqual(parseAction({ skill: ' 파', targetId: 'B' }).action, { skill: '파', targetId: 'B' });
});

test('판정 fallback: 정의되지 않은 기술은 막으로 처리, 기는 숫자로 유지', () => {
  const players = [{ id: 'A', ki: 1 }, { id: 'B', ki: 1 }];
  for (const name of [...PROTO_NAMES, '카', 123]) {
    const r = judge(players, { A: { skill: name, targetId: null }, B: { skill: '파', targetId: 'A' } });
    assert.equal(r.actions[0].skill, '막', String(name));
    assert.equal(r.attacks[0].outcome, 'blocked');
    assert.deepEqual(r.ki, { A: 1, B: 0 });
  }
});

test('기 값이 깨져 있으면 0으로 보고 비용 검사·차감', () => {
  for (const ki of [NaN, undefined, null, -1, 1.5, '3', Infinity]) {
    assert.equal(safeKi(ki), 0, String(ki));
    assert.ok(validateAction({ id: 'A', ki }, { skill: '파', targetId: 'B' }, alive), `ki=${ki}에서 파가 통과되면 안 됨`);
    const r = judge([{ id: 'A', ki }, { id: 'B', ki: 0 }], { A: { skill: '아' }, B: { skill: '막' } });
    assert.equal(r.ki.A, 1, String(ki));
  }
});

test('actions의 키가 __proto__여도 판정이 오염되지 않음', () => {
  const actions = JSON.parse('{"__proto__": {"skill": "에", "targetId": "B"}, "A": {"skill": "아"}}');
  const r = judge([{ id: 'A', ki: 0 }, { id: 'B', ki: 0 }], actions);
  assert.deepEqual(r.eliminated, []);
  assert.equal(r.actions[1].skill, '막');
});
