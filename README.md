# GamezNET

**Private game server network — secure, simple, one command to get started.**

No config files. No technical knowledge needed. If you can open PowerShell and paste a line, you're good.

---

## Getting Started

### Step 1 — Install

Press `Win + R`, type `powershell`, hit Enter. Then paste this and hit Enter:

```powershell
irm https://gamenet.natelook.workers.dev/install | iex
```

> Windows will ask for Administrator access — click **Yes**. The VPN needs it to work.

The installer handles everything automatically:
- Downloads the app
- Installs Python (if you don't have it)
- Installs WireGuard VPN (if you don't have it)
- Creates a **GamezNET** shortcut on your desktop

When it's done, the app opens in your browser automatically.

---

### Step 2 — Enter Your Token

When the app opens you'll see a token field. Enter the invite token the admin sent you and click **Activate Token**.

Your credentials are saved — you'll never need to enter the token again.

---

### Step 3 — Connect

Click **Connect to Server**. That's it. Launch your game and join the server.

---

## Every Time After That

1. Double-click **GamezNET** on your desktop
2. Click **Connect to Server**
3. Play

When you're done, click **Disconnect** — or just close the browser tab. Either way the VPN drops cleanly.

---

## Common Issues

**The app didn't open after installing**
Run the install command again — it's safe to repeat and will fix most issues.

**"Python not found" or similar error when launching**
Run the install command again. It will detect what's missing and fix it.

**"Invalid token"**
Double-check the token was copied correctly, dashes included. Tokens look like `XXXX-XXXX-XXXX-XXXX`. Contact the admin if it still doesn't work.

**Got a new token and need to update**
Click **Change Token** in the bottom-right corner of the app.

**Browser didn't open automatically**
Open your browser and go to: `http://localhost:7734`

**Connected but can't reach the game server**
Give it 10 seconds after connecting, then try again. If it keeps happening, contact the admin.

---

## Need Help?

Reach out to the server admin — don't struggle alone. Running the install command again fixes the majority of issues.

---

<details>
<summary>⚙️ Admin & Developer Reference</summary>

### Stack

| Component | Purpose |
|-----------|---------|
| Cloudflare Worker + KV | Token management, install script, API |
| GitHub (this repo) | Client file hosting |
| Flask (localhost:7734) | Local app server on user's PC |
| WireGuard | VPN tunnel |
| UDM Pro | WireGuard server |

### Key URLs

| | |
|---|---|
| Admin panel | https://gamenet.natelook.workers.dev/admin |
| Install endpoint | https://gamenet.natelook.workers.dev/install |
| Token redemption API | https://gamenet.natelook.workers.dev/api/redeem |

### Adding a Player

1. Add them as a WireGuard peer on the UDM Pro — assign them a VPN IP (e.g. `192.168.8.x/32`) and generate a keypair
2. Open the [admin panel](https://gamenet.natelook.workers.dev/admin)
3. Enter their name, VPN IP, and private key → click **Generate Token**
4. Send them the token and the install command

### Revoking a Player

Click **Revoke** in the admin panel. Also remove their peer from the UDM Pro WireGuard config.

### Deploying Worker Updates

```bash
wrangler deploy
```

### Pushing Client Updates

```bash
git add .
git commit -m "description"
git push
```

Users automatically get updated files next time they run the install command.

### UDM Pro Settings (app.py)

```python
SERVER_PUBLIC_KEY = "your-server-public-key"
SERVER_ENDPOINT   = "your.public.ip:51820"
ALLOWED_IPS       = "192.168.8.0/24, 192.168.1.0/24"
```

</details>