# GamezNET

**Private game server network — secure, one command to join.**

No config files. No port forwarding. No technical knowledge needed.

## ⚡Install 

Press Win + R, type powershell, and hit Enter. Paste this and hit Enter:

```powershell
irm https://gamenet.natelook.workers.dev/install | iex
```

Note: Windows will ask for Administrator access — click Yes. The VPN needs it to create the secure tunnel.

*The installer handles everything:*

📥 Downloads the GamezNET app

🐍 Installs Python (if missing)

🔒 Installs WireGuard VPN (if missing)

🖥️ Creates a GamezNET shortcut on your desktop

When it finishes, the app opens in your browser automatically.

## 🔑 First-Time Setup

Enter the invite token the admin sent you.

Click Activate Token — your credentials are saved permanently.

Click Connect to Server.

Launch your game.

That's it. You won't need the token again.

## 🎮 Daily Use

Double-click GamezNET on your desktop.

Click Connect to Server.

Play.

When you're done, click Disconnect in the app. The VPN tunnel closes cleanly.

## 🛠️ Troubleshooting

App didn't open after installing
Run the install command again — it's safe to repeat and will fix most environment problems.

"Python not found" when launching
Run the install command again. It will detect what's missing and fix it automatically.

"Invalid token"
Make sure the token was copied exactly, dashes included — they look like XXXX-XXXX-XXXX-XXXX. Contact the admin if it still won't activate.

Need to enter a new token
Click Change Token in the bottom-right corner of the app.

Browser didn't open automatically
Go to http://localhost:7734 in any browser.

Connected but can't reach the game server
Wait 10 seconds after connecting and try again. If it keeps failing, let the admin know.

## 🤝 Need Help?

Message the server admin. Running the install command again solves 99% of issues.

<details>
<summary>⚙️ Admin & Developer Reference</summary>

### Architecture

| Component | Role |
| Cloudflare Worker + KV | Token management, API, install script delivery |
| GitHub | Client file hosting — pulled fresh on every install |
| Flask (localhost:7734) | Local app server running on the user's PC |
| WireGuard | The secure VPN tunnel |
| UDM Pro | The server-side WireGuard endpoint |

Adding a Player

On your server (e.g. UDM Pro), add them as a WireGuard peer.

Assign a VPN IP (e.g. 192.168.8.x/32) and generate a keypair.

Open the Admin Panel.

Enter their name, VPN IP, and private key → Generate Token.

Send them the token and the install command.

Deploying Updates

# Update the API/Redemption logic
wrangler deploy

# Update client files (users get these on next install/run)
git add .
git commit -m "Update"
git push



</details>

License

Distributed under the MIT License. See LICENSE for more information.
