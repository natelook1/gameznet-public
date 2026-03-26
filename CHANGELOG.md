# Changelog

## v1.2.0 — 2026-03-25

### Added
- **Mobile Companion App** — a static Preact SPA served via Cloudflare Pages (`m.gameznet.looknet.ca`). Works on any device with a browser — no install required. Features: Who's Online, Game Server status, Network Chat, Discord channel browser, and Direct Messages
- **Mobile token auth** — `X-Token` header validated against active tokens on the backend; mobile identity is enforced server-side on all write operations (chat send, DM send, Discord send) preventing impersonation
- **`GET /api/mobile/whoami`** — validates a token and returns player identity for mobile first launch
- **`mobile_enabled` flag** — per-token toggle to enable or disable mobile access without revoking the token; admin panel shows a 📱/📵 toggle per player

### Fixed
- Update SSL handling now tries the Windows certificate store first, falls back to certifi, then unverified — fixes update failures on machines with broken Python cert stores (e.g. fresh Python 3.12 installs)

---

## v1.1.0 — 2026-03-25

### Changed
- **Compiled Windows installer** — GamezNET is now distributed as `GamezNET-Setup.exe`. No Python, Git, or pip required. Installs to `%LOCALAPPDATA%\GamezNET\` with a desktop shortcut and runs as a native Windows executable.
- **WireGuard bundled** — included in the installer and installed silently if not already present.
- **Silent in-place updates** — clicking the update badge downloads and applies the new version silently in the background. The app relaunches automatically with no user interaction required.
- **Existing bat users auto-migrate** — users on the old `.bat` setup are upgraded automatically on their next update click. Saved credentials carry over with no re-provisioning needed.

### Added
- `build.py` — automated build pipeline (icon → WireGuard → PyInstaller → Inno Setup)
- `gameznet.spec` — PyInstaller one-file spec (UAC admin manifest, no console window, tray)
- `gameznet.iss` — Inno Setup script (silent install, WireGuard detection, clean uninstaller)

---

## v1.0.2 — 2026-03-19

### Added
- **Internal Direct Messages (DMs)** — right-click any player in the *Who's Online* or *Discord* lists to open a private, tabbed chat session that stays entirely within the GamezNET network
- **Tabbed Chat UI** — the floating chat panel now supports multiple tabs to seamlessly switch between Global chat and individual DMs
- Installer script now automatically maps `gameznet.local` in the Windows hosts file to ensure reliable local backend resolution

### Fixed
- Corrected Discord default avatar generation using 64-bit Snowflake IDs to prevent broken image links
- Fixed game server uptime calculation rendering incorrectly (milliseconds vs seconds)
- Fixed an issue where the Admin Panel showed duplicate configuration fields for YouTube API keys
- Corrected syntax and rendering logic for Admin Panel server action buttons based on live server state

## v1.0.1 — 2026-03-19
*Consolidates experimental v1.14.3 – v1.15.1 updates into the first official stable release.*

### Added
- **Per-player Ping Sparkline** — the Who's Online list now shows a live, rolling ping history graph (sparkline) for each connected player
- **Server Chips & Modals** — game servers are now displayed as a compact row of capsule icon chips; clicking a chip opens a detail modal with a background banner, CPU/RAM/Uptime stats, and quick-copy IP/ports
- **Edge-docked Chat** — floating network chat now snaps cleanly to the left or right edges of the window; when minimized, it turns into a compact draggable pill
- **Session Profile Header** — the Your Session card has been redesigned with a unified profile header housing your avatar, name, and Steam stats
- **Footer Status** — custom player status input and presets have been moved to the footer for persistent, quick access

### Changed
- **Layout Overhaul** — wider Who's Online list, larger Steam game capsules, and a more compact Scheduled Session card

### Fixed
- Handled parsing of legacy string ping values (e.g. '42ms') preventing sparkline crashes
- RustDesk remote assistance: fixed portable launcher ID reading from stdout, improved ID log polling, and properly killed stale RustDesk processes before starting a host session
- Remote progress modal visibility bug fixed (`display:''` overriding issues)
- Satisfactory Steam join now uses `rungameid` instead of Source query to fix launch parameters

## v1.14.2 — 2026-03-16

### Added
- **Network status pill** — when connected, the Network column hides and a live `● CONNECTED` pill appears in the tab bar showing VPN IP and session timer; click it for a telemetry dropdown with ping, handshake, rx/tx, and disconnect button
- **Steam Friends Online** — new Steam Social column shows which Steam friends are online and what they're playing
- **Recently Played** — shows your last 5 games with playtime over the past 2 weeks
- **Game News** — latest Steam news articles for running game servers, updated automatically
- **Discord unread indicators** — red dot on channels with new messages, cleared when you open them
- **Discord mention highlights** — messages that @mention your name are highlighted in amber
- **Discord reactions** — click any emoji reaction to add or remove it via the bot
- **Browser notifications** — fires when a message @mentions you while you're on a different tab (requests permission on first Discord tab open)
- **Floating Network Chat** — chat extracted into a draggable floating panel; minimizes to a compact pill with an unread badge; position saved across sessions

### Changed
- Game servers moved to a compact 1-row horizontal strip above the columns (scrollable, Steam artwork still visible as background)
- Minecraft servers show dual ports labeled **Java** and **Bedrock** separately
- Third column replaced with **Steam Social**: Friends Online, Recently Played, Game News
- Default column order is now: Steam Social → Network → Your Session
- Server list is now fully dynamic from Pterodactyl — new servers appear automatically without a code change

---

## v1.13.5 — 2026-03-16

### Added
- **Discord full rebuild** — Discord tab is now a 3-pane experience: channel sidebar (categories, text channels, voice channels with live occupants), message feed, and member list
- **Discord Gateway WebSocket** — real-time presence (online/idle/dnd/offline), voice state updates, and instant message cache invalidation; no more 15–30s REST polling lag
- **Discord message sending** — type and send messages to any channel directly from the app; messages appear with your player name and Steam avatar (no Discord login required, no BOT tag)
- **Pinned messages** — 📌 button in the channel header shows all pinned messages for that channel
- **Channel privacy** — channels restricted to @everyone (e.g. admin channels) are automatically hidden
- **Dynamic game server list** — servers now pulled live from Pterodactyl; any new server (e.g. Minecraft Java) appears automatically without a code change
- **Remote assistance** — players can request a peer-to-peer remote desktop session from any online player via RustDesk; no relay server, no admin involvement
- **Steam account linking** — link your Steam profile once to show avatar, level, game library, and top-played games on your player card

### Fixed
- `/api/fullroute` no longer returns 400 on GET while connected — only blocks state-change requests
- Session lock: if a client crashes without cleanly disconnecting, the `active` flag now auto-clears within 12 seconds server-side
- Update button no longer forces a disconnect before applying the update — stays connected through the process
- STEAM JOIN button hidden for game servers with no Steam app ID (e.g. Minecraft Java)

---

## v1.9.0 — 2026-03-15

### Added
- Discord support channel: player support requests now post a notification to a private admin-only Discord channel
- Admin panel: Test Support Channel button alongside the existing Test Bot button

### Changed
- Version badge pulses amber and shows `↑` when the client is outdated — click it to update in one step without digging through menus

---

## v1.8.x — 2026-03-15

### Added
- **Session Scheduler** — admin can schedule a game session with game, date/time, and message; displayed as a full-width countdown card on every client with Steam header artwork as background; all clients receive a tray notification when a session is posted
- **Tray notifications** — alerts fire for: player join, player leave, admin broadcast alert, new scheduled session
- **Broadcast Alert** — admin can post a timed coloured banner visible to all clients from the Messages card
- **Message of the Day** — persistent banner editable from the Messages card in the admin panel
- **Server action confirmations** — start/stop/restart game servers now require a confirmation dialog
- **Discord bot support channel** — configurable private channel ID for admin support notifications
- **Discord Test Bot buttons** — test alerts channel and support channel independently from the Integrations tab
- Zero-config credential fallback: all integration credentials fall back to environment variables if not set in the database, so a fresh deployment works without manual DB entry

### Fixed
- Flask catch-all proxy now correctly forwards POST request bodies and Content-Type headers to the backend (previously POST bodies were silently dropped, causing 502s)
- Backend HTTP errors are now propagated with their real status code instead of always returning 502
- Layout overlap between Discord panel and Game Servers section (constrained col-pair height)
- Session card placed in full-width banners area instead of the sidebar (was off-screen without scrolling)
- MOTD and alert poll intervals reduced (MOTD: 5 min → 30s, Alert: 60s → 10s)
- Docker deploy script updated to use `--no-cache` to prevent stale image layers

### Changed
- All integration credentials (YouTube, Discord, Steam) added to `gameznet.yml` environment section so they survive container restarts without manual re-entry
- Deploy script updated to source `/etc/gameznet/.env` and use `docker stack deploy` (previously `docker service update --force` which didn't re-read env vars)

---

## v1.7.0 — 2026-02-xx

- YouTube tab with category browsing, search, Sign in with Google (personalised feed), floating pop-out player, theater mode
- Discord panel on Home tab with live member list, voice activity, online counts
- Steam game detection — shows what game each player is currently playing
- Admin panel overhaul: token management, player roster with client version tracking, WireGuard peer stats
