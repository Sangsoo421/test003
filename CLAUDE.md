# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A real-time multiplayer mobile web version of the "드래곤볼(아·막·파)" hand game. Friends in the same room each open a link on their phone, and the server reveals and judges everyone's moves at the same time. All user-facing text and docs are in Korean.

- `prd.md` (v0.3) is the source of truth: game rules in §3, requirements F-01 to F-37, screens S-01 to S-07, and decisions in §10.
- `prompts.md` is the staged build plan (1 skeleton, 2 game rules, 3 UI design, 4 Playwright review, and an optional 5 for fixes). Its "공통 전제" section records decisions that override or clarify the PRD.
- Current state:
  - **Stages 1–3 are done.**
  - **Stage 4 (Playwright review) is in progress.** The E2E suite is in `tests/e2e/`, and the report (`review-report.md`) has not been written yet.
  - Two serious bugs found in the review are already fixed: the leak of other players' choices, and skill-name validation (see "Player identity" and `judge.js` below). The rest are listed under "Known open issues".
  - **Added after stage 4 (PRD v0.2, branch `v2`):** the '원' (원기옥) ultimate skill with its own reveal effect, and chat shown as speech bubbles next to each sender's character (F-34 to F-37).
  - **Added in PRD v0.3 (branch `v3`):** '막' can be used at most twice in a row (see "'막' streak limit" below).

**This is not the quiz game.** The parent folder's `CLAUDE.md` is about the quiz game, which is built differently: no server, runs from `file://`, a `QUESTIONS` data file, and quiz-content guidelines. None of that applies here, and neither do the quiz `/quiz-*` commands.

## Commands

```bash
npm install                          # one-time setup
npx playwright install chromium webkit   # once, for E2E
npm start                            # server on :3000 (PORT env overrides); prints localhost and LAN URLs
npm test                             # unit tests (node:test): tests/judge.test.js, tests/game.test.js
node --test --test-name-pattern="§3.4-9"     # unit tests whose name matches
npm run test:e2e                     # all Playwright E2E tests (~8 min)
npx playwright test tests/e2e/round.spec.js  # one file
npx playwright test -g "F-15"        # E2E tests whose name matches
npx playwright test --project=android-chrome # skip the iPhone (WebKit) project
node scripts/generate-avatars.js     # regenerate the 20 avatar SVGs + public/avatar-data.js
```

The page can't be opened from `file://`; it needs the server. Timing env vars, for shortening in tests:
- `DBG_REVEAL_MS`: reveal animation length (default 4500, must stay under 5 s, F-19).
- `DBG_LEAVE_GRACE_MS`: how long a disconnected player has before counting as left (default 30 s).
- `DBG_ROOM_TTL_MS`: how long an empty room lasts before deletion (default 30 min).

## Architecture

Server code has three layers. Keep the first two free of sockets and timers so they stay unit-testable.
- **`server/judge.js`:** pure rules. `judge()` resolves one round, and `validateAction()` checks a single choice.
  - `SKILLS` is a frozen object with no prototype. Always read skill names through `parseSkill()` / `parseAction()`: they require a string, apply NFC normalization and trim, and accept only names `SKILLS` itself defines. This stops names like `__proto__` from passing.
  - Inside `judge()`, an unknown skill falls back to '막' (cost 0).
  - **'원' (원기옥, added after the PRD):** cost 5, no target (`ultimate: true`, `attack: false`). It eliminates every other alive player, whatever they chose. A '파', '에' or '순파' aimed at a '원' user gets outcome `absorbed`, so the user survives. Two or more '원' users eliminate each other and everyone else, so the round is a draw. `judge()` adds one `{ skill: '원', outcome: 'hit' }` attack per caster per victim.
  - `safeKi()` treats a corrupt ki value as 0.
  - **'막' streak limit (v0.3):** `MAK_LIMIT` is 2. `validateAction()` rejects '막' when `makBlocked(player)` (`player.makStreak >= 2`). `nextMakStreak(streak, skill)` returns +1 for '막' (capped at 2) and 0 for any other skill; a corrupt streak counts as 0.
- **`server/game.js`:** round flow (start, submit and cancel, reveal or force, next round, back to lobby, ranking). It changes the room object and returns `{ ok }` or `{ error }`. It stores only the normalized action, never the raw request.
  - `reveal()` updates each alive player's `makStreak` from the skill they actually used (forced players count as '막'), and puts the pre-reveal values in `lastResult.makStreakBefore`. `startGame()` resets `makStreak` to 0.
- **`server/rooms.js`:** the room registry, joining (nickname, avatar, and 8-player checks), host transfer, and `publicState()`.
- **`server/chat.js`:** participant chat (speech bubbles). `addMessage()` cleans the text (NFC, removes control and zero-width characters, collapses whitespace), allows 1–100 characters and 5 messages per 5 s per player, and numbers it with `room.chatSeq`. Messages are not stored. Per-player send times live in `player.chatTimes`, which `publicState()` never copies.
- **`server/index.js`:** Socket.IO wiring plus timers (leave grace, room cleanup) and the `/qr/:code` SVG endpoint.

How the pieces fit:
- **Player identity: two separate values. Never merge them.**
  - **Secret:** generated in the browser and stored in `localStorage` as `dbg.playerId`. It is sent only as the Socket.IO `auth.playerId` and lives server-side as `socket.data.secret` and `player.secret`. Look it up with `findPlayerBySecret()`. It must never leave the server: `publicState()` copies only allow-listed fields.
  - **Public ID:** `player.id`, a random value generated by the server (`p` + 16 hex characters). This is what `hostId`, targets, results, and the client's `room.you` / `p.id` use. Knowing someone's public ID must not let anyone connect as them, which is how F-15 is protected.
  - **Before the creator joins:** `room.hostId` is `null`, and the creator is recognized by `room.creatorSecret`.
- **Host-only mode (진행만 하기):** the person who will become host can tick "진행만 하기" on the join screen (`hostOnly: true` in `room:join`; `room:enter` sends `canHostOnly` so only they see the option, and the server rejects it from anyone else).
  - That player has `playing: false` and `avatarId: null`. They don't count toward the 8-player limit or `MIN_PLAYERS`, `startGame()` never makes them `inGame`, so they can't submit or be targeted, and they're not in the ranking.
  - Count players with `rooms.playingPlayers()` / `isFull()` (server) or `playingCount()` (client), never `room.players.length`.
  - `transferHost()` passes the host only to a `playing` player. The client draws a 🎙️ placeholder for a null avatar in `createAvatar()`.
- **Screen per room status:** the server owns the room `status`, and the client maps it to a screen (`STATUS_SCREEN` in `public/app.js`): lobby → S-04, choosing → S-05, revealing → S-06, finished → S-07. S-01, S-02 and S-03, plus the "opened in another tab" notice, are local to the client. Every change goes out as `room:state` through `broadcast()`, which calls `publicState()` once per viewer.
- **Socket events use ack callbacks** and reply `{ ok, error }`. Host-only events go through `hostAction()`.
  - `room:enter`: a member is reattached (F-06). A non-member joins the `watch:<code>` socket room, where `room:avatars` keeps the join screen's taken-avatar list live.
  - `round:submit` and `round:cancel` carry `round`, so late requests for an earlier round are rejected.
  - **Chat (F-34~F-37):** `chat:send { text }` works only for a socket attached to the room (players, spectators, host-only hosts; not people still on the join screen). The server sends `chat:message { code, message }` to the Socket.IO room; there is no history.
    - There is no chat window. The 💬 top-bar button opens a one-line input bar (`#chat-bar`); while it's open, `body.chat-open` lifts `.sticky-actions` above it.
    - Each message shows as a speech bubble next to the sender's character for 4–9 s (`showBubble()`). Bubbles live in the fixed, `pointer-events: none` layer `#chat-bubbles` and `layoutBubbles()` repositions them every animation frame while any are showing, so they survive re-renders and scrolling.
    - Bubbles find the character through `data-chat-anchor="<public ID>"`, which `chatAnchor()` adds to avatars in the lobby list, status panel, reveal arena and ranking. Search order: the current screen, then the status panel. If none is visible (rules screen, scrolled out of the status list), the bubble floats at the top with the nickname (`.is-floating`). Add `chatAnchor()` to any new place that shows a player's avatar.
- **Leaving (F-29):**
  - **Disconnect:** the player is marked `connected: false`, and the leave grace timer starts. After it expires, the player is marked `left`, and the host passes to the earliest-joined connected player.
  - **Removal:** in the lobby, a left player is removed right away. During a game, the seat stays, and the host can use 강제 진행. Left players are dropped at the next new game or return to the lobby.
  - **Reconnect:** a player who comes back, even after being marked `left`, gets the seat back.
  - **Same secret in a second tab:** the newer tab takes the seat, and the older tab gets `session:replaced`.
- **Reveal sync (F-18, F-19):** the reveal timing comes from the server.
  - The server sends `revealMs` and `revealElapsedMs`. The client plays `REVEAL_PHASES` (count3/2/1, skills, attacks, impact, outs) from that offset, keyed by `lastResult.revealedAt`, so a broadcast never replays the reveal and a page reloaded mid-reveal resumes where it was.
  - `round:next` is refused until `revealMs` has passed.
  - During the animation, `displayedPlayers()` shows the ki, '막' streak (`lastResult.makStreakBefore`) and alive state from before the reveal, so the status bar can't spoil the result.
  - `renderArena()` is derived from the current phase alone and is rebuilt on every render. The flying effects from `launchProjectiles()` live in a separate `#arena-fx` layer and fire only when a phase is entered live. With `prefers-reduced-motion`, the flying effects are skipped, but every label and the caption still appear.
  - **원기옥 effect:** `chargeGenki()` grows a `.genki-orb` above the caster when the skills phase starts; `launchGenki()` (called from `launchProjectiles()`) drops it onto the arena centre and ends in `genkiBlast()` (flash and shock rings). `renderReveal()` toggles `.is-genki` / `.is-genki-impact` on `#arena` and shows `.genki-banner` during the attacks phase, all derived from the phase. Sounds: `genkiCharge`, `genkiLaunch`, `genkiBoom` in `audio.js`.
- **Shared links and the QR code use `shareOrigin(headers)`** in `index.js`, never `localhost`, so other devices can open them:
  - `PUBLIC_URL` env if set;
  - otherwise the address the request came in on (honoring `X-Forwarded-Host` / `-Proto` from a host or tunnel);
  - otherwise, when opened on `localhost`, `LAN_ORIGIN` (the LAN IP).
  It's computed per socket and sent as `room.shareOrigin`, so LAN and internet users each get a link that works for them.
- **Deploying to the internet:** `render.yaml` (Render Blueprint) runs `npm ci --omit=dev` and `node server/index.js`, with `/healthz` as the health check. Rooms live in memory, so run exactly one instance; a restart drops every room. `MAX_ROOMS` (default 500) caps room creation, and Socket.IO's `maxHttpBufferSize` is 16 KB.
- **Features that need a secure context:** phones reach the server over plain `http://<LAN IP>`, which is not a secure context. Don't use `crypto.randomUUID` or rely on `navigator.clipboard`; use `getRandomValues` and the `execCommand('copy')` fallback, as `app.js` already does.
- **Absolute asset paths:** `public/index.html` loads `/style.css`, `/avatar-data.js`, `/audio.js` and `/app.js` by absolute path, because the same page is also served at `/room/:code`.
- **`SKILLS` and `MAK_LIMIT` are defined twice,** in `server/judge.js` and in `public/app.js`, which uses them for display only. Change both together. Both mark '원' with `ultimate: true`; on the client that makes it a full-width gold button (`.skill-btn-ultimate`) and hides the target picker.
- **Avatars:** `scripts/generate-avatars.js` generates `public/avatars/char-XX.svg` and `public/avatar-data.js` (the global `AVATARS`, with names). Don't edit the output; change the script and rerun it. Keep the characters original: no spiky hair and no orange gi.
- **Music (`public/audio.js`, global `Sound`):** all sound is synthesized with the Web Audio API, with no audio files. The `AudioContext` is created on the first `pointerdown` or `keydown` (F-33). `STATUS_TRACK` in `app.js` picks the track for each room status. The on/off setting is stored in `localStorage` as `dbg.music`. Sound effects are in `SFX`; '원' uses `genkiCharge`, `genkiLaunch` and `genkiBoom` instead of the usual attack sounds.
- **Font:** the server serves the Pretendard font from `node_modules/pretendard` at `/fonts/pretendard`, so it works on a Wi-Fi network with no internet. Record any new asset in `CREDITS.md`.
- **Headings:** the page's only `<h1>` is a visually hidden one in the top bar. Every screen title, including the start screen's, is an `<h2>`; `showScreen()` focuses it.

## Rules that are easy to break

- **Fairness (F-15, §7):** before the reveal, never send another player's `action` (skill or target) to any client, in any form. The same goes for any player's secret. All state goes out through `publicState(room, viewerPublicId)`. Only `submitted` is public, and viewers get their own choice back as `myAction`. `lastResult` is sent only while the status is revealing or finished.
- **Judging happens only on the server, and the server trusts no client request.** It rejects:
  - unknown or non-string skill names;
  - skills the player lacks ki for (including '원' below 5 ki);
  - a third '막' in a row (`makStreak` is 2);
  - a target sent with a skill that takes none ('아', '막', '순', '원');
  - attacks on yourself or on an eliminated player, and targets that aren't strings;
  - actions from eliminated players or spectators;
  - host-only actions sent by someone who is not the host;
  - actions for a round that has already been revealed;
  - chat from a socket not attached to the room, and chat that is empty, invisible-only, not a string, over 100 characters, or over 5 messages per 5 s.

  Judging must run only once per round, even if "결과 확인" is pressed twice or by two people at once.
- **Rule details that are easy to get wrong** (§3.2–3.3, plus '원'):
  - The +1 ki from '아' is added after judging, so it cannot be spent in the same round.
  - An attack spends its ki even if it is blocked.
  - '파' and '에' cancel each other only when the two players aimed at each other.
  - '에' does not defend against a '파' from anyone other than the player it targets.
  - '순파' eliminates only a player who used '순', and does nothing to anyone else.
  - Attacks are simultaneous: an attacker eliminated in the same round still lands their attack.
  - If everyone left is eliminated in the same round, the game is a draw.
  - '원' cannot be blocked or dodged, absorbs attacks aimed at its user, and two '원' in one round means everyone is out (draw).
  - '막' at most twice in a row. Using any other skill or starting a new game resets the streak. The streak is public (`publicState()` sends `makStreak`); the status bar shows "🛡️ 막 1회 연속" or "🚫🛡️ 막기불가", and the locked button says "연속 2회 사용 (이번 턴 불가)".
  - Forced progress (F-17) is the exception: an unsubmitted player is judged as '막' even with a streak of 2, with no error, and the streak stays at 2. Don't "fix" this by validating forced actions.
- **PRD conflicts already resolved:**
  - F-17 (the host can force progress, and anyone who has not chosen counts as '막') overrides §10 #6.
  - Room codes are at least 6 characters, generated with `crypto`, and avoid look-alike characters such as 0/O and 1/I/L. The PRD's `AB12` is only an example.
- Render user text with `textContent`, never `innerHTML`. This includes chat messages.
- **Copyright (§8, F-31):** do not use the original Dragon Ball images, characters, logo, fonts or music. Avatars are 20 original SVG martial-artist characters, and music is self-made (Web Audio API) or CC0. Record every asset's source and license in `CREDITS.md`.
- **Mobile first:**
  - no horizontal scroll at 360px width;
  - touch targets at least 44×44px;
  - never show a state by color alone;
  - music starts only after the user's first tap, because of autoplay restrictions;
  - at 420px or narrower, the top-bar buttons (music, chat, rules) show only their icons, and the label stays for screen readers. With the 💬 button added, the labels wrap at 360px otherwise.

## Known open issues (found in the stage 4 review, not fixed yet)

Each one has a failing E2E test, and the name of each test says what correct behavior is:
- **The creator leaves before joining:** if the room's creator closes the join screen after another player has joined, the room is left with no host, so no one can start (`lobby.spec.js` › 방을 만든 사람이 입장 전에 나가면…).
- **Leaving with the browser's back button:** the socket stays attached to the old room, so the player keeps showing as connected, and host transfer never happens (`lobby.spec.js` › 브라우저 뒤로 가기…).
- **Invisible nicknames:** a nickname made only of zero-width characters (`​`) is accepted. `trim()` doesn't remove those characters (`rooms.js` `normalizeNickname`).
- **Slow disconnect detection:** a phone that loses its network shows as "연결 끊김" only after about 45 seconds, because of Socket.IO's default `pingInterval` + `pingTimeout` (`new Server(server)` in `index.js`).
- **Choice of LAN address:** `lanAddress()` picks the first private IPv4 address. On a PC with WSL, Hyper-V or VPN adapters, that can be the wrong network. (Doesn't matter when deployed or when `PUBLIC_URL` is set.)

## Testing

- **Unit tests (`node:test`):**
  - Rules: every example in §3.4 (including '원' examples 13–15), the full attack × defense table, ki math, the '원' cases, and skill-name and ki hardening (`__proto__`, NaN ki).
  - Round flow in `game.js`, plus the check that secrets never appear in `publicState()`.
  - Chat validation and rate limiting in `chat.js` (in `tests/game.test.js`).
  - The '막' streak: `nextMakStreak()`/`validateAction()` in `judge.test.js`, and round-by-round counting, reset, forced-progress exception and `makStreakBefore` in `game.test.js`.
  - Add a judge test for any rule change.
- **E2E (`tests/e2e/`, Playwright):**
  - **Servers:** `playwright.config.js` starts two:
    - `:3310` "FAST", with reveal 1.2 s, grace 2.5 s and room TTL 3 s;
    - `:3311` "REAL", with default timings, used for F-19 timing and cross-device sync.
  - **Projects:** `android-chrome` (Pixel 7) runs every test. `iphone-safari` (iPhone 13 on WebKit) runs only tests tagged `@smoke`.
  - **`helpers.js`** provides a `game` fixture:
    - `game.player()` creates one browser context per player, each with its own `localStorage` and secret.
    - `game.lobby(n)`, `game.start()`, `game.round()`, `game.next()` and `game.charge()` drive a game.
    - Each page gets helpers: `page.pid` (the public ID), `page.choose()`, `page.emitAck()` for raw socket requests, and `page.frames_`, which records received WebSocket frames from before connect.
    - The fixture fails any test that logs a console or page error. `game.allowErrors` takes regexes, and is meant for noise the tool itself causes (for example, going offline).
  - **Screenshots:** `ui.spec.js` writes them to `screenshots/` at 360, 768 and 1440 px, and runs axe on each.
  - **`mak-limit.spec.js`:** the locked '막' button and its message, the status-bar badge (including that it isn't spoiled during the reveal), raw-socket rejection, forced progress at a streak of 2, and the reset on a new game.
  - **`genki-chat.spec.js`:** '원' judging, its reveal effect (also with reduced motion), and the chat bubbles. The bubble test checks that a bubble sits right above or below the sender's `[data-chat-anchor]` avatar.
- **Selector gotcha:** `data-skill` also appears on the rules screen's cards and example chips. Select skill buttons with `.skill-btn[data-skill="파"]`, and target buttons with `[data-target="<public ID>"]`.
- **Waiting on reveal phases:** use `waitForFunction(() => state.reveal.phase === '…', null, { polling: 30 })`. The default `requestAnimationFrame` polling stalls in background pages, and `expect().toHaveText` polling can miss the 0.6-second countdown steps.
  - Read everything you need from one phase in a single `page.evaluate()`. Don't put a screenshot between two phase waits: a full-page screenshot with 8 players takes over a second, longer than the 0.63-second attacks phase, so the next wait never matches and the test hangs until its timeout.
  - To screenshot every phase, freeze that page's clock as `ui.spec.js` does: `page.clock.install()` and `pauseAt()` before revealing, then `advanceToPhase()` (`clock.runFor(50)` steps) per phase, and `clock.resume()` afterwards.
- **Environment limits:**
  - Playwright's Windows build of WebKit has no Web Audio; the audio test detects this and only checks for errors.
  - WebKit is slow here. Its cross-device timing numbers are not reliable, so confirm them on real phones.
  - In the Linux Codespace, WebKit can't launch ("Host system is missing dependencies"), so every `iphone-safari` test fails right away. Install the libraries with `sudo npx playwright install-deps webkit`, or skip the project with `--project=android-chrome`.
  - With the default 4 workers, the timing tests on this small machine (F-18 spread under 300 ms, reveal phase order, the 8-player and screenshot tests) can fail from load alone. Rerun a failure alone with `--workers=1` before treating it as a bug.
- **Leftover servers:** start servers by hand with `node server/index.js`, not `npm start`. Stopping a background task that `npm` or `npx` launched can leave Node holding ports 3000, 3310 or 3311. Check the ports before rerunning.
