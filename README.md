# GamezNET

**Private game server network — secure, invite-only, one command to join.**

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

*The installer handles everything automatically:*

- 📥 Downloads the GamezNET app
- 🐍 Installs Python if missing
- 🔒 Installs WireGuard VPN if missing
- 🖥️ Creates a GamezNET shortcut on your desktop and Start Menu

When it finishes, the app opens in your browser automatically.

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

---

## 🛠️ Troubleshooting

**App didn't open after installing**
Run the install command again — it's safe to repeat and will fix most environment problems.

**"Python not found" when launching**
Run the install command again. It detects what's missing and fixes it automatically.

**"Invalid token"**
Make sure the token was copied exactly, dashes included — they look like `XXXX-XXXX-XXXX-XXXX`. Contact the admin if it still won't activate.

**"Token already redeemed"**
Your token was already used. Contact the admin to get a new one.

**Need to enter a new token**
Click **Change Token** in the bottom-right corner of the app.

**Browser didn't open automatically**
Go to `http://localhost:7734` in any browser.

**Connected but can't reach the game server**
Wait 10 seconds after connecting and try again. If it keeps failing, let the admin know.

---

## 🤝 Need Help?

Message the server admin. Running the install command again solves 99% of issues.

---

<details>
<summary>⚙️ Admin & Developer Reference</summary>

### Architecture

| Component | Role |
|---|---|
| Node.js/Express backend | Token management, API, install script delivery |
| SQLite | Persistent storage for tokens, settings, players |
| Docker Swarm | Backend deployment and orchestration |
| Traefik | Reverse proxy routing `gameznet.looknet.ca` |
| Flask (localhost:7734) | Local app server running on the user's PC |
| WireGuard | The secure VPN tunnel |

### Requirements

- **Client:** Windows 10 or 11 (64-bit), internet connection
- **Admin:** Docker Swarm cluster, Traefik reverse proxy, WireGuard-capable router

### Adding a Player

1. On your router/server, add them as a WireGuard peer
2. Assign a VPN IP and generate a keypair
3. Open the **Admin Panel** at `https://gameznet.looknet.ca/admin`
4. Enter their name, VPN IP, and private key → **Generate Token**
5. Send them the token and the install command

### Deploying Updates

```bash
# Edit external.yml or other config on Windows
git add .
git commit -m "Update"
git push

# On swarm-mgr-01
deploy-traefik

# To redeploy the backend after rebuilding the image on gamez-vm
docker stack deploy -c ~/gameznet.yml gameznet
```

### Environment Variables

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password for the admin panel |
| `PTERODACTYL_API_KEY` | Pterodactyl client API key for server status |

### Backend API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/server-config` | GET | WireGuard config for client |
| `/api/version` | GET | Minimum required app version |
| `/api/motd` | GET | Message of the day |
| `/api/alert` | GET | Active alert banner |
| `/api/heartbeat` | POST | Player online status update |
| `/api/online` | GET | List of online players |
| `/api/redeem` | POST | Redeem an invite token |
| `/install` | GET | PowerShell installer script |
| `/admin` | GET | Admin console UI |

</details>

---

License: MIT
