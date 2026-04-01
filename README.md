# GamezNET

**Private game server network — secure, invite-only, one command to join.**

![GamezNET](static/screenshot.png)

---

## What is GamezNET?

GamezNET lets a group of friends connect to a private game server as if they were all on the same local network — no port forwarding, no public IP exposure, no tech skills required.

Under the hood it uses **WireGuard**, one of the fastest and most secure VPN protocols available. When you connect through GamezNET, your PC joins a private encrypted tunnel directly to the game server. From there you can play any game hosted on that server just like you were sitting in the same room.

**For players:** you get a one-time invite token from the admin, run a single install command, and you're done. The app sits in your system tray and connecting is one click.

**For the admin:** you control exactly who's in. Each player gets a unique token tied to their VPN credentials. Tokens can be revoked, and the server IP stays hidden from everyone — only the tunnel knows where it goes.

> **Windows Only** — GamezNET is designed exclusively for Windows 10/11. The app and installer will not work on macOS or Linux.

---

## ⚡ Install

Press **Win + R**, type `powershell`, and hit Enter. Paste this and hit Enter:

```powershell
irm https://gameznet.looknet.ca/install | iex
```

> **What does that command do?**
> `irm` (Invoke-RestMethod) downloads the GamezNET installer script from our server.
> `iex` (Invoke-Expression) runs it. This is the standard one-liner pattern for Windows app installers —
> the same method used by tools like Chocolatey and Scoop.
> You can inspect the script yourself by pasting just the `irm ...` part into your browser.

> Windows will ask for Administrator access — click **Yes**. The VPN needs it to create the secure tunnel.

*The installer handles everything automatically — no Python, Git, or technical setup required:*

- 📥 Downloads and runs the GamezNET installer (`GamezNET-Setup.exe`)
- 🔒 Installs WireGuard VPN silently if not already present
- 🖥️ Creates a **GamezNET** shortcut on your desktop and Start Menu
- 🚀 Launches GamezNET automatically when done

When it finishes, the app appears in your system tray and opens automatically.

---

## 🔑 First-Time Setup

1. Enter the invite token the admin sent you
2. Click **Activate Token** — your credentials are saved permanently
3. Click **Connect to Server**
4. Launch your game

That's it. You won't need the token again.

---

## 🎮 Daily Use

1. Double-click **GamezNET** on your desktop
2. Click **Connect to Server**
3. Play

When you're done, click **Disconnect** in the app or right-click the system tray icon. The VPN tunnel closes cleanly.

You'll get a **system tray notification** when a friend joins or leaves the network while you're connected, and when the admin posts a broadcast alert.

Once connected, the Network panel collapses and a live **● CONNECTED** pill appears in the tab bar showing your VPN IP and session timer. Click it to open a telemetry dropdown (ping, handshake, data transfer) and disconnect.

The three dashboard panels (**Steam Social**, **Your Session / Who's Online**, **Network**) can be dragged into any order — grab the `· · ·` handle at the top of each column and drop it where you want it. Your layout is saved automatically.

**Network Chat** is available as a floating panel that snaps to the left or right edge of the window. It supports **Tabbed Chat** and **Direct Messages (DMs)** — right-click any player in the "Who's Online" or Discord lists to start a private conversation. You can minimize the panel into a compact pill that shows an active unread message badge.

---

## 🖥️ Game Servers

The **Home** tab shows a compact horizontal strip of **Server Chips** for all hosted game servers. Running servers are highlighted in green. 

Clicking a server chip opens a **Detail Modal** displaying CPU load, RAM usage, and uptime. From the modal you can:
- Click the **Server IP** or **Port** buttons to quickly copy them to your clipboard
- Click **▶ STEAM JOIN** to launch Steam and connect directly to the server (if supported)

---

## 📅 Scheduled Sessions

The **Home** tab shows the next scheduled game session when one is active. It displays the game name, host, scheduled time, message, and a live countdown. Sessions auto-expire 2 hours after the scheduled start time.

The admin can schedule a session from the **+ Schedule Session** button below the session card. Players get a system tray notification when a new session is posted.

---

## 🎙️ Discord

The **Discord** tab is a full embedded Discord experience — no Discord account or login required.

**Channel sidebar** — browse all text and voice channels organised by category. Voice channels show who's currently in them with live avatars.

**Message feed** — click any text channel to read the full message history. Messages render with Discord markdown (bold, italic, code blocks, spoilers, embeds, reactions, attachments, and replies). Consecutive messages from the same person are grouped cleanly.

**Send messages** — type in the input bar at the bottom and press Enter or click Send. Your message appears with your player name and Steam avatar — no BOT tag, no Discord login.

**Pinned messages** — click the 📌 button in the channel header to view all pinned messages for that channel.

**Live presence** — member list shows each person's status (online/idle/dnd/offline) and current activity in real time via Discord Gateway WebSocket.

**Tab badge** — online member count shown directly in the tab header at a glance.

**Join Discord** — button to open the server invite link in your browser.

---

## 📺 YouTube

The **YouTube** tab lets you browse and watch gaming videos without leaving the app.

- **Categories** — curated video feeds for the games we play: EVE Online, Project Zomboid, Satisfactory, Monster Hunter, Final Fantasy, Conan Exiles, Enshrouded, World of Sea Battle, World of Tanks, Tarkov, League of Legends, and chill music
- **Search** — search YouTube directly from the app; your last 5 searches are remembered
- **Sign in with Google** — sign in to unlock **My Feed**, a personalised stream of recent uploads from your subscribed channels. Your session persists across restarts.
- **Floating pop-out player** — detach any video into a draggable, resizable window that stays open while you switch tabs
- **Theater mode** — full-width immersive view for focused watching

---

## ⚔️ World of Warcraft

The **WoW** tab is a full guild roster and character tracker — no addons or third-party sites required.

- **Guild roster** — browse all characters added to the network, with class icons, realm, and region
- **Character profiles** — click any character to see their Raider.io score, progression, and recent activity
- **Collections** — view characters organised by player
- **WoW Token price** — live gold token price shown in the tab header
- **Link your Battle.net account** — sign in with Battle.net to automatically import your own characters. Your characters stay synced and are visible to other players on the network
- **Main / Alt designation** — mark characters as mains or alts; alts are nested under the main in the roster

**Setup (admin):** Configure Battle.net API credentials in the Admin Panel → Integrations tab. Players can then link their own accounts from the WoW tab.

---

## 💬 Player Status

Set a custom status visible to everyone on the network using the controls in the **bottom footer**. Use the preset buttons (**AFK**, **BRB**, **Gaming**) or type your own message and click **SET**. Your status appears next to your name in the online player list. Your status is saved locally and restored automatically after an app update or restart.

---

## ✏️ Changing Your Name

Click the **✎** icon next to your name in the profile header of the **Your Session** card to open the rename dialog. Enter a new name (2–24 characters, letters/numbers/spaces/dashes only) and click **Save**. The change is validated against your VPN identity server-side and takes effect immediately.

---

## 🔵 Steam Account

Link your Steam account once to unlock richer player cards across the network.

In the **Your Session** card, click **⊕ LINK STEAM ACCOUNT**. Your default browser opens a Steam login page — sign in to verify ownership, then close the window. Your profile is linked automatically.

Once linked, your player card in the **Who's Online** list shows:

- Steam avatar and display name
- Steam level and total games owned
- Top-played game with hours
- Game capsule strip — your 6 most-played games with hover tooltips

Steam profile data is cached and refreshed every 6 hours. You can unlink at any time from the **Your Session** card.

---

## 🛟 Remote Assistance

Players can request remote help directly from other online players — no admin involvement needed.

When you need help, click **Get Help from a Player** in the Your Session card. Select who you want help from, add an optional message describing the issue, and send the request. The other player gets a sound notification and can accept or decline.

If they accept, a progress modal walks both sides through the connection. A secure remote desktop session is established automatically over the WireGuard VPN using **RustDesk** — a free, open-source remote desktop tool. RustDesk is downloaded on first use and cached locally. The connection is direct and peer-to-peer; no traffic passes through a relay server.

Either player can cancel at any time using the **CANCEL** button in the modal. When one side ends the session, the other side's modal closes automatically.

---

## 🗑️ Uninstalling

Open **Settings → Apps** (or **Add/Remove Programs**), find **GamezNET**, and click **Uninstall**. It will:

- Confirm before proceeding
- Disconnect and remove the WireGuard VPN tunnel
- Stop the running app
- Delete the install directory and all GamezNET data files

WireGuard itself is left in place — it may be used by other applications.

---

## 📱 Mobile Companion

GamezNET has a mobile-friendly web app at **[m.gameznet.looknet.ca](https://m.gameznet.looknet.ca)** — no install required, works on any phone or tablet browser.

**What you can do on mobile:**
- See who's online and what they're playing
- Check game server status (CPU, RAM, uptime)
- Read and send Network Chat messages
- Browse Discord channels and send messages
- Direct message other players

**What requires the Windows app:**
- Connecting to the VPN
- Joining game servers
- Remote assistance

**First-time setup:**
1. Open `m.gameznet.looknet.ca` on your phone
2. Enter the same invite token you use on the desktop app
3. Done — your token works for both

> Mobile access can be revoked independently from the desktop app. The admin panel shows a 📱 toggle per player under the Tokens section.

---

## 🛠️ Troubleshooting

**App didn't open after installing**
Run the install command again — it's safe to repeat and will reinstall cleanly.

**"Invalid token"**
Make sure the token was copied exactly, dashes included — they look like `XXXX-XXXX-XXXX-XXXX`. Contact the admin if it still won't activate.

**"Token already redeemed"**
Your token was already used. Contact the admin to get a new one.

**Need to enter a new token**
Click **Change Token** in the bottom-right corner of the app.

**App won't start / tray icon missing**
Find **GamezNET** in your Start Menu or `%LOCALAPPDATA%\GamezNET\` and launch it from there. If it still won't start, run the install command again.

**Connected but can't reach the game server**
Wait 10 seconds after connecting and try again. If it keeps failing, let the admin know.

**Update required / version badge flashing**
Click the version badge in the top-right corner of the app — it will download the new installer and update silently in the background. The new version launches automatically when done.

---

## 🤝 Need Help?

Message the server admin. Running the install command again solves 99% of issues.

---

<details>
<summary>⚙️ Admin & Developer Reference</summary>

### Architecture

| Component | Role |
|---|---|
| Node.js/Express backend | Token management, API, install script delivery, YouTube/Discord/Steam/WoW proxy |
| SQLite | Persistent storage for tokens, settings, players, sessions |
| Docker Swarm | Backend deployment and orchestration |
| Traefik | Reverse proxy routing all `*.looknet.ca` traffic |
| Cloudflare Tunnel | Secure public exposure without open ports |
| Flask (gameznet.local:7734) | Local app server running on the user's PC |
| Cloudflare Pages | Hosts the static mobile companion SPA |
| WireGuard | The secure VPN tunnel |
| Pterodactyl + Wings | Game server management and console |
| YouTube Data API v3 | Server-side video category browsing (30-min cache) |
| YouTube OAuth2 | Sign in with Google for personalised feed |
| Discord Bot API v10 + Gateway WS | Channel/message/member/presence/voice — real-time via WebSocket; alert and support notifications |
| Steam Web API | Steam OpenID auth, player profile linking, avatar, level, game library |
| Blizzard Battle.net OAuth2 | Character import and account linking for WoW tab |
| Raider.io API | WoW character progression scores and raid history |

### Requirements

- **Client:** Windows 10 or 11 (64-bit), internet connection
- **Server:** Docker Swarm cluster, Traefik reverse proxy, Cloudflare Tunnel

### Adding a Player

1. On your router/server, add them as a WireGuard peer
2. Assign a VPN IP and generate a keypair
3. Open the **Admin Panel** at `https://gameznet.looknet.ca/admin`
4. Enter their name, VPN IP, private key, and optional Steam ID → **Generate Token**
5. Send them the token and the install command

### Admin Panel — Configuration

The **Configuration** card has two tabs:

**Settings tab** — WireGuard endpoint, public key, allowed IPs, local gateway, and minimum required client version. Also contains UDM SSH settings for automatic peer provisioning.

**Integrations tab** — API credentials stored securely in the database:

| Field | Description |
|---|---|
| YouTube API Key | YouTube Data API v3 key — enables category browsing and search |
| OAuth Client ID | Google OAuth 2.0 client ID — enables Sign in with Google |
| OAuth Client Secret | Google OAuth 2.0 client secret |
| Discord Bot Token | Bot token for the gamEZnet Discord server |
| Alerts Channel ID | Discord channel ID for server start/stop notifications |
| Support Channel ID | Private Discord channel for player support request notifications |
| Steam API Key | Steam Web API key — enables game detection, profile linking, avatar + level + library |

### Admin Panel — Incident Reports

The **Incident Reports** section shows player-submitted error reports. Each report has a **Dismiss** button to mark it read, and a **Clear all from [player]** button to delete every report from that player at once. Reports are rate-limited to one per 5 minutes per player.

### Admin Panel — Messages

The **Messages** card lets the admin post a **Message of the Day** (shown in the banner on every client) and a timed **Broadcast Alert** (shown as a coloured banner and triggers a tray notification on all connected clients).

### Admin Panel — Session Scheduler

Schedule a game session from the **Sessions** card. Pick a game (populated from running servers with Steam artwork), set a date/time and optional message, and post. All clients see the countdown card and receive a tray notification. Sessions auto-expire 2 hours after the scheduled start time.

### Building the Windows Client

The client is a compiled Windows exe built with PyInstaller + Inno Setup. Run on any Windows dev machine:

```bash
python build.py
# Output: dist/GamezNET-Setup.exe
```

`build.py` handles everything: generates the icon, downloads the WireGuard installer if needed, runs PyInstaller via `gameznet.spec` (onedir mode — DLLs alongside exe, no temp extraction), and compiles the installer via `gameznet.iss`.

Requires: `pip install pyinstaller pillow flask psutil pystray certifi web-push` and [Inno Setup 6](https://jrsoftware.org/isdl.php).

### Deploying Updates

**Backend (server.js):**
```bash
# On swarm-mgr-01
deploy-gameznet
```
Pulls latest code on gamez-vm, rebuilds the Docker image with `--no-cache`, and rolls out the stack.

**Client (GamezNET-Setup.exe):**

Run `.\release.ps1 -Bump patch` on the Windows dev machine. This builds the exe via PyInstaller + Inno Setup, commits it, and publishes it to the public repo's GitHub Releases automatically. Players receive the update the next time they click the update badge in the app.

### Environment Variables

All variables are loaded from `/etc/gameznet/.env` at deploy time. Credentials are also stored in the database via the Integrations tab and take precedence over env vars at runtime — env vars serve as the zero-config default for fresh deployments.

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password for the admin panel |
| `PTERODACTYL_API_KEY` | Pterodactyl client API key for game server status and control |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `YT_CLIENT_ID` | Google OAuth 2.0 client ID |
| `YT_CLIENT_SECRET` | Google OAuth 2.0 client secret |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_ALERTS_CHANNEL_ID` | Channel ID for server alerts |
| `DISCORD_SUPPORT_CHANNEL_ID` | Channel ID for support request notifications |
| `STEAM_API_KEY` | Steam Web API key |
| `SERVER_ENDPOINT_IP` | Public WireGuard endpoint IP |

### Backend API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/server-config` | GET | WireGuard config for client |
| `/api/version` | GET | Minimum required client version |
| `/api/motd` | GET | Message of the day |
| `/api/alert` | GET | Active alert banner |
| `/api/heartbeat` | POST | Player presence update (name, IP, game, ping, version, status) |
| `/api/online` | GET | List of online players |
| `/api/status/set` | POST | Set custom player status |
| `/api/servers` | GET | Game server status from Pterodactyl (30s cache) |
| `/api/session` | GET | Active scheduled session (auto-expires 2h after start) |
| `/api/session/set` | POST | Create or replace scheduled session |
| `/api/session/clear` | POST | Remove active session |
| `/api/rename` | POST | Change display name — validated by VPN IP + current name |
| `/api/report` | POST | Submit player support request (rate-limited: 1 per 5 min per player) |
| `/api/youtube/category` | GET | Curated videos by category |
| `/api/youtube/search` | GET | YouTube search proxy |
| `/api/youtube/feed` | GET | Personalised feed for authenticated user |
| `/api/discord/presence` | GET | Discord guild member list with live presence and online counts |
| `/api/discord/voice` | GET | Discord voice channel activity |
| `/api/discord/channels` | GET | Full channel tree (categories, text, voice) with member presence and voice state (30s cache) |
| `/api/discord/messages` | GET | Last 50 messages for a channel (10s per-channel cache) |
| `/api/discord/pins` | GET | Pinned messages for a channel |
| `/api/discord/send` | POST | Send a message via webhook (player name + Steam avatar) |
| `/api/steam/game` | GET | Steam player game detection (30s cache) |
| `/api/steam/news` | GET | Steam news feed for a game |
| `/api/steam/friends` | GET | Player's Steam friends list |
| `/api/steam/recent` | GET | Recently played games |
| `/api/wow/characters` | GET | Player's WoW characters |
| `/api/wow/characters/sync` | POST | Sync character data from Battle.net |
| `/api/wow/profile` | GET | Detailed character profile with Raider.io data |
| `/api/wow/account/status` | GET | Battle.net account link status |
| `/api/wow/account/unlink` | POST | Remove Battle.net link |
| `/api/wow/bnet/characters` | GET | Characters from linked Battle.net account |
| `/api/wow/token-price` | GET | Current WoW gold token price |
| `/auth/battlenet` | GET | Start Battle.net OAuth flow |
| `/auth/youtube` | GET | Start YouTube OAuth flow |
| `/auth/youtube/callback` | GET | OAuth callback handler |
| `/api/redeem` | POST | Redeem an invite token |
| `/install` | GET | PowerShell installer script |
| `/admin` | GET | Admin console UI |
| `/api/remote/request` | POST | Request remote help from another player |
| `/api/remote/pending` | GET | Poll for an incoming help request (helper side) |
| `/api/remote/accept` | POST | Accept an incoming request |
| `/api/remote/ready` | POST | Host posts RustDesk ID once started |
| `/api/remote/status` | GET | Poll session status and credentials |
| `/api/remote/end` | POST | End the remote session |
| `/api/remote/connected` | POST | Helper confirms RustDesk launched |
| `/auth/steam` | GET | Redirect to Steam OpenID login |
| `/auth/steam/callback` | GET | Steam OpenID callback — verify, fetch profile, link token |
| `/api/steam/profile` | GET | Fetch cached Steam profile by player name |
| `/api/steam/unlink` | POST | Remove Steam link from a token |

</details>

---

License: MIT
