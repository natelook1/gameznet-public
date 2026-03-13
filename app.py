"""
GamezNET - Local Flask Backend
Manages WireGuard tunnel via WireGuard Windows CLI.
Runs as localhost:7734 — opened automatically by GamezNET.bat
"""

import os
import sys
import json
import ctypes
import subprocess
import threading
import webbrowser
import time
import atexit
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL = "https://gamenet.natelook.workers.dev"
TUNNEL_NAME = "GamezNET"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gameznet_config.json")
SERVER_PUBLIC_KEY = "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
SERVER_ENDPOINT = "184.66.15.159:51820"
ALLOWED_IPS = "192.168.8.0/24, 192.168.1.0/24"
PORT = 7734

# ─── Utility ──────────────────────────────────────────────────────────────────

def resource_path(relative_path):
    """Works both for dev and PyInstaller."""
    try:
        base = sys._MEIPASS
    except AttributeError:
        base = os.path.abspath(".")
    return os.path.join(base, relative_path)

def wg_exe():
    # Check local install dir first
    local = resource_path("wireguard.exe")
    if os.path.exists(local):
        return local
    # Fall back to system install
    system = r"C:\Program Files\WireGuard\wireguard.exe"
    if os.path.exists(system):
        return system
    return None

# ─── Dynamic Server Config ───────────────────────────────────────────────────

def fetch_server_config():
    """
    Fetches live server config from the Cloudflare Worker.
    Falls back to hardcoded values if the Worker is unreachable.
    """
    import urllib.request
    try:
        with urllib.request.urlopen(f"{WORKER_URL}/api/server-config", timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return {
                "endpoint":   data.get("endpoint",  SERVER_ENDPOINT),
                "public_key": data.get("publicKey", SERVER_PUBLIC_KEY),
                "allowed_ips": data.get("allowedIPs", ALLOWED_IPS)
            }
    except Exception:
        # Worker unreachable — use hardcoded fallback silently
        return {
            "endpoint":   SERVER_ENDPOINT,
            "public_key": SERVER_PUBLIC_KEY,
            "allowed_ips": ALLOWED_IPS
        }

# ─── Zombie Tunnel Prevention ─────────────────────────────────────────────────

def cleanup_tunnel():
    """
    Ensures the WireGuard tunnel drops when this Python script exits,
    even if the user forcibly closes the background command prompt window.
    """
    try:
        wg = wg_exe()
        if wg:
            CREATE_NO_WINDOW = 0x08000000
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True,
                creationflags=CREATE_NO_WINDOW
            )
    except Exception:
        pass

# Register the cleanup function to run when the script terminates
atexit.register(cleanup_tunnel)

# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__)
_lock = threading.Lock()
_connected = False

@app.route("/")
def index():
    return render_template("index.html", connected=_connected, worker_url=WORKER_URL)

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({"connected": _connected})

@app.route("/api/connect", methods=["POST"])
def api_connect():
    global _connected
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "No configuration found. Please redeem a token first."}), 400
        
    try:
        with open(CONFIG_FILE, "r") as f:
            config_data = json.load(f)
            
        # Fetch live server config (falls back to hardcoded if Worker unreachable)
        srv = fetch_server_config()

        # Build the WireGuard config file
        conf_content = f"""[Interface]
PrivateKey = {config_data['private_key']}
Address = {config_data['vpn_ip']}

[Peer]
PublicKey = {srv['public_key']}
Endpoint = {srv['endpoint']}
AllowedIPs = {srv['allowed_ips']}
PersistentKeepalive = 25
"""
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        with open(conf_path, "w") as f:
            f.write(conf_content)
            
        # Install and start tunnel service
        wg = wg_exe()
        if not wg:
            return jsonify({"error": "WireGuard not found. Please run the installer again from https://gamenet.natelook.workers.dev/install"}), 500
        CREATE_NO_WINDOW = 0x08000000
        subprocess.run(
            [wg, "/installtunnelservice", conf_path],
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW
        )

        # Verify the tunnel actually came up by checking for a handshake
        handshake = False
        for _ in range(5):
            time.sleep(1)
            result = subprocess.run(
                [wg, "/show", TUNNEL_NAME],
                capture_output=True, text=True,
                creationflags=CREATE_NO_WINDOW
            )
            if "latest handshake" in result.stdout.lower():
                handshake = True
                break

        if not handshake:
            # Tunnel service installed but no handshake — clean up and report failure
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, creationflags=CREATE_NO_WINDOW
            )
            return jsonify({"error": "Could not reach the game server. Check your connection and try again."}), 503

        with _lock:
            _connected = True
        return jsonify({"success": True, "connected": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    global _connected
    try:
        wg = wg_exe()
        CREATE_NO_WINDOW = 0x08000000
        if wg:
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, text=True, timeout=10,
                creationflags=CREATE_NO_WINDOW
            )
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        if os.path.exists(conf_path):
            os.remove(conf_path)
            
        with _lock:
            _connected = False
        return jsonify({"success": True, "connected": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/config", methods=["GET"])
def api_config():
    """Returns current provisioning state to the UI on load."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"provisioned": False, "name": "", "client_ip": ""})
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        return jsonify({
            "provisioned": True,
            "name":      data.get("name", "Player"),
            "client_ip": data.get("vpn_ip", "")
        })
    except Exception as e:
        return jsonify({"provisioned": False, "name": "", "client_ip": ""}), 500

@app.route("/api/provision", methods=["POST"])
def api_provision():
    """Saves provisioned credentials after a successful token redemption."""
    data = request.json
    if not data or 'private_key' not in data or 'client_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump({
                "private_key": data["private_key"],
                "vpn_ip":      data["client_ip"],
                "name":        data.get("name", "Player")
            }, f)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/save_config", methods=["POST"])
def api_save_config():
    """Legacy alias for /api/provision — kept for backwards compatibility."""
    data = request.json
    if not data or 'private_key' not in data or 'vpn_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump({
                "private_key": data["private_key"],
                "vpn_ip":      data["vpn_ip"],
                "name":        data.get("name", "Player")
            }, f)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Clear provisioned credentials (for re-setup)."""
    if os.path.exists(CONFIG_FILE):
        os.remove(CONFIG_FILE)
    return jsonify({"success": True})

# ─── Entry Point ──────────────────────────────────────────────────────────────

def open_browser():
    time.sleep(1.2)
    webbrowser.open(f"http://localhost:{PORT}")

def ensure_admin():
    """Re-launch with admin rights if needed."""
    try:
        is_admin = ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        is_admin = False
    if not is_admin:
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, " ".join(sys.argv), None, 1
        )
        sys.exit()

def hide_console():
    """Hide the console window completely."""
    try:
        import win32console, win32gui
        win32gui.ShowWindow(win32console.GetConsoleWindow(), 0)
    except Exception:
        # Fallback using ctypes if pywin32 not available
        try:
            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 0)
        except Exception:
            pass

def make_tray_icon(connected=False):
    """Draw a simple GZ icon — cyan when connected, dark when not."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background circle
    bg_color = (0, 180, 220, 255) if connected else (30, 48, 70, 255)
    border_color = (0, 200, 255, 255) if connected else (80, 120, 160, 255)
    draw.ellipse([2, 2, size-2, size-2], fill=bg_color, outline=border_color, width=3)

    # "GZ" text
    text_color = (255, 255, 255, 255) if connected else (120, 160, 200, 255)
    try:
        font = ImageFont.truetype("arialbd.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "GZ", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 2), "GZ", fill=text_color, font=font)

    return img

def run_tray(flask_thread):
    """Run the system tray icon. Blocking — runs on main thread."""
    try:
        import pystray
        from PIL import Image
    except ImportError:
        # pystray/Pillow not available — fall back to visible console
        flask_thread.join()
        return

    icon_holder = {"icon": None}

    def refresh_icon():
        img = make_tray_icon(_connected)
        if img and icon_holder["icon"]:
            icon_holder["icon"].icon = img

    def on_open(icon, item):
        webbrowser.open(f"http://localhost:{PORT}")

    def on_disconnect(icon, item):
        if _connected:
            try:
                import urllib.request
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"http://localhost:{PORT}/api/disconnect",
                        method="POST"
                    ), timeout=5
                )
            except Exception:
                pass
            refresh_icon()

    def on_exit(icon, item):
        cleanup_tunnel()
        icon.stop()
        os._exit(0)

    def build_menu():
        status = "● Connected" if _connected else "○ Disconnected"
        return pystray.Menu(
            pystray.MenuItem(status, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open GamezNET", on_open, default=True),
            pystray.MenuItem("Disconnect", on_disconnect),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", on_exit),
        )

    img = make_tray_icon(_connected)
    if not img:
        flask_thread.join()
        return

    tray = pystray.Icon(
        "GamezNET",
        img,
        "GamezNET",
        menu=build_menu()
    )
    icon_holder["icon"] = tray

    # Poll connection state and update icon
    def state_watcher():
        last = None
        while True:
            time.sleep(2)
            if _connected != last:
                last = _connected
                tray.icon = make_tray_icon(_connected)
                tray.title = "GamezNET — Connected" if _connected else "GamezNET"
                tray.menu = build_menu()
    threading.Thread(target=state_watcher, daemon=True).start()

    tray.run()

if __name__ == "__main__":
    ensure_admin()
    hide_console()

    # Start Flask in background thread
    flask_thread = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False),
        daemon=True
    )
    flask_thread.start()

    # Open browser after Flask is up
    threading.Thread(target=open_browser, daemon=True).start()

    # Run tray icon on main thread (blocks until Exit clicked)
    run_tray(flask_thread)