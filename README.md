# GamezNET

**Private game server network — secure, one command to join.**

No config files. No port forwarding. No technical knowledge needed.

---

## Install

Press `Win + R`, type `powershell`, hit Enter. Paste this and hit Enter:

```powershell
irm https://gamenet.natelook.workers.dev/install | iex
```

> Windows will ask for Administrator access — click **Yes**. The VPN needs it.

The installer handles everything:
- Downloads the GamezNET app
- Installs Python if you don't have it
- Installs WireGuard VPN if you don't have it
- Creates a **GamezNET** shortcut on your desktop

When it finishes, the app opens in your browser automatically.

---

## First-Time Setup

1. Enter the **invite token** the admin sent you
2. Click **Activate Token** — your credentials are saved permanently
3. Click **Connect to Server**
4. Launch your game

That's it. You won't need the token again.

---

## Daily Use

1. Double-click **GamezNET** on your desktop
2. Click **Connect to Server**
3. Play

When you're done, click **Disconnect** in the app. The VPN tunnel closes cleanly.

---

## Troubleshooting

**App didn't open after installing**
Run the install command again — it's safe to repeat and will fix most problems.

**"Python not found" when launching**
Run the install command again. It will detect what's missing and fix it automatically.

**"Invalid token"**
Make sure the token was copied exactly, dashes included — they look like `XXXX-XXXX-XXXX-XXXX`. Contact the admin if it still won't activate.

**Need to enter a new token**
Click **Change Token** in the bottom-right corner of the app.

**Browser didn't open automatically**
Go to `http://localhost:7734` in any browser.

**Connected but can't reach the game server**
Wait 10 seconds after connecting and try again. If it keeps failing, let the admin know.

---

## Need Help?

Message the server admin. Running the install command again solves most issues.

---

<details>
<summary>⚙️ Admin & Developer Reference</summary>

### Architecture

| Component | Role |
|-----------|------|
| Cloudflare Worker + KV | Token management, API, install script delivery |
| GitHub (this repo) | Client file hosting — pulled fresh on every install |
| Flask on localhost:7734 | Local app server running on the user's PC |
| WireGuard | VPN tunnel |
| UDM Pro | WireGuard server |

### Key URLs

| | |
|---|---|
| Admin panel | https://gamenet.natelook.workers.dev/admin |
| Install script | https://gamenet.natelook.workers.dev/install |
| Token API | https://gamenet.natelook.workers.dev/api/redeem |

### Adding a Player

1. On the UDM Pro, add them as a WireGuard peer — assign a VPN IP (e.g. `192.168.8.x/32`) and generate a keypair
2. Open the [admin panel](https://gamenet.natelook.workers.dev/admin)
3. Enter their name, assigned VPN IP, and private key → **Generate Token**
4. Send them the token and the install command above

### Revoking a Player

Click **Revoke** next to their token in the admin panel. Remove their peer from the UDM Pro WireGuard config to fully cut access.

### Deploying Updates

```bash
# Cloudflare Worker
wrangler deploy

# Client files (users get these automatically on next install)
git add .
git commit -m "your message"
git push
```

### Server Config (app.py)

```python
SERVER_PUBLIC_KEY = "your-server-public-key"
SERVER_ENDPOINT   = "your.public.ip:51820"
ALLOWED_IPS       = "192.168.8.0/24, 192.168.1.0/24"
```

</details>