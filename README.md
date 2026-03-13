🎮 GamezNET

Private game server network — secure, simple, one command to get started.

No config files. No technical knowledge needed. If you can open PowerShell and paste a line, you're good.

🚀 Getting Started

Step 1 — Install

Press Win + R, type powershell, and hit Enter. Then paste this command and hit Enter:

irm [https://gamenet.natelook.workers.dev/install](https://gamenet.natelook.workers.dev/install) | iex


🛡️ Note: Windows will ask for Administrator access — click Yes. The VPN needs these permissions to securely configure the network tunnel.

The installer handles everything automatically:

📥 Downloads the app components.

🐍 Installs Python 3 (if you don't have it).

🌐 Installs WireGuard VPN (if you don't have it).

🖥️ Creates a GamezNET shortcut on your desktop.

When it's done, the installer opens the application folder so you can see your new files.

Step 2 — Activate

Double-click the GamezNET icon on your desktop.

A browser tab will open with a token field.

Enter the invite token the admin sent you and click Activate Token.

Your credentials are saved securely — you'll never need to enter the token again.

Step 3 — Connect

Click Connect to Server. That's it! Launch your game and join the server.

🕹️ Every Time After That

Double-click GamezNET on your desktop.

Click Connect to Server.

Play.

When you're done, click Disconnect — or just close the browser tab. Either way, the VPN drops cleanly.

🛠️ Common Issues

The app didn't open after installing
The installer opens the folder and creates a desktop icon. Double-click the GamezNET icon on your desktop to start.

"Python not found" or similar error when launching
Run the install command again. It will detect what's missing, fix the system paths, and get you running.

"Invalid token"
Double-check the token was copied correctly, dashes included. Tokens look like XXXX-XXXX-XXXX-XXXX. Contact the admin if it still doesn't work.

Got a new token and need to update
Click Change Token in the bottom-right corner of the app dashboard.

Browser didn't open automatically when launching
Ensure the terminal window is open, then go to: http://localhost:7734

Connected but can't reach the game server
Give it 10 seconds for the handshake to complete. If it persists, ensure your game is looking at the server address provided by the admin.

🆘 Need Help?

Reach out to the server admin — don't struggle alone. Running the install command again fixes the majority of issues by refreshing the core files.

<details>
<summary>⚙️ Admin & Developer Reference</summary>

Stack

Component

Purpose

Cloudflare Worker + KV

Token management, install script, Discovery API

Cloudflare DNS API

Automated sync for gaming.looknet.ca

GitHub Repo

Client file hosting

Flask (localhost:7734)

Local app server on user's PC

WireGuard

High-performance VPN tunnel

UDM Pro

WireGuard server & DDNS Heartbeat

Key URLs

Resource

URL

Admin Panel

gamenet.natelook.workers.dev/admin

Install Endpoint

gamenet.natelook.workers.dev/install

Discovery API

gamenet.natelook.workers.dev/api/server-config

Adding a Player

Add them as a WireGuard peer on the UDM Pro — assign them a VPN IP (e.g. 192.168.8.x/32) and generate a keypair.

Open the admin panel.

Enter their name, VPN IP, and private key → click Generate Token.

Send them the token and the install command.

Automated DDNS

The UDM Pro heartbeats to the worker every 15 minutes. This updates the internal KV store and triggers a Cloudflare API call to update the A record for gaming.looknet.ca to your current home IP.

Deploying Updates

Worker:

wrangler deploy


Client:
Push changes to GitHub. Users automatically get updated files next time they run the install command.

</details>
