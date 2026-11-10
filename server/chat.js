'use strict';

// 참가자 채팅 (캐릭터 옆 말풍선). 메시지를 검증·정리만 하고 보관하지 않는다. 소켓·타이머는 다루지 않는다.
const CHAT_MAX = 100; // 메시지 최대 글자 수 (이모지도 1자)
const RATE_WINDOW_MS = 5000; // 이 시간 동안
const RATE_MAX = 5; // 최대 이만큼 보낼 수 있다

// 제어 문자·서식 문자(너비 없는 공백, 방향 제어 등)를 지우고 공백을 하나로 모은다.
// 이모지를 잇는 ZWJ(U+200D)는 남긴다.
function normalizeChatText(text) {
  if (typeof text !== 'string' || text.length > CHAT_MAX * 4) return '';
  return text
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/(?!‍)\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 보낼 수 있으면 { message }, 아니면 { error }.
// player.chatTimes는 서버만 보관한다 (publicState는 허용 목록 필드만 내보낸다).
function addMessage(room, player, rawText, now = Date.now()) {
  if (!player || player.left) return { error: '방에 참가해 있지 않습니다.' };
  const text = normalizeChatText(rawText);
  // ZWJ만 남은 경우처럼 보이는 글자가 없으면 거부한다.
  if (!text.replace(/‍/g, '').trim()) return { error: '메시지를 입력해 주세요.' };
  if ([...text].length > CHAT_MAX) return { error: `메시지는 ${CHAT_MAX}자까지 보낼 수 있어요.` };
  const recent = (player.chatTimes || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) return { error: '메시지를 너무 빨리 보내고 있어요. 잠시 뒤에 보내 주세요.' };
  player.chatTimes = [...recent, now];

  room.chatSeq = (room.chatSeq || 0) + 1;
  const message = {
    id: room.chatSeq,
    playerId: player.id,
    nickname: player.nickname, // 캐릭터가 화면에 없을 때 말풍선에 이름을 붙인다
    text,
  };
  return { message };
}

module.exports = { CHAT_MAX, RATE_MAX, RATE_WINDOW_MS, normalizeChatText, addMessage };
