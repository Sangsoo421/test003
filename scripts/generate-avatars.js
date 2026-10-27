'use strict';

// 오리지널 무술가 캐릭터 20개를 SVG로 만든다 (PRD §8, §10 #11).
// 원작 캐릭터를 닮지 않게 뾰족 머리, 주황 도복 같은 원작의 대표 특징은 쓰지 않는다.
// 실행: node scripts/generate-avatars.js → public/avatars/char-01.svg ~ char-20.svg, public/avatar-data.js
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'avatars');
const DATA_FILE = path.join(__dirname, '..', 'public', 'avatar-data.js');

const SKIN = ['#f6d3b3', '#eab68c', '#d39a6a', '#a8714a', '#7a4e33'];
const HAIR = {
  black: '#1f1d29',
  brown: '#6b3e26',
  auburn: '#9c3d27',
  sand: '#d9b56a',
  gray: '#a3a8b0',
  plum: '#5b2a5e',
  teal: '#1f5f63',
};

// [이름, 피부, 머리 모양, 머리색, 도복, 배경, 눈, 입, 장식]
const SPECS = [
  ['강철', 0, 'short', 'black', '#c62839', '#2b3d8f', 'fierce', 'flat', 'headband'],
  ['노을', 1, 'ponytail', 'auburn', '#3b4bb3', '#f08a4b', 'happy', 'smile', ''],
  ['번개', 2, 'mohawk', 'sand', '#1c1c24', '#ffd23f', 'fierce', 'grin', ''],
  ['해솔', 0, 'bob', 'brown', '#2f8f5b', '#9ad0ec', 'round', 'smile', ''],
  ['다온', 3, 'buzz', 'black', '#f2f2f2', '#c24d8a', 'calm', 'smile', 'headband'],
  ['바위', 4, 'bald', 'black', '#6b4f3a', '#7d8a99', 'calm', 'flat', 'beard'],
  ['하늬', 1, 'twinbuns', 'black', '#d64a7a', '#5ec6c9', 'happy', 'open', ''],
  ['청풍', 2, 'topknot', 'gray', '#28536b', '#c3d66b', 'calm', 'flat', 'beard'],
  ['도담', 0, 'curly', 'brown', '#8a3fa8', '#ffb347', 'round', 'grin', ''],
  ['보라', 1, 'long', 'plum', '#efe6d2', '#6b4fd1', 'calm', 'smile', ''],
  ['무쇠', 3, 'short', 'black', '#40454f', '#e05a47', 'fierce', 'flat', 'scar'],
  ['새벽', 0, 'long', 'teal', '#1d3557', '#f4a7b9', 'round', 'smile', 'headband'],
  ['가람', 4, 'topknot', 'black', '#b8322a', '#61a0e8', 'fierce', 'grin', ''],
  ['별찌', 2, 'twinbuns', 'sand', '#2a9d8f', '#3d2c6b', 'happy', 'open', ''],
  ['산들', 1, 'curly', 'auburn', '#e9c46a', '#2f6b4f', 'happy', 'smile', ''],
  ['초롱', 0, 'bob', 'black', '#7b2d42', '#ffd166', 'round', 'open', 'glasses'],
  ['한결', 3, 'buzz', 'gray', '#264653', '#e76f51', 'calm', 'flat', 'beard'],
  ['우레', 4, 'mohawk', 'plum', '#f2f2f2', '#2b2d42', 'fierce', 'grin', 'headband'],
  ['소나기', 2, 'ponytail', 'black', '#5a7d2a', '#b5a3e8', 'round', 'smile', ''],
  ['은빛', 0, 'short', 'gray', '#3a3f8f', '#7fd6a8', 'happy', 'smile', 'glasses'],
];

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

// 머리 뒤쪽(얼굴 뒤에 그릴 부분)과 앞쪽
function hair(style, color) {
  const dark = shade(color, -25);
  const cap = `<path d="M31 44 C30 26 40 19 50 19 C60 19 70 26 69 44 C64 34 57 31 50 31 C43 31 36 34 31 44 Z" fill="${color}"/>`;
  switch (style) {
    case 'short':
      return { back: '', front: cap };
    case 'buzz':
      return { back: '', front: `<path d="M32 40 C32 27 41 22 50 22 C59 22 68 27 68 40 C62 33 56 31 50 31 C44 31 38 33 32 40 Z" fill="${color}" opacity="0.85"/>` };
    case 'topknot':
      return { back: '', front: `${cap}<circle cx="50" cy="16" r="7" fill="${color}"/><rect x="45" y="20" width="10" height="4" rx="2" fill="${dark}"/>` };
    case 'ponytail':
      return { back: `<path d="M64 32 C80 36 82 56 74 68 C72 56 70 46 62 40 Z" fill="${dark}"/>`, front: cap };
    case 'bob':
      return { back: `<path d="M29 46 C27 24 40 17 50 17 C60 17 73 24 71 46 L71 60 L63 60 L63 42 L37 42 L37 60 L29 60 Z" fill="${dark}"/>`, front: cap };
    case 'bald':
      return { back: '', front: `<path d="M38 28 C42 25 46 24 50 24" stroke="#fff" stroke-opacity="0.35" stroke-width="3" fill="none" stroke-linecap="round"/>` };
    case 'twinbuns':
      return { back: `<circle cx="33" cy="24" r="8" fill="${dark}"/><circle cx="67" cy="24" r="8" fill="${dark}"/>`, front: cap };
    case 'long':
      return { back: `<path d="M30 40 C28 22 40 17 50 17 C60 17 72 22 70 40 L74 78 L62 76 L62 44 L38 44 L38 76 L26 78 Z" fill="${dark}"/>`, front: cap };
    case 'mohawk':
      return { back: '', front: `<path d="M44 34 C44 20 47 12 50 10 C53 12 56 20 56 34 C54 31 52 30 50 30 C48 30 46 31 44 34 Z" fill="${color}"/>` };
    case 'curly':
      return {
        back: '',
        front: [
          [36, 30], [43, 24], [50, 22], [57, 24], [64, 30], [33, 38], [67, 38],
        ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${color}"/>`).join(''),
      };
    default:
      return { back: '', front: cap };
  }
}

function eyes(kind) {
  const ink = '#1b1b24';
  switch (kind) {
    case 'fierce':
      return `<path d="M37 40 L46 43" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><path d="M63 40 L54 43" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="42" cy="47" r="2.4" fill="${ink}"/><circle cx="58" cy="47" r="2.4" fill="${ink}"/>`;
    case 'happy':
      return `<path d="M38 47 Q42 43 46 47" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M54 47 Q58 43 62 47" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case 'round':
      return `<circle cx="42" cy="46" r="3.6" fill="#fff"/><circle cx="58" cy="46" r="3.6" fill="#fff"/><circle cx="42.5" cy="46.5" r="2.2" fill="${ink}"/><circle cx="58.5" cy="46.5" r="2.2" fill="${ink}"/>`;
    default: // calm
      return `<path d="M38 46 L46 46" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M54 46 L62 46" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
}

function mouth(kind) {
  const ink = '#5a2b2b';
  switch (kind) {
    case 'grin':
      return `<path d="M43 55 Q50 61 57 55 Z" fill="#fff" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
    case 'open':
      return `<ellipse cx="50" cy="57" rx="3.6" ry="3" fill="${ink}"/>`;
    case 'flat':
      return `<path d="M45 57 L55 57" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`;
    default: // smile
      return `<path d="M44 55 Q50 60 56 55" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }
}

function extra(kind, hairColor) {
  switch (kind) {
    case 'headband':
      return '<rect x="31" y="34" width="38" height="5" rx="2" fill="#e63946"/><path d="M68 36 L78 32 L76 40 Z" fill="#e63946"/>';
    case 'beard':
      return `<path d="M36 52 C38 66 46 68 50 68 C54 68 62 66 64 52 C60 60 55 61 50 61 C45 61 40 60 36 52 Z" fill="${hairColor}"/>`;
    case 'glasses':
      return '<circle cx="42" cy="46" r="5.5" fill="none" stroke="#1b1b24" stroke-width="1.8"/><circle cx="58" cy="46" r="5.5" fill="none" stroke="#1b1b24" stroke-width="1.8"/><path d="M47.5 46 L52.5 46" stroke="#1b1b24" stroke-width="1.8"/>';
    case 'scar':
      return '<path d="M58 38 L63 50" stroke="#b5655a" stroke-width="1.6" stroke-linecap="round"/>';
    default:
      return '';
  }
}

function avatarSvg([name, skinIndex, hairStyle, hairName, gi, bg, eyeKind, mouthKind, extraKind]) {
  const skin = SKIN[skinIndex];
  const hairColor = HAIR[hairName];
  const h = hair(hairStyle, hairColor);
  const lapel = shade(gi, gi === '#f2f2f2' || gi === '#efe6d2' ? -40 : 45);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${name}">
<defs><radialGradient id="g" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="${shade(bg, 40)}"/><stop offset="1" stop-color="${bg}"/></radialGradient>
<clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>
<g clip-path="url(#c)">
<rect width="100" height="100" fill="url(#g)"/>
${h.back}
<path d="M12 104 C14 80 30 70 50 70 C70 70 86 80 88 104 Z" fill="${gi}"/>
<rect x="44" y="58" width="12" height="14" fill="${shade(skin, -18)}"/>
<path d="M41 71 L50 86 L59 71 Z" fill="${shade(skin, -10)}"/>
<path d="M38 71 L50 90 M62 71 L50 90" stroke="${lapel}" stroke-width="5" stroke-linecap="round"/>
<circle cx="31" cy="47" r="4.5" fill="${shade(skin, -12)}"/><circle cx="69" cy="47" r="4.5" fill="${shade(skin, -12)}"/>
<ellipse cx="50" cy="45" rx="19" ry="21" fill="${skin}"/>
${h.front}
${eyes(eyeKind)}
${mouth(mouthKind)}
${extra(extraKind, hairColor)}
</g>
</svg>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const data = SPECS.map((spec, i) => {
  const id = `char-${String(i + 1).padStart(2, '0')}`;
  fs.writeFileSync(path.join(OUT_DIR, `${id}.svg`), avatarSvg(spec));
  return { id, name: spec[0], color: spec[5] };
});
fs.writeFileSync(
  DATA_FILE,
  `'use strict';\n\n// scripts/generate-avatars.js가 만든 파일. 직접 고치지 말고 스크립트를 고친 뒤 다시 실행한다.\nconst AVATARS = ${JSON.stringify(data, null, 2)};\n`,
);
console.log(`캐릭터 ${data.length}개를 만들었습니다: ${OUT_DIR}`);
