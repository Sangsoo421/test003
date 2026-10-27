'use strict';

// 판정 로직 (PRD §3.2~3.3). 입출력이 없는 순수 함수만 둔다.

// 프로토타입이 없는 고정 객체라서 '__proto__', 'constructor', 'toString' 같은 이름으로 조회해도 아무것도 나오지 않는다.
const SKILLS = Object.freeze(Object.assign(Object.create(null), {
  아: Object.freeze({ cost: 0, gain: 1, attack: false }),
  막: Object.freeze({ cost: 0, gain: 0, attack: false }),
  파: Object.freeze({ cost: 1, gain: 0, attack: true }),
  에: Object.freeze({ cost: 3, gain: 0, attack: true }),
  순: Object.freeze({ cost: 1, gain: 0, attack: false }),
  순파: Object.freeze({ cost: 2, gain: 0, attack: true }),
}));

// 선택하지 않은 참가자는 '막'으로 처리한다 (F-17).
const DEFAULT_SKILL = '막';

const MAX_SKILL_NAME = 8;
const MAX_ID_LENGTH = 64;

// 기술 이름을 정규화한다. 문자열이 아니거나 정의된 기술이 아니면 null.
function parseSkill(name) {
  if (typeof name !== 'string' || name.length > MAX_SKILL_NAME) return null;
  const normalized = name.normalize('NFC').trim();
  return Object.prototype.hasOwnProperty.call(SKILLS, normalized) ? normalized : null;
}

// 기 값이 깨져 있으면(NaN, 음수, 소수, 숫자 아님) 0으로 본다. 기가 모자란 기술이 통과되지 않게 하는 안전장치.
function safeKi(ki) {
  return Number.isSafeInteger(ki) && ki >= 0 ? ki : 0;
}

// 클라이언트가 보낸 선택을 정규화한다. 형식이 틀리면 { error }.
function parseAction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '기술을 골라 주세요.' };
  const skill = parseSkill(raw.skill);
  if (!skill) return { error: '없는 기술입니다.' };
  const target = raw.targetId ?? null;
  if (target !== null && (typeof target !== 'string' || target.length === 0 || target.length > MAX_ID_LENGTH)) {
    return { error: '대상이 올바르지 않습니다.' };
  }
  return { action: { skill, targetId: target } };
}

// 공격 하나의 결과
//   hit         명중 (대상 아웃)
//   blocked     '막'에 막힘
//   dodged      '순'·'순파'로 피함
//   clash       서로를 겨눈 같은 기술끼리 상쇄
//   overpowered 대상이 공격자를 겨눈 '에'로 '파'를 이겨냄
//   no_effect   '순파'가 '순' 이외의 기술을 쓴 대상에게는 효과 없음
function resolveAttack(attackerId, skill, defense) {
  const aimsBack = defense.targetId === attackerId;
  if (skill === '파') {
    if (defense.skill === '막') return 'blocked';
    if (defense.skill === '순' || defense.skill === '순파') return 'dodged';
    if (defense.skill === '파' && aimsBack) return 'clash';
    if (defense.skill === '에' && aimsBack) return 'overpowered';
    return 'hit';
  }
  if (skill === '에') {
    if (defense.skill === '순' || defense.skill === '순파') return 'dodged';
    if (defense.skill === '에' && aimsBack) return 'clash';
    return 'hit';
  }
  // 순파: '순'을 쓴 사람만 아웃시킨다.
  if (defense.skill === '순') return 'hit';
  if (defense.skill === '순파') return aimsBack ? 'clash' : 'dodged';
  return 'no_effect';
}

// 선택 하나가 규칙에 맞는지 확인한다. 맞으면 null, 아니면 이유를 돌려준다.
// player: { id, ki }, alivePlayers: 이번 라운드 생존자 목록
function validateAction(player, rawAction, alivePlayers) {
  const { action, error } = parseAction(rawAction);
  if (error) return error;
  const skill = SKILLS[action.skill];
  if (safeKi(player.ki) < skill.cost) return `기가 모자랍니다. (${action.skill}: 기 ${skill.cost}개 필요)`;
  const targetId = action.targetId;
  if (!skill.attack) {
    return targetId === null ? null : `'${action.skill}'은 대상을 고르지 않습니다.`;
  }
  if (targetId === null) return '공격할 대상을 골라 주세요.';
  if (targetId === player.id) return '자기 자신은 공격할 수 없습니다.';
  if (!alivePlayers.some((p) => p.id === targetId)) return '살아 있는 참가자만 공격할 수 있습니다.';
  return null;
}

// players: 이번 라운드 생존자 [{ id, ki }]
// actions: { [playerId]: { skill, targetId } } — 없는 사람, 정의되지 않은 기술은 '막'으로 처리(fallback)
// 모든 공격은 동시에 처리한다. 같은 라운드에 아웃되는 사람의 공격도 유효하다.
function judge(players, actions) {
  const chosen = Object.create(null);
  for (const p of players) {
    const a = Object.prototype.hasOwnProperty.call(actions, p.id) ? actions[p.id] : null;
    const skill = a ? parseSkill(a.skill) : null;
    chosen[p.id] = skill
      ? { skill, targetId: SKILLS[skill].attack ? a.targetId ?? null : null }
      : { skill: DEFAULT_SKILL, targetId: null };
  }

  const attacks = [];
  const hit = new Set();
  for (const p of players) {
    const { skill, targetId } = chosen[p.id];
    if (!SKILLS[skill].attack) continue;
    const defense = typeof targetId === 'string' ? chosen[targetId] : undefined;
    if (!defense) throw new Error(`잘못된 공격 대상: ${p.id} → ${targetId}`);
    const outcome = resolveAttack(p.id, skill, defense);
    attacks.push({ attackerId: p.id, targetId, skill, outcome });
    if (outcome === 'hit') hit.add(targetId);
  }

  // 공격 기술은 결과와 상관없이 기를 소모하고, '아'로 얻은 기는 판정 후에 더한다.
  const ki = {};
  for (const p of players) {
    const s = SKILLS[chosen[p.id].skill];
    ki[p.id] = Math.max(0, safeKi(p.ki) - s.cost) + s.gain;
  }

  return {
    actions: players.map((p) => ({ playerId: p.id, ...chosen[p.id] })),
    attacks,
    eliminated: players.filter((p) => hit.has(p.id)).map((p) => p.id),
    ki,
  };
}

module.exports = { SKILLS, DEFAULT_SKILL, judge, validateAction, resolveAttack, parseSkill, parseAction, safeKi };
