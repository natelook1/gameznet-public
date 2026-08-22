# Changelog

## v1.11.0 — 2026-08-22

### Fixed
- **`/api/heartbeat` had no authentication** — anyone could spoof any player's presence, force-disconnect a player by name (which triggered a real SSH call removing their WireGuard peer from the UDM), or steer which IP a player's peer gets bound to on reconnect. Route now requires a valid `X-Token` (`requirePlayer`) and derives the player's name from the verified token instead of trusting the request body. All client call sites (`app.py`, `index.html`, `wow.js`) updated to send `X-Token`; `test_endpoints.ps1` now provisions and cleans up a throwaway test token.
- **Stale WireGuard tunnel silently adopted as "connected" after reboot** — the tunnel runs as an `AUTO_START` Windows service that comes back up on every boot independently of GamezNET, before the app even launches. The old startup check only asked whether the service *responded*, not whether the peer had a live handshake, so a dead/stale tunnel (UDM had already dropped the peer while the PC was off) got marked connected anyway — the app then routed its own API calls through a dead tunnel and silently failed/denied internet until a manual connect/disconnect. Startup now verifies handshake age (`tunnel_handshake_is_live`, shared with the existing heartbeat dead-tunnel check) and tears the tunnel down immediately if stale, instead of adopting it. Also fixed the orphan-teardown call using `wg.exe` instead of `wireguard.exe` for `/uninstalltunnelservice`, which meant that cleanup path was likely silently failing too.
- **Admin panel had unescaped stored XSS reachable without authentication** — `renderRequests`/`renderReports` rendered `/api/request-access` and `/api/report` fields (both unauthenticated endpoints) straight into `innerHTML`. Combined with the admin panel caching the plaintext admin password in `localStorage`, this chained to full admin credential theft. Added a shared `esc()` helper and applied it to every `innerHTML` sink rendering user- or player-controlled data across the admin panel.
- **WireGuard private keys were stored in plaintext in the DB** — a single SQLite leak would have exposed every player's VPN private key at once. `tokens.private_key` is now encrypted at rest with AES-256-GCM (new `db_encryption_key` Docker secret); decryption falls back to plaintext for pre-existing rows, no migration needed. `/api/mobile/revoke` and `/api/mobile/session-status` no longer use the raw private key as a bearer credential — both now use `requirePlayer`/`X-Token` like the rest of the API. `/admin/tokens` no longer sends `private_key` to the browser at all.
- **Unauthenticated SSRF via `/api/chat/link-preview`** — anyone could probe internal network services (including the UDM) with no auth and no restriction on the target host. Added `requirePlayer` auth and a resolve-then-validate guard blocking private/loopback/link-local/CGNAT/reserved IP ranges (checked against the resolved address, so DNS-rebinding domains are caught too), plus manual redirect handling so each hop is re-validated instead of blindly following redirects to internal addresses.
- **RustDesk remote-control endpoints had no local authentication** — `/api/remote/start-host`/`start-helper` (loopback-only) would launch RustDesk and connect it to an attacker-chosen ID/password for any local process that hit the right port, no confirmation dialog. Added a per-process random `LOCAL_SECRET`, generated at startup and only known to the page GamezNET itself served, required via `X-Local-Secret` on both routes.

### Known gaps (documented, not fixed this release)
- **Auto-update (`/api/update`) has no code-signing or checksum verification** — `GamezNET.exe` is currently unsigned. A compromised release pipeline could silently ship a poisoned installer to every player. Real fix is Authenticode code-signing (planned, not yet set up) plus signature verification in the update flow — deliberately deferred rather than patched with a stopgap, given how central the git-pull-based install/deploy flow is to this app.
- See `gameznet-security-audit-2026-08.md` in infra-notes for the full list of remaining findings.

---

## v1.11.1 — 2026-08-22

### Fixed
- **`/admin/token/revoke` crashed the whole backend process on a missing token** — `req.body.token` was never validated before hitting a `better-sqlite3` query with a required `?` placeholder; `undefined` throws a hard `RangeError` instead of a normal error response. Swarm's restart policy was masking this as a silent process restart. Found live in production logs immediately after a deploy. Added the missing `if (!req.body.token) return res.status(400)...` guard.

---

## v1.11.2 — 2026-08-22

### Fixed
- **RCE in Conan Exiles admin search** — `GET /api/conan-exiles/admin/search` interpolated the user-controlled `name` param directly into Python source text inside a raw string literal, escaping only SQL-style quotes, which doesn't neutralize Python string-literal syntax. Confirmed exploitable. `name` is now passed as a separate argv entry via `execFileSync('python', ['-c', script, name])` and read from `sys.argv[1]`, never interpolated into the script source. Verified locally and added a regression test with the original injection payload shape.
- **Blueprint upload path traversal** — `X-Filename`/`X-Blueprint-Folder` headers went straight into `path.join()` with no traversal check; any authenticated player could write files outside `blueprints/`. Added `safeJoin()`, verified against relative traversal, absolute paths, and UNC paths.
- **Stored XSS via SVG chat uploads** — `/api/chat/uploads/:filename` served `image/svg+xml` inline with no `Content-Disposition` header, unlike the general file-download route. Now forces `attachment` for SVG. Also closed the upload endpoint's `X-Player-Name` fallback that let anyone upload "as" another player with zero proof of identity — now requires `requirePlayer`/`X-Token`.
- **OAuth account-linking spoofing (BattleNet, Steam)** — `/auth/battlenet` and `/auth/steam` accepted a bare player name with no proof of ownership, round-tripped through the OAuth provider and trusted verbatim in the callback. Both now require a real player token, verified server-side; the resolved name (never attacker input) is what gets linked. `/api/steam/unlink` had the same bare-name pattern for a non-OAuth action, switched to `requirePlayer`/`X-Token`.
- **Identity spoofing across all chat actions** — `chat/send`/`chat/dm/send` had an optional `X-Token` path that silently fell back to trusting the request body when absent (which the desktop client always did); `chat/typing`/`chat/react`/`chat/delete` had no token support at all. All five now require `requirePlayer` unconditionally.
- **`requireAdmin` had no rate limiting** — practically brute-forceable at whatever throughput the network allows. Added `express-rate-limit`: 20 failed attempts per 15 minutes per source IP, then 429. Only failed attempts count, so legitimate admin usage is never slowed.

### Deliberately deferred
- Player token / mobile session expiry, full client-side WireGuard keygen, auto-update code-signing, and the admin panel's `localStorage` session storage were all discussed and intentionally scoped out of this pass — see `gameznet-security-audit-2026-08.md` in infra-notes for the reasoning on each.

---

## v1.10.13 — 2026-05-31

### Added
- **Isometric map viewer (`/zomboid-iso`)** — OpenSeadragon-based deep-zoom viewer for the pzmap2dzi isometric tile set. Displays player markers, vehicle markers, death locations with timestamps, town zone overlays, and a zombie density heatmap — all as zero-lag OSD overlays that reposition on every viewport update
- **Real-time Lua mod SSE pipeline** — server-side GamezNET Lua mod writes player positions, vehicle data, and zombie counts to JSON files in `.cache/Lua/`; the backend streams updates via SSE every 2s; the iso viewer and zomboid map consume the same feed
- **Live Lua mod player layer** — iso viewer separates Lua mod live positions from the SQL roster so offline players (DB only) and online players (Lua feed) are rendered distinctly; live layer takes priority when both sources have data for the same name
- **normalize_dzi_tiles.py** — utility to rebase pzmap2dzi tile output to 0-based coordinates and patch the DZI `Width`/`Height` to match the actual content extent, eliminating the blank-canvas offset problem
- **Vehicle overlays** — vehicles shown as colored dots on the iso viewer (blue = good engine, amber = damaged, red = wreck); wrecks get a dark pill label; lazy-loaded in chunks to avoid UI freeze
- **Zombie density heatmap** — live zombie counts from the Lua mod rendered as a canvas heatmap layer with absolute-threshold coloring; updates on SSE tick

### Fixed
- **Post-sleep zombie/hung state** — resolved all three root causes of the app hanging after system sleep: (1) `QueryUnbiasedInterruptTime`-based sleep detection (unbiased time freezes during suspend, so ~0s elapsed after a 3s `time.sleep()` correctly identifies a wake cycle); (2) SSE stream reconnect on wake; (3) heartbeat failure force-reconnect after sustained tunnel death
- **SSE players/vehicles no longer wipe DB data on empty Lua file** — empty or missing Lua output is now a no-op instead of clearing the stored state
- **ISO viewer tile split artifact** — fixed diagonal split by reverting composited-tile experiments; uses one DZI layer at a time with `immediateRender:true`
- **ISO viewer marker drift** — markers now use the current visible layer item for `squareToViewport` to prevent per-zoom drift; race condition on initial load resolved
- **OSD minLevel=14** — stops OpenSeadragon requesting zoom levels below the tile pyramid, eliminating spurious 404s
- **Pan tracking on heatmap** — heatmap canvas correctly follows viewport pan; `homeFillsViewer` and `constrainDuringPan` disabled to stop map shift on zoom
- **Lua mod JSON path** — mod output read from `.cache/Lua/` subdirectory (not `.cache/` root)

---

## v1.10.12 — 2026-05-25

### Added
- **Project Zomboid integration** — new `/zomboid` page (desktop and web) with a live top-down tile map, player markers, vehicle markers, death history, town zone overlays, zombie density heatmap, in-game time/day display, and kill leaderboard
- **PZ map tile pipeline** — Leaflet-based tile map using pzmap2dzi-rendered cells; `PZ_SCALE=300/16` so one Leaflet tile equals one PZ cell at zoom 4; `expand-tiles.ps1` auto-expands tile bounds as players explore new cells
- **Map overlay layers** — campfires, farming plots, traps, dead players (10 most recent, from full session logs), zombie density grid
- **Map controls** — fullscreen toggle, overlay controls panel, players/vehicles toggles with state persisted to `localStorage`
- **`sync-tiles.ps1`** — standalone tile rsync script for pushing tile updates without a full release
- **`expand-tiles.ps1`** — reads player history and expands `CELL_X_MIN/MAX`, `CELL_Y_MIN/MAX` automatically to cover all visited cells; snaps to multiples of 8 for zoom pyramid alignment
- **`/admin/player/lookup`** — unfiltered player row lookup endpoint (bypasses `test*`/`vprobe*` filter) for admin diagnostics

### Fixed
- **PZ players 503** — resolved backend 503 on `/api/pz/players`
- **Sleep/wake disconnect detection** — fixed false-positive disconnects during normal operation; correct detection now triggers clean disconnect after genuine sleep/wake cycle
- **`/zomboid` Flask route** — added route to desktop app so the page loads from the local server
- **Coordinate grid** — zomboid map now shows a coordinate grid overlay (was rendering as a solid green background)
- **`CELL_Y_MIN=16` hard floor** — no PZ map data exists above cy=16; setting this prevents empty tile requests at the top of the map
- **Tile URL mapping** — fixed cell-to-tile URL offset math; `PZ_SCALE` and tile size now consistent throughout
- **Pan/zoom stability** — stopped re-fitting map view to player positions on each update; clamped zoom; constrained pan to tile bounds

---

## v1.10.11 — 2026-05-25

### Added
- **Connection duration badge** — desktop and mobile who's online lists now show a badge indicating how long each player has been connected in the current session

---

## v1.10.10 — 2026-05-25

### Added
- **"Online for" duration** — who's online player cards show the elapsed connection time for each currently connected player

---

## v1.10.9 — 2026-05-24

### Added
- **Admin roster status badges** — each row now shows an explicit text badge alongside the dot: `ONLINE` (green, heartbeating), `ZOMBIE` (amber, heartbeating but session > 24h — old client that never properly disconnected), or no badge for inactive peers. `OFFLINE` badge moved from the identity column into the status cell for consistency
- **ZOMBIE detection** — clients heartbeating with a `connected_at` older than 24 hours are flagged as ZOMBIE, identifying pre-sweeper clients stuck in a broken session state that need a reconnect + update
- **Roster sorted by status then version** — ONLINE first, inactive peers middle, ZOMBIE last; within each group sorted by version descending so newest clients appear at the top
- **Admin HIDE/UNHIDE works reliably** — visibility is now server-authoritative. `/api/invisible` is a dedicated endpoint (token-authenticated); app.py proxies the VISIBLE button to the backend instead of piggybacking on the heartbeat. The heartbeat no longer overwrites the `hidden` flag, so admin toggles stick

### Fixed
- **Update Required button** — was triggering connect flow instead of launching the updater; now correctly triggers the in-app update
- **Admin roster card-title accent bar** — fixed `|` rendering artifact at lower zoom levels by switching from fixed `14px` height to `1em` so it scales with font size
- **vprobe/test player rows** — purged from DB on server startup; filtered from all admin roster queries so test runs don't litter the 30-day offline section

### Changed
- **Admin roster offline history** — extended from 2 hours to 30 days; dimmed offline section with separator row appended below live peers

---

## v1.10.5 — 2026-05-24

### Added
- **Conan Exiles Enhanced one-click auto-connect** — clicking LAUNCH in the Conan modal starts the game via Steam, watches the log for `PS_MainMenu`, then sends `F9 → F → Enter` via PostMessage to auto-connect to the server. First-time only: writes the F9 keybind to `Input.ini` under `[/Script/Engine.InputSettings]`
- **Conan modal** — copyable `directconnect` console command, how-to dropdown, and rename button added to the Conan server detail modal

### Fixed
- **Conan auto-connect robustness** — aborts if FLS offline mode is detected; guards against UE4 overwriting `Input.ini` by re-writing every 2s during load; delays F9 3s after `PS_MainMenu` to let UI settle
- **Disconnect flow hardening** — blocked auto-disconnect and manual disconnect during active connect; precise tunnel-state check before heartbeat auto-disconnect triggers
- **Auto-disconnect on sleep/wake** — correctly detects tunnel death after system sleep and disconnects cleanly
- **Chat SSE null guard** — guarded `_chatStream` null before close in onerror handler

---

## v1.9.1 — 2026-05-23

### Added
- **Commercial-grade chat/DM upgrade** — full message threading, reactions, edit/delete, read receipts, and typing indicators
- **Remote assistance fully working end-to-end** — complete RustDesk negotiation flow: event-driven state machine, SSE replacing poll for incoming requests, system notification + tab flash + looping beep for help requests, automatic cleanup on both sides
- **Self-hosted RustDesk relay** — hbbs+hbbr running as standalone host-network compose on the backend VM, bypassing the public RustDesk server login requirement
- **Tray notifications for game server start/stop** — SSE stream delivers `server_state` events; tray fires when a running server stops or an offline server starts

### Fixed
- **RustDesk TOML injection** — writes server options via `--option` IPC after daemon startup; strips `key_confirmed` and `[keys_confirmed]` from both sides to prevent stale auth state
- **Remote SSE + poll fallback** — restored poll alongside SSE so requests aren't missed when the stream isn't yet open
- **AudioContext unlock** — unlocked with a silent buffer on connect click for reliable notification sound
- **Chat message purge** — hard-deletes test messages by `from_name` during cleanup; excluded deleted messages from GET `/api/chat` and DM history

---

## v1.8.7 — 2026-05-21

### Added
- **Conan Exiles tab** — added to both desktop and mobile; live player/building map, guild roster, server stats via SSE stream from the Conan game DB
- **Conan map** — Leaflet tiled map with player markers, building clusters (from `actor_position`/`building_instances`), teleporters, and a toggleable legend; buildings drawn as rotated rectangles from quaternion transform data; map tiles rsync'd to the server separately from git
- **Landing page** — public `/` now shows a request-access form for prospective players instead of a bare 404
- **Dynamic Steam library detection** — expanded non-Steam process list; Steam library scanned for installed game detection

### Fixed
- **Map tile proxy** — tiles proxied through the desktop app Flask server; CF Pages mobile map prefixes API base URL correctly
- **Conan DB access** — opened with `immutable=1` to handle WAL mode on read-only Docker volume mount; building ownership joined via `guilds` table (not char ID directly)
- **SSE polling fallback** — falls back to polling when SSE is unavailable (Cloudflare strips SSE on CF Pages)
- **VPN disconnect cleanup** — proper heartbeat routing on disconnect, DNS flush, and stale tunnel detection

---

## v1.8.4 — 2026-05-12

### Added
- **Conan Exiles live map (initial)** — interactive canvas/Leaflet map with player positions and building markers pulled from the Conan game DB mounted as a Docker volume; coordinate calibration from ground-truth in-game positions
- **SSE fast/slow split** — players pushed every 5s, world data (buildings, thralls) every 60s on separate event types over one connection

### Fixed
- Multiple coordinate calibration passes to align world units to tile pixel space
- Building queries corrected to use `actor_position` for coordinates and `guilds` join for ownership

---

## v1.6.3 — 2026-04-29

### Added
- **Satisfactory map loading modal** — a blurred overlay with an animated progress bar and humorous step messages appears when the interactive map first loads, hiding the raw iframe loading state
- **Silent Satisfactory map hot-reload** — the backend increments a save version counter each time a new autosave is uploaded to R2. The map tab polls `/api/satisfactory/save-version` every 30s and, when a new version is detected, loads the updated map into a hidden ghost iframe; the visible map swaps in only after the ghost fires `load` — no modal, no flicker
- **Eaglercraft download via R2** — Eaglercraft is no longer pulled from GitHub (removed from source control due to repo size). It is now downloaded on-demand from the R2 bucket (`family-kiosk-photos`) when a player first clicks Play

### Changed
- **`dist/` removed from git** — the installer binary is no longer committed to the repo. `release.ps1` now SCPs `GamezNET-Setup.exe` directly to the code server before `publish.sh` runs, keeping git pulls fast
- **Release pipeline** — added installer existence guard and SCP upload step to `release.ps1`; removed `dist/GamezNET-Setup.exe` from the version bump commit

### Fixed
- **Eaglercraft prepare endpoint** — `/api/minecraft/prepare` now correctly checks the `templates/` directory (same as the serve route) before attempting a download, preventing a false "File not found" error when the file is already bundled

---

## v1.5.4 — 2026-04-27

### Added
- **File sharing** — players can upload files (up to 500 MB) to a shared drop folder accessible from the Files tab. Files are served directly and can be downloaded by anyone on the network
- **Public / Private file visibility** — when uploading, choose between Public (visible to everyone) or Private (restricted to specific players you select). Private files show a user selection checklist populated from currently online players
- **Upload settings modal** — a dialog appears on file select with a description field, public/private toggle, and multi-select user list; defaults to public so simple uploads stay frictionless
- **File identity & access control** — uploads are tied to the uploader's token; the backend enforces visibility rules so private files are filtered out for users not on the allowlist. Desktop app uses VPN IP lookup for identity; mobile app uses token auth
- **Admin file management** — the admin panel has a dedicated Files tab showing all files (public and private) regardless of visibility, with delete controls

### Changed
- **Non-Home tabs hidden until VPN connected** — Files, Discord, WoW, and YouTube tabs are greyed out and inaccessible until a VPN connection is active, making the connection requirement explicit

### Fixed
- **File uploads now require authentication** — unauthenticated upload attempts return 401
- **File downloads route directly to HTTPS backend** — previously broken due to Flask proxy not forwarding the token header correctly
- **Upload modal no longer fires on tab switch** — fixed a race condition where the file input change event could trigger without a file selected
- **Admin panel tabs and file download regression repaired** — a JS parse error introduced during admin panel refactor was breaking the login screen

---

## v1.4.1 — 2026-04-26

### Added
- **UDM WireGuard peer lifecycle** — the backend now manages WireGuard peers on the UniFi Dream Machine automatically: peers are added when a player connects (heartbeat), removed when they disconnect or time out, and re-added when they reconnect. No manual UDM configuration required after initial setup
- **KICK button** — admins can force-remove a player's UDM peer from the admin panel, immediately dropping their VPN access. The peer is blocked from reconnecting until they run GamezNET again (which re-adds them)
- **UDM sync** — `/admin/wg/sync` cross-references the token database against UDM peers and adds any missing entries. Run automatically; also available as a manual trigger in the admin panel
- **UDM purge** — `/admin/wg/purge` removes orphan peers from the UDM that have no matching token in the database, keeping the peer list clean

### Fixed
- **Invisible players shown as recently online** — players marked hidden were previously omitted entirely from the roster; now shown in a dimmed "recently online" state so admins can still see them

---

## v1.3.0 — 2026-04-15

### Changed
- **Network stability** — enforced `proxy_stable` Docker network for backend container, eliminating intermittent routing drops that caused heartbeat timeouts on busy hosts
- **MTU tuned to 1360** — reduced WireGuard MTU to prevent fragmentation-related packet loss on some ISPs

---

## v1.2.16 — 2026-04-10

### Added
- **Mobile WoW portraits & raid badge** — character portraits now load in the mobile WoW tab; raid progression badge displayed alongside character name
- **WoW icon for game identification** — WoW icon shown in the Who's Online list when a player is detected playing World of Warcraft

---

## v1.2.13 — 2026-04-05

### Fixed
- **WoW character avatars no longer revert to question marks on new devices/sessions** — the backend now persists the avatar URL to the database when a character profile is first fetched, so all clients get the correct image immediately from `/api/wow/characters` rather than waiting for the profile API to respond
- **Player Estate card no longer shows fake data** — replaced hardcoded "Tier 2 / Cozy Cabin / 1,250 Timber / 420 Stone" filler with an honest empty state noting that Blizzard has not yet published housing API endpoints (both desktop and mobile)
- **Level cap corrected to 90 in desktop app** — `wowRenderWorld` was using 80 as the level cap; updated to 90 to reflect the current Midnight expansion cap
- **Azj-Kahet zone range corrected** — zone was showing `Lvl 76–90`; corrected to `Lvl 76–80` since it's a War Within zone that completes at level 80

### Changed
- **Dungeon Unlock Status expanded** — added Delves (⛏️, unlocks at 70) and Mythic Raid (👑, unlocks at 90) to the unlock list in both desktop and mobile; desktop was previously showing only Normal Dungeons
- **Campaign Progress zones updated in desktop app** — replaced single "Khaz Algar" zone entry with the full War Within zone breakdown: Isle of Dorn, The Ringing Deeps, Hallowfall, and Azj-Kahet, each with correct level thresholds

### Added
- **Pull-to-refresh on WoW tab (mobile)** — drag down from the top of the WoW tab to trigger a full cache-clearing refresh; the ⟳ icon rotates as you pull, turns blue when past the threshold (65px), and spins while reloading. Clears character profile cache, affix cache, and Battle.net token cache so all data is re-fetched fresh

---

## v1.2.0 — 2026-04-01

### Milestone — Stable Release & Polished Delivery Pipeline

This release marks the first fully stable, end-to-end release of GamezNET as a compiled Windows application. The update mechanism, bootstrap installer, and build pipeline are all working reliably. No new features — just everything buttoned up.

### Fixed
- **In-app update flow overhauled** — clicking the update badge closes the current tab, the installer runs silently in the background, and GamezNET reopens automatically on the new version. No stuck screens, no manual relaunch.
- **New version auto-launches after silent update** — a flag in the installer was preventing auto-launch after `/VERYSILENT` runs; removed.
- **Committed installer always matches version** — exe is now built *before* the git commit during a version bump, so the binary in the repo matches the version it was tagged under.
- **Bootstrap installer UX** (`irm … | iex`) — live progress bars during downloads, labelled step indicators, and a proper "Press Enter to close" prompt when done.
- **Installer branding** — GamezNET logo shown in the wizard header on all installer pages.

---

## v1.1.16 — 2026-04-01

### Added
- `/api/session/set` and `/api/session/clear` — admin endpoints to create and clear the scheduled session; already wired in the PC UI session scheduler
- `/api/discord/presence` — lightweight member list with online status and activity, purpose-built for the mobile app
- `/api/discord/voice` — voice channel occupancy endpoint for mobile app

### Fixed
- Removed duplicate `/api/youtube/search` route definition (second copy was dead code, never reached by Express)

---

## v1.1.15 — 2026-04-01

### Changed
- **Onedir installer build** — switched from PyInstaller one-file to one-dir mode. DLLs now live alongside the exe in `%LOCALAPPDATA%\GamezNET\` — no runtime extraction to `%TEMP%`, eliminating Windows Defender false positives on `python313.dll`
- **Installer delivery via GitHub Releases** — `/install` PowerShell script now downloads `GamezNET-Setup.exe` directly from GitHub Releases instead of the old Python-based approach. No Python, pip, or `.bat` files involved
- **WoW tab cleanup** — removed development-only source status indicators (API ACTIVE / NOT CONFIGURED badges, Blizzard API info box) from the WoW account section

### Fixed
- `web-push` added as explicit backend dependency (was required by server.js but missing from package.json)
- Release pipeline no longer commits build artifacts (`dist/` and `build/` properly gitignored)
- Hardcoded GitHub token removed from `publish.sh` — reads from `/etc/gameznet/gh_token` on the code server

---

## v1.1.3 — 2026-03-25

### Added
- **Mobile Companion App** — a static Preact SPA served via Cloudflare Pages (`m.gameznet.looknet.ca`). Works on any device with a browser — no install required. Features: Who's Online, Game Server status, Network Chat, Discord channel browser, and Direct Messages
- **Mobile token auth** — `X-Token` header validated against active tokens on the backend; mobile identity is enforced server-side on all write operations (chat send, DM send, Discord send) preventing impersonation
- **`GET /api/mobile/whoami`** — validates a token and returns player identity for mobile first launch
- **`mobile_enabled` flag** — per-token toggle to enable or disable mobile access without revoking the token; admin panel shows a 📱/📵 toggle per player

### Fixed
- Update SSL handling now tries the Windows certificate store first, falls back to certifi, then unverified — fixes update failures on machines with broken Python cert stores (e.g. fresh Python 3.12 installs)

---

## v1.1.2 — 2026-03-25

### Fixed
- Auto-migrate token into local config on first mobile QR request — existing installs no longer need to re-provision

---

## v1.1.1 — 2026-03-25

### Added
- **Mobile QR sync** — "SYNC MOBILE APP" button in the Your Session card generates a scannable QR code; scanning opens the mobile app with the token pre-filled and auto-logs in
- **DM unread badge** — red badge on the DMs tab in the mobile app now updates regardless of which tab is active
- **RAM usage bars** — game server chips and detail sheet now show accurate RAM usage vs allocated limit

### Fixed
- Log file now rotates at 5 MB with 3 backups, preventing unbounded growth

---

## v1.1.0 — 2026-03-25

### Changed
- **Compiled Windows installer** — GamezNET is now distributed as `GamezNET-Setup.exe`. No Python, Git, or pip required. Installs to `%LOCALAPPDATA%\GamezNET\` with a desktop shortcut and runs as a native Windows executable.
- **WireGuard bundled** — included in the installer and installed silently if not already present.
- **Silent in-place updates** — clicking the update badge closes the current tab, runs the new installer silently in the background, and relaunches the app automatically. No user interaction required. *(Fully stabilised in v1.2.0.)*
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

---

## v1.0.1 — 2026-03-19

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

---

<details>
<summary>Pre-revert history (archived)</summary>

These entries predate a full version reset to v1.0.0. Version numbers were non-sequential during this period.

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

</details>
