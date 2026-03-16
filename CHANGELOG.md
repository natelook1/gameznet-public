# Changelog

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
