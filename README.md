# GamezNET

**Private game server network — secure, one command to join.**

No config files. No port forwarding. No technical knowledge needed.

> **Windows Only** — GamezNET is designed exclusively for Windows 10/11. The app and installer will not work on macOS or Linux.

---

## ⚡ Install

Press **Win + R**, type `powershell`, and hit Enter. Paste this and hit Enter:

```powershell
irm https://gamenet.natelook.workers.dev/install | iex
```

> Windows will ask for Administrator access — click **Yes**. The VPN needs it to create the secure tunnel.

*The installer handles everything automatically:*

- 📥 Downloads the GamezNET app
- 🐍 Installs Python if missing
- 🔒 Installs WireGuard VPN if missing
- 🖥️ Creates a GamezNET shortcut on your desktop

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
| Cloudflare Worker + KV | Token management, API, install script delivery |
| GitHub | Client file hosting — pulled fresh on every install |
| Flask (localhost:7734) | Local app server running on the user's PC |
| WireGuard | The secure VPN tunnel |
| UDM Pro | The server-side WireGuard endpoint |

### Requirements

- **Client:** Windows 10 or 11 (64-bit), internet connection
- **Admin:** Cloudflare account with Workers + KV, a WireGuard-capable router (e.g. UDM Pro)

### Adding a Player

1. On your server (e.g. UDM Pro), add them as a WireGuard peer
2. Assign a VPN IP (e.g. `192.168.8.x/32`) and generate a keypair
3. Open the **Admin Panel** at `https://gamenet.natelook.workers.dev/admin`
4. Enter their name, VPN IP, and private key → **Generate Token**
5. Send them the token and the install command

### Deploying Updates

```bash
# Update the API/Worker logic
wrangler deploy

# Update client files (users get these on next install)
git add .
git commit -m "Update"
git push
```

### Environment Variables (Cloudflare Dashboard)

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Password for the admin panel (set as a secret) |
| `CLOUDFLARE_API_TOKEN` | Token with DNS:Edit permissions (optional, for DDNS) |
| `CLOUDFLARE_ZONE_ID` | Zone ID for your domain (optional, for DDNS) |
| `CLOUDFLARE_DNS_RECORD_ID` | A-record ID to update (optional, for DDNS) |

### KV Keys

| Key | Description |
|---|---|
| `token:<TOKEN>` | Per-token record (name, IP, private key, redeemed status) |
| `token_index` | JSON array of all token IDs |
| `SERVER_ENDPOINT_IP` | Current server IP (updated by UDM Pro heartbeat) |
| `SERVER_PUBLIC_KEY` | WireGuard server public key |
| `SERVER_ALLOWED_IPS` | Allowed IP ranges pushed to clients |
| `MOTD_MESSAGE` | Message of the Day shown in the client app |
| `APP_VERSION` | Current app version string |

</details>

---

License: MIT
