# 출처와 라이선스 (PRD F-31, §8)

이 게임은 원작 「드래곤볼」의 이미지, 캐릭터, 로고, 글꼴, 음악을 사용하지 않는다.
손동작 게임 "드래곤볼(아·막·파)"의 규칙만 가져왔다.

## 배경음악·효과음

| 항목 | 출처 | 라이선스 |
|---|---|---|
| 게임 중 배경음악(battle), 대기실 배경음악(lobby) | 직접 제작. `public/audio.js`가 Web Audio API로 실시간 합성한다. 음원 파일 없음 | 이 프로젝트의 일부 (외부 음원 없음) |
| 효과음 (카운트다운, 공개, 공격, 명중, 막음, 아웃, 승리) | 직접 제작. `public/audio.js`에서 합성 | 이 프로젝트의 일부 (외부 음원 없음) |

## 캐릭터 이미지

| 항목 | 출처 | 라이선스 |
|---|---|---|
| 캐릭터 20종 (`public/avatars/char-01.svg` ~ `char-20.svg`) | 직접 제작. `scripts/generate-avatars.js`가 도형을 조합해 만든 오리지널 무술가 캐릭터. 원작 캐릭터를 본뜨지 않았고, 이름도 오리지널(강철, 노을, 번개 …) | 이 프로젝트의 일부 |

## 글꼴

| 항목 | 출처 | 라이선스 |
|---|---|---|
| Pretendard Variable | Kil Hyung-jin, https://github.com/orioncactus/pretendard (npm `pretendard`, 서버가 `/fonts/pretendard`로 제공) | SIL Open Font License 1.1 |

## 아이콘

화면의 아이콘(🔆 🛡️ 💥 🔥 💨 🌀 👑 등)은 이미지 파일이 아니라 유니코드 이모지 문자다. 각 기기에 설치된 시스템 이모지 글꼴로 표시된다.

## 라이브러리

| 항목 | 라이선스 |
|---|---|
| Express | MIT |
| Socket.IO | MIT |
| qrcode (QR 코드 생성) | MIT |
