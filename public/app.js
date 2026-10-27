'use strict';

const NICKNAME_MAX = 10;
const MIN_PLAYERS = 2;
const STORAGE_PLAYER_ID = 'dbg.playerId';
const STORAGE_RULES_SEEN = 'dbg.rulesSeen';

// 서버 server/judge.js의 SKILLS와 같은 값 (화면 표시용. 판정과 검증은 서버가 한다)
const SKILLS = [
  { name: '아', icon: '🔆', cost: 0, attack: false, effect: '기 +1' },
  { name: '막', icon: '🛡️', cost: 0, attack: false, effect: '파를 막음' },
  { name: '파', icon: '💥', cost: 1, attack: true, effect: '1명 공격' },
  { name: '에', icon: '🔥', cost: 3, attack: true, effect: '강한 공격' },
  { name: '순', icon: '💨', cost: 1, attack: false, effect: '파·에 피함' },
  { name: '순파', icon: '🌀', cost: 2, attack: true, effect: '순을 공격' },
];
const SKILL_BY_NAME = Object.fromEntries(SKILLS.map((s) => [s.name, s]));

const OUTCOME_TEXT = {
  hit: '명중! 아웃',
  blocked: '막힘',
  dodged: '피함',
  clash: '상쇄',
  overpowered: "'에'에 밀림",
  no_effect: '효과 없음',
};

// 결과 공개 때 대상 카드에 붙는 표시. 색과 함께 아이콘·글자로 구분한다.
const IMPACT_LABEL = {
  hit: '💥 명중',
  blocked: '🛡️ 막음',
  dodged: '💨 피함',
  clash: '⚡ 상쇄',
  overpowered: '🔥 파를 이김',
  no_effect: '· 효과 없음',
};

const AVATAR_BY_ID = Object.fromEntries(AVATARS.map((a) => [a.id, a]));

const STATUS_SCREEN = {
  lobby: 'screen-lobby',
  choosing: 'screen-round',
  revealing: 'screen-reveal',
  finished: 'screen-end',
};

// 화면별 배경음악 (F-30). 결과 공개 중에는 음악을 멈추고 효과음만 낸다.
const STATUS_TRACK = {
  lobby: 'lobby',
  choosing: 'battle',
  revealing: null,
  finished: 'lobby',
};

// 결과 공개 연출 단계 (F-19). 전체 길이(revealMs)에 대한 비율로 나눈다.
// ① 카운트다운 → ② 기술 공개 → ③ 공격 이펙트(날아감 → 맞음) → ④ 아웃 표시
const REVEAL_PHASES = [
  { name: 'count3', until: 0.13 },
  { name: 'count2', until: 0.26 },
  { name: 'count1', until: 0.39 },
  { name: 'skills', until: 0.58 },
  { name: 'attacks', until: 0.72 },
  { name: 'impact', until: 0.86 },
  { name: 'outs', until: 1 },
];
const PHASE_ORDER = [...REVEAL_PHASES.map((p) => p.name), 'done'];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const $ = (id) => document.getElementById(id);

// ---------- 저장소 ----------
function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장이 막혀 있어도 게임은 계속한다.
  }
}

// crypto.randomUUID는 http://내부IP 같은 비보안 환경에서 없으므로 getRandomValues를 쓴다.
function newPlayerId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadPlayerId() {
  let id = readStorage(STORAGE_PLAYER_ID);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = newPlayerId();
    writeStorage(STORAGE_PLAYER_ID, id);
  }
  return id;
}

// ---------- 상태 ----------
const state = {
  playerId: loadPlayerId(),
  code: null, // 지금 보고 있는 방 코드
  room: null, // 서버가 보낸 publicState
  selectedAvatar: null,
  takenAvatars: [],
  rulesOpen: false,
  currentScreen: null,
  pick: { round: 0, skill: null, targetId: null }, // 결정 전에 고르고 있는 기술
  reveal: { key: null, phase: null, timer: null },
  celebratedKey: null, // 승리 연출을 이미 보여준 게임
};

const socket = io({ auth: { playerId: state.playerId } });

// ---------- 공통 ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((node) => {
    node.hidden = node.id !== id;
  });
  if (state.currentScreen !== id) {
    state.currentScreen = id;
    const heading = $(id).querySelector('h1, h2');
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

let toastTimer = null;
function toast(message) {
  $('toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').textContent = '';
  }, 3000);
}

// 응답이 실패면 안내를 띄운다.
function emit(event, payload) {
  socket.emit(event, payload, (res) => {
    if (res && !res.ok) toast(res.error);
  });
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function avatarName(avatarId) {
  return AVATAR_BY_ID[avatarId] ? AVATAR_BY_ID[avatarId].name : '';
}

function createAvatar(avatarId) {
  // 진행만 하는 호스트는 캐릭터가 없다.
  if (!avatarId) {
    const host = el('span', '🎙️', 'avatar avatar-host');
    host.setAttribute('aria-hidden', 'true');
    return host;
  }
  const wrap = el('span', undefined, 'avatar');
  const img = document.createElement('img');
  img.src = `/avatars/${avatarId}.svg`;
  img.alt = '';
  img.decoding = 'async';
  wrap.appendChild(img);
  return wrap;
}

function createBadge(text, className = '') {
  return el('span', text, `badge ${className}`.trim());
}

function me() {
  const room = state.room;
  return room ? room.players.find((p) => p.id === room.you) || null : null;
}

function playingCount(room) {
  return room.players.filter((p) => p.playing).length;
}

function playerById(id) {
  return state.room.players.find((p) => p.id === id);
}

function nameOf(id) {
  const p = playerById(id);
  return p ? p.nickname : '(나간 참가자)';
}

// ---------- 음악 (F-30~F-33) ----------
function renderMusicButton() {
  const on = Sound.isEnabled();
  const btn = $('btn-music');
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('.icon').textContent = on ? '🔊' : '🔇';
  btn.querySelector('.label').textContent = on ? '음악 켜짐' : '음악 꺼짐';
}

$('btn-music').addEventListener('click', () => {
  Sound.toggle();
  renderMusicButton();
});

// 모바일 자동 재생 제한: 사용자가 처음 누른 순간부터 재생한다 (F-33).
['pointerdown', 'keydown'].forEach((type) => {
  document.addEventListener(type, () => Sound.unlock(), { capture: true });
});

document.addEventListener('visibilitychange', () => Sound.setVisible(!document.hidden));

// ---------- 시작 화면 (S-01) ----------
function goStart(errorMessage) {
  state.code = null;
  state.room = null;
  stopReveal();
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  $('start-error').textContent = errorMessage || '';
  render();
  showScreen('screen-start');
}

$('btn-create').addEventListener('click', () => {
  socket.emit('room:create', (res) => {
    if (!res || !res.ok) return goStart((res && res.error) || '방을 만들지 못했습니다. 다시 시도해 주세요.');
    history.pushState(null, '', `/room/${res.code}`);
    enterRoom(res.code);
  });
});

$('form-code').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('input-code').value.trim().toUpperCase();
  if (!code) {
    $('start-error').textContent = '방 코드를 입력해 주세요.';
    return;
  }
  history.pushState(null, '', `/room/${encodeURIComponent(code)}`);
  enterRoom(code);
});

// ---------- 방 들어가기 ----------
function enterRoom(code) {
  state.code = code;
  socket.emit('room:enter', { code }, (res) => {
    if (!res || !res.ok) return goStart(res && res.error);
    // 이미 참가한 사람은 서버가 room:state를 보내 자리로 돌려보낸다 (F-06).
    if (!res.member) showJoin(res);
  });
}

// ---------- 입장 화면 (S-02) ----------
function showJoin(info) {
  state.room = null;
  state.code = info.code;
  stopReveal();
  $('join-code').textContent = info.code;
  $('join-error').textContent = '';
  $('host-only-option').hidden = !info.canHostOnly;
  if (!info.canHostOnly) $('input-host-only').checked = false;
  updateHostOnly();
  updateJoinInfo(info);
  render();
  showScreen('screen-join');
}

// F-05 관전 안내, 최대 인원 안내, 다른 사람이 고른 캐릭터 갱신
function updateJoinInfo({ status, takenAvatars, full }) {
  state.takenAvatars = takenAvatars || [];
  if (state.takenAvatars.includes(state.selectedAvatar)) state.selectedAvatar = null;
  const notice = $('join-notice');
  if (full) {
    notice.textContent = '방이 가득 찼습니다. (최대 8명)';
  } else if (status && status !== 'lobby') {
    notice.textContent = '게임이 진행 중입니다. 입장하면 관전하다가 다음 게임부터 참가합니다.';
  } else {
    notice.textContent = '';
  }
  notice.hidden = !notice.textContent;
  $('btn-join').disabled = Boolean(full) && !$('input-host-only').checked;
  renderAvatarGrid();
}

function selectAvatar(id) {
  state.selectedAvatar = id;
  $('avatar-grid').querySelectorAll('.avatar-option').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.avatar === id));
  });
}

function renderAvatarGrid() {
  const grid = $('avatar-grid');
  grid.replaceChildren();
  for (const avatar of AVATARS) {
    const taken = state.takenAvatars.includes(avatar.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-option';
    btn.dataset.avatar = avatar.id;
    btn.disabled = taken;
    btn.setAttribute('aria-pressed', String(state.selectedAvatar === avatar.id));
    btn.setAttribute('aria-label', `${avatar.name}${taken ? ' (다른 참가자가 선택함)' : ''}`);
    const img = document.createElement('img');
    img.src = `/avatars/${avatar.id}.svg`;
    img.alt = '';
    btn.appendChild(img);
    btn.appendChild(el('span', avatar.name));
    if (taken) btn.appendChild(el('span', '선택됨', 'taken'));
    btn.addEventListener('click', () => selectAvatar(avatar.id));
    grid.appendChild(btn);
  }
}

// 진행만 하면 캐릭터를 고르지 않는다.
function updateHostOnly() {
  $('avatar-fieldset').hidden = $('input-host-only').checked;
}

$('input-host-only').addEventListener('change', updateHostOnly);

$('btn-random').addEventListener('click', () => {
  const free = AVATARS.filter((a) => !state.takenAvatars.includes(a.id));
  if (free.length) selectAvatar(free[Math.floor(Math.random() * free.length)].id);
});

socket.on('room:avatars', (info) => {
  if (info.code === state.code && state.currentScreen === 'screen-join') updateJoinInfo(info);
});

$('form-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const nickname = $('input-nickname').value.trim();
  const length = [...nickname].length;
  if (length < 1 || length > NICKNAME_MAX) {
    $('join-error').textContent = `닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.`;
    return;
  }
  const hostOnly = !$('host-only-option').hidden && $('input-host-only').checked;
  if (!hostOnly && !state.selectedAvatar) {
    $('join-error').textContent = '캐릭터를 골라 주세요.';
    return;
  }
  $('btn-join').disabled = true;
  const avatarId = hostOnly ? null : state.selectedAvatar;
  socket.emit('room:join', { code: state.code, nickname, avatarId, hostOnly }, (res) => {
    $('btn-join').disabled = false;
    if (!res || !res.ok) {
      if (res && res.takenAvatars) {
        state.takenAvatars = res.takenAvatars;
        if (state.takenAvatars.includes(state.selectedAvatar)) state.selectedAvatar = null;
        renderAvatarGrid();
      }
      $('join-error').textContent = (res && res.error) || '입장하지 못했습니다.';
      return;
    }
    // F-08: 처음 입장한 사람에게 룰 안내를 한 번 보여준다.
    if (!readStorage(STORAGE_RULES_SEEN)) {
      writeStorage(STORAGE_RULES_SEEN, '1');
      state.rulesOpen = true;
    }
  });
});

// ---------- 룰 안내 (S-03) ----------
$('btn-rules').addEventListener('click', () => {
  state.rulesOpen = true;
  if (state.room) {
    render();
  } else {
    // 방에 들어가기 전(시작·입장 화면)에는 닫으면 보던 화면으로 돌아간다.
    if (state.currentScreen !== 'screen-rules') $('btn-rules').dataset.returnTo = state.currentScreen;
    showScreen('screen-rules');
  }
});

$('btn-rules-close').addEventListener('click', () => {
  state.rulesOpen = false;
  if (state.room) {
    render();
  } else {
    showScreen($('btn-rules').dataset.returnTo || 'screen-start');
  }
});

// ---------- 대기실 (S-04) ----------
function playerMeta(p, room, { compact = false } = {}) {
  const meta = el('div', undefined, 'player-meta');
  meta.appendChild(el('span', p.nickname, 'player-name'));
  const badges = el('div', undefined, 'badges');
  if (!compact && p.id === room.hostId) badges.appendChild(createBadge('👑 호스트', 'badge-host'));
  if (!p.playing) badges.appendChild(createBadge('🎙️ 진행만'));
  if (p.id === room.you) badges.appendChild(createBadge('나', 'badge-me'));
  if (!p.connected) badges.appendChild(createBadge('📵 연결 끊김', 'badge-off'));
  meta.appendChild(badges);
  return { meta, badges };
}

function renderLobby(room) {
  const list = $('lobby-players');
  list.replaceChildren();
  for (const p of room.players) {
    const li = document.createElement('li');
    li.appendChild(createAvatar(p.avatarId));
    li.appendChild(playerMeta(p, room).meta);
    list.appendChild(li);
  }
  $('lobby-code').textContent = room.code;
  $('lobby-count').textContent = `참가자 ${playingCount(room)}명 / 최대 8명`;
  $('share-link').value = shareLink(room);
  const qrSrc = `/qr/${room.code}`;
  if ($('qr-image').getAttribute('src') !== qrSrc) $('qr-image').src = qrSrc;
  const enough = playingCount(room) >= MIN_PLAYERS;
  $('btn-start').disabled = !enough;
  $('start-hint').textContent = enough ? '' : `참가자가 ${MIN_PLAYERS}명 이상이어야 시작할 수 있습니다.`;
}

function shareLink(room) {
  return `${room.shareOrigin || location.origin}/room/${room.code}`;
}

$('btn-copy').addEventListener('click', async () => {
  const input = $('share-link');
  let copied = false;
  // navigator.clipboard는 보안 환경(https, localhost)에서만 동작한다.
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(input.value);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied) {
    input.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }
  $('copy-status').textContent = copied ? '✔ 링크를 복사했습니다.' : '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.';
});

$('btn-start').addEventListener('click', () => emit('game:start'));

// ---------- 상태창 (F-22~F-25) ----------
// 공개 연출 중에는 아직 공개되지 않은 결과(아웃, 기 변화)를 미리 보여주지 않는다.
function displayedPlayers(room) {
  const result = room.lastResult;
  const phase = state.reveal.phase;
  if (room.status !== 'revealing' || !result || phase === 'done') return room.players;
  return room.players.map((p) => {
    const action = result.actions.find((a) => a.playerId === p.id);
    if (!action) return p;
    const skill = SKILL_BY_NAME[action.skill];
    const kiBefore = p.ki + skill.cost - (action.skill === '아' ? 1 : 0);
    return { ...p, ki: kiBefore, alive: phase === 'outs' ? p.alive : true };
  });
}

function renderStatusPanel(room) {
  const list = $('status-list');
  list.replaceChildren();
  for (const p of displayedPlayers(room)) {
    const li = el('li', undefined, 'status-item');
    if (p.inGame && !p.alive) li.classList.add('is-out');
    if (p.id === room.you) li.classList.add('is-me');
    if (p.id === room.hostId) {
      const crown = el('span', '👑', 'host-crown');
      crown.setAttribute('role', 'img');
      crown.setAttribute('aria-label', '호스트');
      li.appendChild(crown);
    }
    li.appendChild(createAvatar(p.avatarId));
    const { meta, badges } = playerMeta(p, room, { compact: true });
    if (!p.playing) {
      // 진행만 하는 호스트: "진행만" 배지는 playerMeta가 붙인다.
    } else if (!p.inGame) {
      badges.prepend(createBadge('관전'));
    } else {
      const status = [];
      status.push(createBadge(`기 ${p.ki}`, 'badge-ki'));
      if (!p.alive) {
        status.push(createBadge('OUT', 'badge-out'));
      } else if (room.status === 'choosing') {
        status.push(p.submitted ? createBadge('✔ 선택 완료', 'badge-done') : createBadge('… 선택 중', 'badge-wait'));
      }
      badges.prepend(...status);
    }
    li.appendChild(meta);
    list.appendChild(li);
  }
}

// ---------- 라운드 선택 (S-05) ----------
function renderRound(room) {
  const self = me();
  $('round-title').textContent = `라운드 ${room.round}`;
  $('my-ki').textContent = self && self.inGame ? self.ki : '-';
  document.querySelector('.my-ki').hidden = Boolean(self && !self.playing);

  const canPlay = Boolean(self && self.inGame && self.alive);
  $('choice-area').hidden = !canPlay;
  $('out-notice').hidden = !(self && self.inGame && !self.alive); // F-26
  $('spectator-notice').hidden = !(self && self.playing && !self.inGame); // F-05
  $('host-only-notice').hidden = !(self && !self.playing);

  if (canPlay) {
    // 새 라운드면 고르던 것을 비우고, 재접속이면 결정한 선택을 되살린다.
    if (state.pick.round !== room.round) state.pick = { round: room.round, skill: null, targetId: null };
    if (room.myAction) state.pick = { round: room.round, ...room.myAction };
    renderChoice(room, self);
  }

  const alive = room.players.filter((p) => p.inGame && p.alive);
  const done = alive.filter((p) => p.submitted).length;
  $('submit-progress').textContent = `선택 완료 ${done} / ${alive.length}명`;
  $('btn-reveal').disabled = done < alive.length; // F-16
  $('btn-force').hidden = done === alive.length; // F-17
}

function renderChoice(room, self) {
  const decided = Boolean(room.myAction);
  const pick = state.pick;

  const skillBox = $('skill-buttons');
  skillBox.replaceChildren();
  for (const s of SKILLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'skill-btn';
    btn.dataset.skill = s.name;
    const lacking = self.ki < s.cost;
    if (lacking) btn.classList.add('is-lacking');
    btn.disabled = lacking || decided;
    btn.setAttribute('aria-pressed', String(pick.skill === s.name));
    btn.appendChild(el('span', s.icon, 'skill-icon')).setAttribute('aria-hidden', 'true');
    btn.appendChild(el('span', s.name, 'skill-name'));
    btn.appendChild(el('span', lacking ? `🔒 기 ${s.cost}개 필요` : `기 ${s.cost} · ${s.effect}`, 'skill-cost'));
    btn.addEventListener('click', () => {
      state.pick = { round: room.round, skill: s.name, targetId: s.attack ? pick.targetId : null };
      renderRound(state.room);
    });
    skillBox.appendChild(btn);
  }

  // F-13: 공격 기술이면 자신을 제외한 생존자 중에서 캐릭터로 대상을 고른다.
  const attack = pick.skill && SKILL_BY_NAME[pick.skill].attack;
  $('target-area').hidden = !attack;
  const targetBox = $('target-buttons');
  targetBox.replaceChildren();
  if (attack) {
    const targets = room.players.filter((p) => p.inGame && p.alive && p.id !== room.you);
    if (!targets.some((p) => p.id === pick.targetId)) pick.targetId = null;
    for (const p of targets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'target-btn';
      btn.dataset.target = p.id;
      btn.disabled = decided;
      btn.setAttribute('aria-pressed', String(pick.targetId === p.id));
      btn.appendChild(createAvatar(p.avatarId));
      btn.appendChild(el('span', p.nickname));
      btn.addEventListener('click', () => {
        state.pick.targetId = p.id;
        renderRound(state.room);
      });
      targetBox.appendChild(btn);
    }
  }

  const ready = Boolean(pick.skill) && (!attack || Boolean(pick.targetId));
  let summary = '';
  if (pick.skill) {
    const icon = SKILL_BY_NAME[pick.skill].icon;
    summary = attack && pick.targetId ? `${icon} ${pick.skill} → ${nameOf(pick.targetId)}` : `${icon} ${pick.skill}`;
  }
  $('choice-summary').textContent = decided
    ? `✔ 선택 완료: ${summary} (결과 확인 전까지 바꿀 수 있어요)`
    : summary
      ? `고른 기술: ${summary}${attack && !pick.targetId ? ' — 대상을 골라 주세요' : ''}`
      : '기술을 골라 주세요.';
  $('btn-decide').hidden = decided;
  $('btn-decide').disabled = !ready;
  $('btn-change').hidden = !decided;
}

$('btn-decide').addEventListener('click', () => {
  const { round, skill, targetId } = state.pick;
  emit('round:submit', { round, skill, targetId });
});

$('btn-change').addEventListener('click', () => emit('round:cancel', { round: state.room.round }));

$('btn-reveal').addEventListener('click', () => emit('round:reveal'));

// F-17: 강제 진행 확인 창
$('btn-force').addEventListener('click', () => {
  const waiting = state.room.players.filter((p) => p.inGame && p.alive && !p.submitted);
  const names = waiting.map((p) => p.nickname).join(', ');
  $('force-message').textContent = `아직 선택하지 않은 ${waiting.length}명(${names})은 '막'을 쓴 것으로 처리돼요.`;
  $('force-dialog').showModal();
  $('force-cancel').focus();
});

$('force-cancel').addEventListener('click', () => $('force-dialog').close());

$('force-confirm').addEventListener('click', () => {
  $('force-dialog').close();
  emit('round:force');
});

// ---------- 결과 공개 (S-06, F-18~F-21) ----------
function phaseAt(elapsed, total) {
  const ratio = elapsed / total;
  const phase = REVEAL_PHASES.find((p) => ratio < p.until);
  return phase ? phase.name : 'done';
}

function phaseReached(name) {
  return PHASE_ORDER.indexOf(state.reveal.phase) >= PHASE_ORDER.indexOf(name);
}

function stopReveal() {
  clearInterval(state.reveal.timer);
  state.reveal.timer = null;
}

// 서버가 보낸 경과 시간 기준으로 재생해, 모든 기기가 같은 순서·시간으로 본다.
// 연출 도중 새로고침하면 남은 부분부터 이어서 보여준다.
function startReveal(room) {
  const key = `${room.code}:${room.lastResult.revealedAt}`;
  if (state.reveal.key === key) return;
  stopReveal();
  state.reveal.key = key;
  const startedAt = performance.now() - (room.revealElapsedMs || 0);
  const total = room.revealMs;
  const currentPhase = () => phaseAt(performance.now() - startedAt, total);
  // 첫 단계는 지금 그리는 render()가 그대로 쓰고, 이후 단계가 바뀔 때마다 다시 그린다.
  state.reveal.phase = currentPhase();
  if (state.reveal.phase === 'done') return;
  if (state.reveal.phase === 'count3') Sound.play('count');
  state.reveal.timer = setInterval(() => {
    const phase = currentPhase();
    if (phase === state.reveal.phase) return;
    state.reveal.phase = phase;
    if (phase === 'done') stopReveal();
    render();
    onPhaseEnter(phase, state.room, total);
  }, 30);
}

// 단계가 실제로 바뀌는 순간에만 효과음과 날아가는 이펙트를 낸다.
function onPhaseEnter(phase, room, total) {
  if (!room || room.status !== 'revealing') return;
  const result = room.lastResult;
  if (phase.startsWith('count')) Sound.play('count');
  if (phase === 'skills') Sound.play('reveal');
  if (phase === 'attacks' && result.attacks.length) {
    Sound.play('attack');
    launchProjectiles(result, total * 0.14);
  }
  if (phase === 'impact') {
    if (result.attacks.some((a) => a.outcome === 'hit')) Sound.play('hit');
    else if (result.attacks.length) Sound.play('block');
  }
  if (phase === 'outs' && result.eliminated.length) Sound.play('out');
}

function cardCenter(playerId) {
  const card = $('arena-cards').querySelector(`[data-player="${playerId}"]`);
  if (!card) return null;
  const box = $('arena').getBoundingClientRect();
  const avatar = card.querySelector('.avatar').getBoundingClientRect();
  return { x: avatar.left - box.left + avatar.width / 2, y: avatar.top - box.top + avatar.height / 2 };
}

// ③ 공격 연출: 공격자 캐릭터에서 대상으로 날아간다. 서로를 겨눈 상쇄는 가운데에서 부딪힌다.
function launchProjectiles(result, duration) {
  if (reducedMotion.matches) return;
  const fx = $('arena-fx');
  fx.replaceChildren();
  for (const atk of result.attacks) {
    const from = cardCenter(atk.attackerId);
    const to = cardCenter(atk.targetId);
    if (!from || !to) continue;
    const end = atk.outcome === 'clash' ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : to;
    const dot = el('div', undefined, 'projectile');
    dot.dataset.skill = atk.skill;
    dot.style.setProperty('--c', `var(--skill-${{ 파: 'pa', 에: 'e', 순파: 'sunpa' }[atk.skill]})`);
    dot.style.left = `${from.x}px`;
    dot.style.top = `${from.y}px`;
    fx.appendChild(dot);
    const anim = dot.animate(
      [
        { transform: 'translate(0, 0) scale(0.6)', opacity: 0.6 },
        { transform: `translate(${end.x - from.x}px, ${end.y - from.y}px) scale(1.2)`, opacity: 1 },
      ],
      { duration, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' },
    );
    anim.onfinish = () => dot.remove();
  }
}

function actionText(action) {
  const target = action.targetId ? ` → ${nameOf(action.targetId)}` : '';
  return `${nameOf(action.playerId)}: ${action.skill}${target}`;
}

function renderArena(room) {
  const result = room.lastResult;
  const cards = $('arena-cards');
  cards.replaceChildren();
  const players = room.players.filter((p) => result.actions.some((a) => a.playerId === p.id));
  cards.style.setProperty('--cols', String(Math.min(4, Math.max(2, Math.ceil(Math.sqrt(players.length * 1.5))))));
  const showSkills = phaseReached('skills');
  const showImpact = phaseReached('impact');
  const showOuts = phaseReached('outs');

  for (const p of players) {
    const action = result.actions.find((a) => a.playerId === p.id);
    const card = el('div', undefined, 'arena-card');
    card.dataset.player = p.id;
    card.appendChild(createAvatar(p.avatarId));
    card.appendChild(el('span', p.nickname, 'player-name'));

    const bubble = el('span', undefined, 'reveal-bubble');
    if (showSkills) {
      const skill = SKILL_BY_NAME[action.skill];
      bubble.dataset.skill = action.skill;
      bubble.textContent = `${skill.icon} ${action.skill}`;
      if (state.reveal.phase === 'skills') bubble.classList.add('pop');
    } else {
      bubble.textContent = '?';
      bubble.classList.add('is-hidden');
    }
    card.appendChild(bubble);
    if (showSkills && action.targetId) card.appendChild(el('span', `→ ${nameOf(action.targetId)}`, 'reveal-target'));

    if (showImpact) {
      const incoming = result.attacks.filter((a) => a.targetId === p.id);
      if (incoming.length) {
        const impacts = el('div', undefined, 'impact-list');
        for (const atk of incoming) {
          impacts.appendChild(el('span', IMPACT_LABEL[atk.outcome], `impact impact-${atk.outcome}`));
        }
        card.appendChild(impacts);
        if (state.reveal.phase === 'impact') {
          if (incoming.some((a) => a.outcome === 'hit')) card.classList.add('is-hit');
          else if (incoming.some((a) => a.outcome === 'dodged')) card.classList.add('is-dodge');
        }
      }
    }
    if (showOuts && result.eliminated.includes(p.id)) {
      card.classList.add('is-out');
      card.appendChild(el('span', 'OUT', 'out-stamp'));
    }
    cards.appendChild(card);
  }
}

function renderReveal(room) {
  const result = room.lastResult;
  const phase = state.reveal.phase;
  renderArena(room);

  // 카운트다운 숫자는 무대 위에 크게, 단계 설명은 무대 아래에 글로 (화면 낭독기도 읽도록)
  const stage = $('reveal-stage');
  stage.replaceChildren();
  const counting = Boolean(phase && phase.startsWith('count'));
  $('arena').classList.toggle('is-counting', counting);
  if (counting) stage.appendChild(el('p', phase.slice(-1), 'countdown'));
  let caption = '';
  if (counting) caption = `${phase.slice(-1)}…`;
  else if (phase === 'skills') caption = '기술 공개!';
  else if (phase === 'attacks') caption = result.attacks.length ? '공격!' : '공격 없음';
  else if (phase === 'impact') {
    caption = result.attacks.map((a) => `${nameOf(a.attackerId)}의 ${a.skill}: ${OUTCOME_TEXT[a.outcome]}`).join(' / ') || '이번 라운드에는 공격이 없습니다.';
  } else if (phase === 'outs') caption = outText(result);
  $('reveal-caption').textContent = caption;

  const done = phase === 'done';
  $('reveal-summary').hidden = !done;
  if (done) renderSummary(result);
  $('reveal-title').textContent = `라운드 ${result.round} 결과`;
  $('btn-next').textContent = result.gameOver ? '🏆 최종 결과 보기' : '다음 라운드';
  $('btn-next').disabled = !done;
  $('btn-next').hidden = !room.isHost || !done;
  $('next-wait').hidden = room.isHost || !done;
}

function outText(result) {
  if (!result.eliminated.length) return '아무도 아웃되지 않았습니다.';
  return `OUT: ${result.eliminated.map(nameOf).join(', ')}`;
}

// F-20: 누가 누구에게 무엇을 썼고 결과가 어땠는지
function renderSummary(result) {
  const list = $('summary-list');
  list.replaceChildren();
  for (const a of result.actions) {
    let text = `${SKILL_BY_NAME[a.skill].icon} ${actionText(a)}`;
    const atk = result.attacks.find((x) => x.attackerId === a.playerId);
    if (atk) text += ` — ${OUTCOME_TEXT[atk.outcome]}`;
    if (a.skill === '아') text += ' — 기 +1';
    if (result.forced.includes(a.playerId)) text += ' (선택하지 않아 막 처리)';
    const p = playerById(a.playerId);
    if (p) text += ` · 남은 기 ${p.ki}`;
    list.appendChild(el('li', text));
  }
  $('summary-out').textContent = outText(result);
}

$('btn-next').addEventListener('click', () => emit('round:next'));

// ---------- 게임 종료 (S-07, F-27~F-28) ----------
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

function renderEnd(room) {
  const result = room.lastResult;
  const winnerBox = $('end-winner');
  winnerBox.replaceChildren();
  if (result && result.winnerId) {
    const w = playerById(result.winnerId);
    $('end-title').textContent = '승리!';
    const avatarWrap = el('div', undefined, 'winner-avatar');
    avatarWrap.appendChild(el('span', '👑', 'crown')).setAttribute('aria-hidden', 'true');
    if (w) avatarWrap.appendChild(createAvatar(w.avatarId));
    winnerBox.appendChild(avatarWrap);
    winnerBox.appendChild(el('p', `${nameOf(result.winnerId)} 승리!`, 'winner-name'));
    if (w) winnerBox.appendChild(el('p', `캐릭터: ${avatarName(w.avatarId)}`, 'muted'));
  } else {
    $('end-title').textContent = '무승부';
    const group = el('div', undefined, 'draw-avatars');
    for (const r of room.ranking || []) {
      const p = playerById(r.playerId);
      if (p && r.rank === 1) group.appendChild(createAvatar(p.avatarId));
    }
    winnerBox.appendChild(group);
    winnerBox.appendChild(el('p', '모두 동시에 아웃되어 무승부!', 'winner-name'));
  }

  const list = $('ranking-list');
  list.replaceChildren();
  for (const r of room.ranking || []) {
    const li = document.createElement('li');
    if (r.rank === 1) li.classList.add('is-first');
    const p = playerById(r.playerId);
    li.appendChild(el('span', `${MEDALS[r.rank] || ''} ${r.rank}위`.trim(), 'rank'));
    if (p) li.appendChild(createAvatar(p.avatarId));
    li.appendChild(el('span', nameOf(r.playerId), 'player-name'));
    li.appendChild(el('span', r.eliminatedRound === null ? '생존' : `${r.eliminatedRound}라운드 아웃`, 'hint'));
    list.appendChild(li);
  }
  $('btn-new-game').disabled = playingCount(room) < MIN_PLAYERS;

  // 승리 연출은 게임마다 한 번만
  const key = result ? `${room.code}:${result.revealedAt}` : null;
  if (key && state.celebratedKey !== key) {
    state.celebratedKey = key;
    Sound.play('win');
    if (!reducedMotion.matches) burstConfetti();
  }
}

function burstConfetti() {
  const box = $('confetti');
  box.replaceChildren();
  const colors = ['var(--accent)', 'var(--primary)', 'var(--sky)', 'var(--skill-e)', 'var(--skill-sun)'];
  for (let i = 0; i < 36; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    box.appendChild(piece);
  }
}

$('btn-new-game').addEventListener('click', () => emit('game:start'));
$('btn-to-lobby').addEventListener('click', () => emit('game:lobby'));

// ---------- 서버 상태 반영 ----------
function render() {
  const room = state.room;
  $('topbar-code').textContent = state.code ? `방 ${state.code}` : '';
  const inGame = Boolean(room) && (room.status === 'choosing' || room.status === 'revealing');
  $('status-panel').hidden = !inGame || state.rulesOpen;
  Sound.setTrack(room ? STATUS_TRACK[room.status] : 'lobby');
  if (!room) return;

  document.querySelectorAll('.host-only').forEach((node) => {
    if (node.id !== 'btn-next') node.hidden = !room.isHost;
  });
  document.querySelectorAll('.guest-only').forEach((node) => {
    if (node.id !== 'next-wait') node.hidden = room.isHost;
  });
  if (room.status !== 'choosing' && $('force-dialog').open) $('force-dialog').close();

  if (room.status === 'revealing') startReveal(room);
  else stopReveal();

  if (inGame) renderStatusPanel(room);
  if (room.status === 'lobby') renderLobby(room);
  if (room.status === 'choosing') renderRound(room);
  if (room.status === 'revealing') renderReveal(room);
  if (room.status === 'finished') renderEnd(room);

  showScreen(state.rulesOpen ? 'screen-rules' : STATUS_SCREEN[room.status]);
}

socket.on('room:state', (room) => {
  if (room.code !== state.code) return;
  // 게임 단계가 바뀌면 열어 둔 룰 안내를 닫고 새 화면을 보여준다.
  if (state.room && state.room.status !== room.status) state.rulesOpen = false;
  state.room = room;
  render();
});

socket.on('fatal', (message) => goStart(message));

// 같은 플레이어가 다른 탭에서 들어왔다. 이 탭은 자동으로 다시 붙지 않게 연결을 끊는다.
socket.on('session:replaced', () => {
  socket.disconnect();
  stopReveal();
  state.room = null;
  render();
  showScreen('screen-notice');
});

$('btn-reopen').addEventListener('click', () => location.reload());

// 다시 연결되면(서버 재시작, 네트워크 끊김) 지금 방에 다시 들어간다.
socket.io.on('reconnect', () => {
  if (state.code) enterRoom(state.code);
});

// ---------- 주소에 따라 첫 화면 결정 ----------
function route() {
  const match = location.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (match) {
    enterRoom(decodeURIComponent(match[1]).toUpperCase());
  } else {
    goStart();
  }
}

renderMusicButton();
window.addEventListener('popstate', route);
route();
