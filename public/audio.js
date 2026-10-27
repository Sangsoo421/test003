'use strict';

// 배경음악과 효과음 (F-30~F-33). 음원 파일 없이 Web Audio API로 직접 합성한다 (CREDITS.md 참고).
// 모바일 자동 재생 제한 때문에 AudioContext는 사용자가 처음 누른 순간에 만든다 (F-33).
const Sound = (() => {
  const STORAGE_KEY = 'dbg.music';
  const LOOKAHEAD_S = 0.12;

  // 음 이름 → 주파수
  const NOTE_INDEX = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
  function freq(note) {
    const m = note.match(/^([A-G]#?)(\d)$/);
    return 440 * 2 ** ((NOTE_INDEX[m[1]] + (Number(m[2]) - 4) * 12) / 12);
  }

  // 16분음표 단위 스텝 시퀀서용 곡 정의. 4마디(64스텝) 반복.
  const TRACKS = {
    // 게임 중: 긴장감 있는 단조, 빠른 템포
    battle: {
      bpm: 150,
      chords: [
        ['A2', ['A3', 'C4', 'E4']],
        ['F2', ['F3', 'A3', 'C4']],
        ['G2', ['G3', 'B3', 'D4']],
        ['E2', ['E3', 'G#3', 'B3']],
      ],
      step(s, t, len, chordIndex) {
        const [bass, notes] = this.chords[chordIndex];
        const beat = s % 16;
        if (beat % 4 === 0) kick(t);
        if (beat === 4 || beat === 12) snare(t);
        if (beat % 2 === 0) hat(t, 0.05);
        if (beat % 2 === 0) tone(freq(bass) * (beat % 4 === 2 ? 2 : 1), t, len * 1.6, 'sawtooth', 0.11, 600);
        const arp = [0, 1, 2, 1][s % 4];
        tone(freq(notes[arp]) * 2, t, len * 0.9, 'square', 0.035, 2400);
        if (beat === 0) tone(freq(notes[2]) * 2, t, len * 14, 'triangle', 0.05, 3000);
      },
    },
    // 대기실·결과: 밝고 느긋한 분위기
    lobby: {
      bpm: 96,
      chords: [
        ['C3', ['C4', 'E4', 'G4', 'B4']],
        ['A2', ['A3', 'C4', 'E4', 'G4']],
        ['F2', ['F3', 'A3', 'C4', 'E4']],
        ['G2', ['G3', 'B3', 'D4', 'F4']],
      ],
      step(s, t, len, chordIndex) {
        const [bass, notes] = this.chords[chordIndex];
        const beat = s % 16;
        if (beat === 0) {
          for (const n of notes) tone(freq(n), t, len * 15, 'triangle', 0.035, 1800);
          tone(freq(bass), t, len * 6, 'sine', 0.12, 800);
        }
        if (beat === 8) tone(freq(bass), t, len * 6, 'sine', 0.09, 800);
        if (beat % 4 === 2) hat(t, 0.025);
        if ([0, 3, 6, 10, 12].includes(beat)) tone(freq(notes[(s >> 1) % notes.length]) * 2, t, len * 1.5, 'sine', 0.05, 4000);
      },
    },
  };

  let ctx = null;
  let musicGain = null;
  let sfxGain = null;
  let noiseBuffer = null;
  let enabled = readPref();
  let wanted = null; // 지금 재생되어야 하는 곡 이름
  let playing = null;
  let timer = null;
  let nextTime = 0;
  let stepIndex = 0;

  function readPref() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  }

  function writePref() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // 저장이 막혀 있으면 이번 접속 동안만 유지한다.
    }
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      ctx = new AudioCtx();
    } catch {
      return null;
    }
    const master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.5;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.8;
    sfxGain.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // ---------- 악기 ----------
  function tone(f, t, dur, type, gain, cutoff, dest = musicGain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(lp).connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, gain, filterType, filterFreq, dest = musicGain) {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    src.buffer = noiseBuffer;
    f.type = filterType;
    f.frequency.value = filterFreq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function kick(t, dest = musicGain, gain = 0.5) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  function snare(t) {
    noise(t, 0.12, 0.18, 'highpass', 1500);
    tone(190, t, 0.08, 'triangle', 0.08, 2000);
  }

  function hat(t, gain) {
    noise(t, 0.04, gain, 'highpass', 7000);
  }

  // ---------- 배경음악 스케줄러 ----------
  function stopMusic() {
    clearInterval(timer);
    timer = null;
    playing = null;
  }

  function startMusic(name) {
    stopMusic();
    if (!name || !ctx) return;
    playing = name;
    stepIndex = 0;
    nextTime = ctx.currentTime + 0.05;
    const track = TRACKS[name];
    const stepLen = 60 / track.bpm / 4;
    timer = setInterval(() => {
      while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
        const s = stepIndex % 64;
        track.step(s, nextTime, stepLen, Math.floor(s / 16));
        nextTime += stepLen;
        stepIndex += 1;
      }
    }, 25);
  }

  function sync() {
    if (!ctx) return;
    const target = enabled ? wanted : null;
    if (target !== playing) startMusic(target);
  }

  // ---------- 효과음 ----------
  const SFX = {
    count() {
      tone(880, ctx.currentTime, 0.15, 'square', 0.12, 3000, sfxGain);
    },
    reveal() {
      const t = ctx.currentTime;
      for (const n of ['A4', 'C#5', 'E5']) tone(freq(n), t, 0.35, 'sawtooth', 0.06, 3000, sfxGain);
    },
    attack() {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = noiseBuffer;
      f.type = 'bandpass';
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      src.connect(f).connect(g).connect(sfxGain);
      src.start(t);
      src.stop(t + 0.5);
    },
    hit() {
      const t = ctx.currentTime;
      kick(t, sfxGain, 0.8);
      noise(t, 0.35, 0.3, 'lowpass', 900, sfxGain);
    },
    block() {
      tone(1320, ctx.currentTime, 0.25, 'triangle', 0.12, 5000, sfxGain);
    },
    out() {
      const t = ctx.currentTime;
      tone(freq('E3'), t, 0.25, 'sawtooth', 0.08, 1200, sfxGain);
      tone(freq('C3'), t + 0.18, 0.4, 'sawtooth', 0.08, 1200, sfxGain);
    },
    win() {
      const t = ctx.currentTime;
      ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone(freq(n), t + i * 0.12, 0.5, 'square', 0.06, 4000, sfxGain));
    },
  };

  return {
    // 사용자가 처음 화면을 누른 순간 호출 (F-33)
    unlock() {
      if (!ensureContext()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      sync();
    },
    setTrack(name) {
      wanted = name;
      sync();
    },
    play(name) {
      if (!enabled || !ctx || ctx.state !== 'running' || !SFX[name]) return;
      SFX[name]();
    },
    isEnabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      writePref();
      if (enabled) this.unlock();
      sync();
      return enabled;
    },
    // 탭이 가려지면 소리를 멈춘다.
    setVisible(visible) {
      if (!ctx) return;
      if (visible) ctx.resume().catch(() => {});
      else ctx.suspend().catch(() => {});
    },
  };
})();
