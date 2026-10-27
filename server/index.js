'use strict';

const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const rooms = require('./rooms');
const game = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 시간 설정. 테스트에서 짧게 줄일 수 있게 환경 변수로 받는다.
const ROOM_TTL_MS = Number(process.env.DBG_ROOM_TTL_MS) || 30 * 60 * 1000; // 모두 나간 방 삭제 (§7)
const LEAVE_GRACE_MS = Number(process.env.DBG_LEAVE_GRACE_MS) || 30 * 1000; // 끊긴 뒤 "나감"으로 볼 때까지 (F-29)
const REVEAL_MS = Number(process.env.DBG_REVEAL_MS) || 4500; // 결과 공개 연출 길이 (F-19: 5초 이내)
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500; // 인터넷에 공개했을 때 방을 무한히 만들지 못하게
// 인터넷에 배포했을 때의 주소 (예: https://dragonball.onrender.com). 있으면 공유 링크와 QR에 항상 이 주소를 쓴다.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

// 같은 Wi-Fi의 휴대폰이 접속할 주소. 공유 링크와 QR에는 localhost 대신 이 주소를 쓴다.
function lanAddress() {
  const candidates = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address);
    }
  }
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return candidates.find(isPrivate) || candidates[0] || 'localhost';
}

const LAN_ORIGIN = `http://${lanAddress()}:${PORT}`;

function isLocalHost(host) {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(host);
}

// 공유 링크·QR에 넣을 주소.
// 1) PUBLIC_URL이 있으면 그 주소 2) 인터넷 주소(배포·터널)로 들어왔으면 그 주소 그대로
// 3) 이 PC에서 localhost로 열었으면 휴대폰이 접속할 수 있는 LAN 주소
function shareOrigin(headers = {}) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const first = (v) => (typeof v === 'string' ? v.split(',')[0].trim() : '');
  const host = first(headers['x-forwarded-host']) || first(headers.host);
  if (!host || isLocalHost(host) || !/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) return LAN_ORIGIN;
  const proto = first(headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function roomUrl(code, headers) {
  return `${shareOrigin(headers)}/room/${code}`;
}

const app = express();
app.use(express.static(PUBLIC_DIR));
// Pretendard 글꼴을 직접 제공해 인터넷이 없는 와이파이에서도 같은 글꼴로 보이게 한다 (OFL 1.1).
app.use(
  '/fonts/pretendard',
  express.static(path.join(path.dirname(require.resolve('pretendard/package.json')), 'dist', 'web', 'variable')),
);
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/room/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// F-02: 방 링크 QR 코드 (SVG)
app.get('/qr/:code', async (req, res) => {
  const room = rooms.getRoom(req.params.code);
  if (!room) return res.status(404).end();
  const svg = await QRCode.toString(roomUrl(room.code, req.headers), { type: 'svg', margin: 1 });
  res.type('image/svg+xml').send(svg);
});

const server = http.createServer(app);
// 한 번에 받는 메시지 크기를 작게 제한한다 (게임 요청은 모두 수백 바이트 이하).
const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });

function isValidPlayerId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

function socketsInRoom(code) {
  return [...io.sockets.sockets.values()].filter((s) => s.data.roomCode === code);
}

// 방 안의 소켓마다 그 사람 기준으로 걸러낸 상태를 보낸다.
// 입장 화면에서 기다리는 사람(watch)에게는 이미 선택된 캐릭터 목록만 보낸다.
function broadcast(room) {
  const extra = {
    revealMs: REVEAL_MS,
    revealElapsedMs: room.status === 'revealing' ? Date.now() - room.revealedAt : null,
  };
  for (const s of socketsInRoom(room.code)) {
    const viewer = rooms.findPlayerBySecret(room, s.data.secret);
    // 공유 링크는 받는 사람이 접속한 주소 기준 (LAN으로 들어온 사람에겐 LAN, 인터넷으로 들어온 사람에겐 인터넷 주소)
    const share = { ...extra, shareOrigin: shareOrigin(s.handshake.headers) };
    s.emit('room:state', rooms.publicState(room, viewer ? viewer.id : null, share));
  }
  io.to(`watch:${room.code}`).emit('room:avatars', {
    code: room.code,
    status: room.status,
    takenAvatars: rooms.takenAvatars(room),
    full: rooms.isFull(room),
  });
}

// ---------- 나감 처리와 방 정리 ----------
const leaveTimers = new Map(); // `${code}:${공개 ID}` → timer
const cleanupTimers = new Map(); // code → timer

function clearLeaveTimer(code, playerId) {
  const key = `${code}:${playerId}`;
  clearTimeout(leaveTimers.get(key));
  leaveTimers.delete(key);
}

// 끊긴 채 유예 시간이 지나면 "나간 것"으로 처리한다.
// 대기실에서는 목록에서 빼고, 게임 중에는 자리를 남겨 둔다 (호스트는 강제 진행으로 넘어갈 수 있음, F-17).
function startLeaveTimer(room, playerId) {
  clearLeaveTimer(room.code, playerId);
  const timer = setTimeout(() => {
    leaveTimers.delete(`${room.code}:${playerId}`);
    const player = rooms.findPlayer(room, playerId);
    if (!player || player.connected) return;
    player.left = true;
    if (room.hostId === playerId) rooms.transferHost(room, playerId);
    if (room.status === 'lobby') rooms.removePlayer(room, playerId);
    broadcast(room);
  }, LEAVE_GRACE_MS);
  leaveTimers.set(`${room.code}:${playerId}`, timer);
}

function hasSockets(code) {
  return [...io.sockets.sockets.values()].some((s) => s.data.roomCode === code || s.data.watchCode === code);
}

// 접속한 사람이 아무도 없는 방은 ROOM_TTL_MS 뒤에 삭제한다.
function scheduleCleanup(code) {
  clearTimeout(cleanupTimers.get(code));
  const timer = setTimeout(() => {
    cleanupTimers.delete(code);
    if (hasSockets(code)) return;
    const room = rooms.getRoom(code);
    if (room) for (const p of room.players) clearLeaveTimer(code, p.id);
    rooms.deleteRoom(code);
  }, ROOM_TTL_MS);
  timer.unref();
  cleanupTimers.set(code, timer);
}

// ---------- 소켓 ----------
// socket.data.secret은 브라우저가 보낸 비밀 값, 방 안의 플레이어는 공개 ID(player.id)로 다룬다.
// 같은 비밀 값으로 새 탭이 들어오면 새 탭이 자리를 가져가고, 이전 탭에는 안내를 보낸다.
function attach(socket, room) {
  const secret = socket.data.secret;
  for (const s of socketsInRoom(room.code)) {
    if (s.id !== socket.id && s.data.secret === secret) {
      s.data.roomCode = null;
      s.leave(room.code);
      s.emit('session:replaced');
    }
  }
  if (socket.data.watchCode) socket.leave(`watch:${socket.data.watchCode}`);
  socket.data.watchCode = null;
  socket.data.roomCode = room.code;
  socket.join(room.code);

  const player = rooms.findPlayerBySecret(room, secret);
  player.connected = true;
  player.left = false;
  clearLeaveTimer(room.code, player.id);
}

function watch(socket, room) {
  if (socket.data.watchCode) socket.leave(`watch:${socket.data.watchCode}`);
  socket.data.watchCode = room.code;
  socket.join(`watch:${room.code}`);
}

// 방을 만든 사람이 아직 입장 화면에 있는지 확인한다.
function creatorIsAround(room) {
  return [...io.sockets.sockets.values()].some(
    (s) => s.data.secret === room.creatorSecret && (s.data.watchCode === room.code || s.data.roomCode === room.code),
  );
}

io.on('connection', (socket) => {
  // 클라이언트는 비밀 값을 auth.playerId로 보낸다 (localStorage의 dbg.playerId).
  const secret = (socket.handshake.auth || {}).playerId;
  if (!isValidPlayerId(secret)) {
    socket.emit('fatal', '잘못된 접속입니다. 페이지를 새로고침해 주세요.');
    socket.disconnect(true);
    return;
  }
  socket.data.secret = secret;

  const reply = (ack, payload) => {
    if (typeof ack === 'function') ack(payload);
  };

  // 지금 이 소켓이 참가한 방 (새 탭에 자리를 빼앗기면 null)
  const myRoom = () => rooms.getRoom(socket.data.roomCode);
  const me = (room) => rooms.findPlayerBySecret(room, secret);
  // 호스트가 아직 없으면: 방을 만든 사람이 입장했거나, 만든 사람이 사라졌을 때 처음 들어온 사람이 호스트가 된다.
  const willBeHost = (room) =>
    !rooms.findPlayer(room, room.hostId) && (secret === room.creatorSecret || !creatorIsAround(room));

  // 호스트 전용 요청의 공통 처리
  const hostAction = (name, fn) => {
    socket.on(name, (payload, ack) => {
      if (typeof payload === 'function') [payload, ack] = [undefined, payload];
      const room = myRoom();
      if (!room) return reply(ack, { ok: false, error: '방에 참가해 있지 않습니다.' });
      const player = me(room);
      if (!player || room.hostId !== player.id) return reply(ack, { ok: false, error: '호스트만 할 수 있습니다.' });
      const result = fn(room, payload || {});
      if (result.error) return reply(ack, { ok: false, error: result.error });
      reply(ack, { ok: true });
      broadcast(room);
    });
  };

  socket.on('room:create', (ack) => {
    if (rooms.count() >= MAX_ROOMS) {
      return reply(ack, { ok: false, error: '지금은 방이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.' });
    }
    const room = rooms.createRoom(secret);
    scheduleCleanup(room.code);
    reply(ack, { ok: true, code: room.code });
  });

  // 링크로 들어왔거나 새로고침했을 때: 이미 참가한 사람이면 자리로 돌려보낸다 (F-06).
  socket.on('room:enter', (payload, ack) => {
    const room = rooms.getRoom(payload && payload.code);
    if (!room) return reply(ack, { ok: false, error: '방을 찾을 수 없습니다. 방 코드를 확인해 주세요.' });
    if (me(room)) {
      attach(socket, room);
      reply(ack, { ok: true, member: true });
      broadcast(room);
      return;
    }
    watch(socket, room);
    reply(ack, {
      ok: true,
      member: false,
      code: room.code,
      status: room.status,
      takenAvatars: rooms.takenAvatars(room),
      full: rooms.isFull(room),
      // 방을 만든 사람이면 입장 화면에 "진행만 하기"를 보여준다.
      canHostOnly: willBeHost(room),
    });
  });

  socket.on('room:join', (payload, ack) => {
    const { code, nickname, avatarId, hostOnly } = payload || {};
    const room = rooms.getRoom(code);
    if (!room) return reply(ack, { ok: false, error: '방을 찾을 수 없습니다. 방 코드를 확인해 주세요.' });
    if (!me(room)) {
      const becomesHost = willBeHost(room);
      // 진행만 하기는 호스트가 될 사람만 고를 수 있다. 진행자가 없으면 게임을 진행할 사람이 없기 때문이다.
      if (hostOnly === true && !becomesHost) {
        return reply(ack, { ok: false, error: '진행만 하기는 방을 만든 사람(호스트)만 고를 수 있습니다.' });
      }
      const result = rooms.addPlayer(room, { secret, nickname, avatarId, playing: hostOnly !== true });
      if (result.error) {
        return reply(ack, { ok: false, error: result.error, takenAvatars: rooms.takenAvatars(room) });
      }
      if (becomesHost) room.hostId = result.player.id;
    }
    attach(socket, room);
    reply(ack, { ok: true });
    broadcast(room);
  });

  socket.on('round:submit', (payload, ack) => {
    const room = myRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 참가해 있지 않습니다.' });
    const player = me(room);
    if (!player) return reply(ack, { ok: false, error: '방에 참가해 있지 않습니다.' });
    // 필요한 필드만 꺼내 넘긴다. 형식·기술 이름 검증은 game.submitAction → judge.validateAction이 한다.
    const { round, skill, targetId } = payload && typeof payload === 'object' ? payload : {};
    const result = game.submitAction(room, player.id, { skill, targetId: targetId ?? null }, round);
    if (result.error) return reply(ack, { ok: false, error: result.error });
    reply(ack, { ok: true });
    broadcast(room);
  });

  socket.on('round:cancel', (payload, ack) => {
    const room = myRoom();
    if (!room) return reply(ack, { ok: false, error: '방에 참가해 있지 않습니다.' });
    const player = me(room);
    if (!player) return reply(ack, { ok: false, error: '방에 참가해 있지 않습니다.' });
    const result = game.cancelAction(room, player.id, payload && payload.round);
    if (result.error) return reply(ack, { ok: false, error: result.error });
    reply(ack, { ok: true });
    broadcast(room);
  });

  hostAction('game:start', (room) => game.startGame(room));
  hostAction('round:reveal', (room) => game.reveal(room));
  hostAction('round:force', (room) => game.reveal(room, { force: true }));
  hostAction('round:next', (room) => game.nextRound(room, { revealMs: REVEAL_MS }));
  hostAction('game:lobby', (room) => game.toLobby(room));

  socket.on('disconnect', () => {
    const watchCode = socket.data.watchCode;
    if (watchCode) scheduleCleanup(watchCode);
    const room = myRoom();
    if (!room) return;
    scheduleCleanup(room.code);
    const player = me(room);
    // 같은 플레이어가 다른 탭으로 아직 접속해 있으면 연결 상태를 유지한다.
    const stillHere = socketsInRoom(room.code).some((s) => s.id !== socket.id && s.data.secret === secret);
    if (player && !stillHere) {
      player.connected = false;
      startLeaveTimer(room, player.id);
      broadcast(room);
    }
  });
});

server.listen(PORT, () => {
  console.log('드래곤볼 게임 서버가 시작되었습니다.');
  console.log(`  이 PC에서:      http://localhost:${PORT}`);
  console.log(`  같은 Wi-Fi에서: ${LAN_ORIGIN}`);
  if (PUBLIC_URL) console.log(`  인터넷 주소:    ${PUBLIC_URL}`);
});
