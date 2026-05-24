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
import re
import logging
import tempfile
from logging.handlers import RotatingFileHandler
from io import BytesIO
from flask import Flask, request, jsonify, render_template, send_from_directory

# ─── Logging ──────────────────────────────────────────────────────────────────

LOG_FILE = os.path.join(os.path.expanduser("~"), "gameznet.log")
_handler = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logging.basicConfig(level=logging.DEBUG, handlers=[_handler])
log = logging.getLogger("gameznet")

# ─── Game Detection ───────────────────────────────────────────────────────────

# Fallback list for non-Steam launchers (Battle.net, Wargaming, EA, Ubisoft, Riot, Epic, Rockstar).
# Steam games are detected automatically via library scan — no need to add them here.
NON_STEAM_PROCESSES = {
    # ── Battle.net / Blizzard ──────────────────────────────────────────────────
    'Wow.exe': 'World of Warcraft',
    'Wow-64.exe': 'World of Warcraft',
    'WowClassic.exe': 'World of Warcraft Classic',
    'WowClassicT.exe': 'World of Warcraft Classic',
    'Overwatch.exe': 'Overwatch 2',
    'Diablo IV.exe': 'Diablo IV',
    'Diablo Immortal.exe': 'Diablo Immortal',
    'Diablo III.exe': 'Diablo III',
    'Hearthstone.exe': 'Hearthstone',
    'SC2_x64.exe': 'StarCraft II',
    'SC2.exe': 'StarCraft II',
    'HeroesOfTheStorm_x64.exe': 'Heroes of the Storm',
    'BlackOps6.exe': 'Call of Duty: Black Ops 6',
    'cod.exe': 'Call of Duty',
    'ModernWarfare3.exe': 'Call of Duty: Modern Warfare III',
    'Warzone.exe': 'Call of Duty: Warzone',

    # ── Wargaming ──────────────────────────────────────────────────────────────
    'WorldOfTanks.exe': 'World of Tanks',
    'WorldOfWarships.exe': 'World of Warships',
    'WorldOfWarplanes.exe': 'World of Warplanes',
    'WorldOfSeaBattleClient.exe': 'World of Sea Battle',

    # ── Riot Games ────────────────────────────────────────────────────────────
    'League of Legends.exe': 'League of Legends',
    'VALORANT-Win64-Shipping.exe': 'VALORANT',
    'TFT.exe': 'Teamfight Tactics',
    'LeagueofLegends.exe': 'League of Legends',
    'LegendofRuneterra.exe': 'Legends of Runeterra',
    'LoR.exe': 'Legends of Runeterra',

    # ── Epic Games ────────────────────────────────────────────────────────────
    'FortniteClient-Win64-Shipping.exe': 'Fortnite',
    'RocketLeague.exe': 'Rocket League',           # also on Steam
    'FallGuys_client_game.exe': 'Fall Guys',
    'Splitgate.exe': 'Splitgate',
    'Diabotical.exe': 'Diabotical',

    # ── EA App / Origin ───────────────────────────────────────────────────────
    'r5apex.exe': 'Apex Legends',
    'r5apex_dx12.exe': 'Apex Legends',
    'TS4_x64.exe': 'The Sims 4',
    'FIFA.exe': 'EA Sports FC',
    'EASFC25.exe': 'EA Sports FC 25',
    'EASFC24.exe': 'EA Sports FC 24',
    'Battlefield2042.exe': 'Battlefield 2042',
    'bf1.exe': 'Battlefield 1',
    'bfv.exe': 'Battlefield V',
    'bf4.exe': 'Battlefield 4',
    'NeedForSpeedHeat.exe': 'Need for Speed Heat',
    'NFS24.exe': 'Need for Speed Unbound',
    'StarWarsBattlefront.exe': 'Star Wars Battlefront II',
    'SwGame.exe': 'Star Wars Jedi: Survivor',
    'MassEffectLegendaryEdition.exe': 'Mass Effect Legendary Edition',
    'DragonAgeLegacy.exe': 'Dragon Age: The Veilguard',
    'Anthem.exe': 'Anthem',

    # ── Ubisoft Connect ───────────────────────────────────────────────────────
    'RainbowSix.exe': 'Rainbow Six Siege',
    'RainbowSix_DX11.exe': 'Rainbow Six Siege',
    'ACValhalla.exe': "Assassin's Creed Valhalla",
    'ACOdyssey.exe': "Assassin's Creed Odyssey",
    'ACOrigins.exe': "Assassin's Creed Origins",
    'ACMirage.exe': "Assassin's Creed Mirage",
    'FarCry6.exe': 'Far Cry 6',
    'FarCry5.exe': 'Far Cry 5',
    'TheDivision2.exe': 'Tom Clancy\'s The Division 2',
    'Division.exe': 'Tom Clancy\'s The Division',
    'Ghost_Recon_Breakpoint.exe': 'Ghost Recon Breakpoint',
    'GRWildlands.exe': 'Ghost Recon Wildlands',
    'WatchDogs2.exe': 'Watch Dogs 2',
    'WatchDogsLegion.exe': 'Watch Dogs: Legion',
    'ForHonor.exe': 'For Honor',
    'Crew2.exe': 'The Crew 2',
    'Crew_Motorfest.exe': 'The Crew Motorfest',
    'HyperScape.exe': 'Hyper Scape',
    'XDefiant.exe': 'XDefiant',

    # ── Rockstar Games Launcher ───────────────────────────────────────────────
    'GTA5.exe': 'Grand Theft Auto V',
    'GTAV.exe': 'Grand Theft Auto V',
    'RDR2.exe': 'Red Dead Redemption 2',
    'MaxPayne3.exe': 'Max Payne 3',
    'LASD.exe': 'L.A. Noire',

    # ── Minecraft (Microsoft/Mojang) ──────────────────────────────────────────
    'Minecraft.exe': 'Minecraft',
    'MinecraftLauncher.exe': 'Minecraft',

    # ── Xbox / Microsoft Store ────────────────────────────────────────────────
    'Halo-Win64-Shipping.exe': 'Halo Infinite',
    'haloinfinite.exe': 'Halo Infinite',
    'HaloInfinite.exe': 'Halo Infinite',
    'FlightSimulator.exe': 'Microsoft Flight Simulator',
    'FlightSimulator2024.exe': 'Microsoft Flight Simulator 2024',
    'Grounded.exe': 'Grounded',
    'Pentiment.exe': 'Pentiment',
    'Psychonauts2-WinGDK-Shipping.exe': 'Psychonauts 2',
}

_NON_STEAM_LOWER = {k.lower(): v for k, v in NON_STEAM_PROCESSES.items()}

# Cache of Steam installdir (lowercase) → game name, built once and refreshed periodically.
_steam_library_cache: dict = {}
_steam_library_cache_time: float = 0.0

def _build_steam_library_cache() -> dict:
    """
    Scan all Steam library folders for appmanifest_*.acf files and return a
    mapping of lowercase installdir name → game name. This lets us detect any
    installed Steam game by checking a process's exe path.
    """
    import glob as _glob

    result: dict = {}
    seen_roots: set = set()
    steam_roots = []

    def _add_root(p: str) -> None:
        norm = os.path.normpath(p)
        if norm not in seen_roots and os.path.isdir(norm):
            seen_roots.add(norm)
            steam_roots.append(norm)

    for default in [r"C:\Program Files (x86)\Steam", r"C:\Program Files\Steam"]:
        _add_root(default)
        vdf = os.path.join(default, "steamapps", "libraryfolders.vdf")
        if os.path.isfile(vdf):
            try:
                with open(vdf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        m = re.search(r'"path"\s+"([^"]+)"', line)
                        if m:
                            _add_root(m.group(1).replace("\\\\", "\\"))
            except Exception:
                pass

    for root in steam_roots:
        apps_dir = os.path.join(root, "steamapps")
        for acf in _glob.glob(os.path.join(apps_dir, "appmanifest_*.acf")):
            try:
                name = installdir = None
                with open(acf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        m = re.search(r'"name"\s+"([^"]+)"', line)
                        if m:
                            name = m.group(1)
                        m2 = re.search(r'"installdir"\s+"([^"]+)"', line)
                        if m2:
                            installdir = m2.group(1)
                        if name and installdir:
                            break
                if name and installdir:
                    result[installdir.lower()] = name
            except Exception:
                pass

    return result

def _get_steam_library_cache() -> dict:
    global _steam_library_cache, _steam_library_cache_time
    if time.time() - _steam_library_cache_time > 300:  # refresh every 5 min
        _steam_library_cache = _build_steam_library_cache()
        _steam_library_cache_time = time.time()
    return _steam_library_cache

def detect_game() -> str | None:
    """
    Detect the currently running game by:
    1. Checking process exe paths against the local Steam library (any installed game).
    2. Falling back to the NON_STEAM_PROCESSES list for Battle.net / Wargaming / etc.
    """
    try:
        import psutil
        steam_lib = _get_steam_library_cache()
        for proc in psutil.process_iter(['name', 'exe']):
            try:
                exe_lower = (proc.info.get('exe') or '').lower().replace('/', '\\')
                proc_name = proc.info.get('name', '') or ''

                # 1. Steam library path: find "steamapps\common\<installdir>\" in exe path
                idx = exe_lower.find('steamapps\\common\\')
                if idx != -1:
                    rest = exe_lower[idx + len('steamapps\\common\\'):]
                    installdir = rest.split('\\')[0]
                    if installdir and installdir in steam_lib:
                        return steam_lib[installdir]

                # 2. Non-Steam launcher fallback (Battle.net, Wargaming, Riot, Epic)
                match = NON_STEAM_PROCESSES.get(proc_name) or _NON_STEAM_LOWER.get(proc_name.lower())
                if match:
                    return match
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        pass
    return None

def detect_game_steam(steam_id):
    """Query /api/steam/game on the backend for the player's current game via Steam API."""
    import urllib.request
    try:
        url = f"{_backend_url()}/api/steam/game?steam_id={urllib.request.quote(steam_id)}"
        req = urllib.request.Request(url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            return data.get("game") or None
    except Exception:
        return None

# ─── Configuration ────────────────────────────────────────────────────────────

WORKER_URL = "https://gameznet.looknet.ca"
VPN_BACKEND_URL = "http://192.168.30.58:3000"  # Direct backend over VPN — bypasses DNS/Traefik
TUNNEL_NAME = "GamezNET"
VERSION = "1.9.46"
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".gameznet_config.json")

def _write_config(data):
    """Atomically write data to CONFIG_FILE via a temp file + rename."""
    dir_ = os.path.dirname(CONFIG_FILE)
    with tempfile.NamedTemporaryFile("w", dir=dir_, delete=False, suffix=".tmp") as tmp:
        json.dump(data, tmp)
        tmp_path = tmp.name
    os.replace(tmp_path, CONFIG_FILE)
SERVER_PUBLIC_KEY = "SLG8saonFoQ+B8x59SBeHCXouLTpVhyEYPqiUZoGqgI="
SERVER_ENDPOINT = "184.66.15.159:51820"
ALLOWED_IPS = "192.168.8.0/24, 192.168.30.0/24"
PORT = 7734
RUSTDESK_VERSION = "1.4.6"  # RustDesk release version — do NOT bump with gameznet version
RUSTDESK_URL = f"https://github.com/rustdesk/rustdesk/releases/download/{RUSTDESK_VERSION}/rustdesk-{RUSTDESK_VERSION}-x86_64.exe"

# ─── Single-Instance Protection ───────────────────────────────────────────────

def ensure_single_instance():
    """
    Use a named Windows mutex to prevent multiple instances.
    If another instance is already running, bring its browser window
    to focus and exit cleanly.
    """
    mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\GamezNET_SingleInstance")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        log.info("Another instance is already running — opening browser and exiting.")
        webbrowser.open(_local_url())
        sys.exit(0)
    return mutex  # Must keep reference alive — GC releasing it would free the mutex

# ─── Utility ──────────────────────────────────────────────────────────────────

def resource_path(relative_path):
    """Works both for dev and PyInstaller."""
    try:
        base = sys._MEIPASS
    except AttributeError:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, relative_path)

def wg_exe():
    # Prefer system install first (contains required wintun.dll)
    system = r"C:\Program Files\WireGuard\wireguard.exe"
    if os.path.exists(system):
        return system
    # Fall back to local install dir only as a last resort
    local = resource_path("wireguard.exe")
    if os.path.exists(local):
        return local
    return None

def wg_cli():
    """
    Returns path to wg.exe — the WireGuard CLI utility used for 'wg show'.
    Separate from wireguard.exe (the GUI/service manager) which does NOT support /show.
    """
    system = r"C:\Program Files\WireGuard\wg.exe"
    if os.path.exists(system):
        return system
    return None

def _local_url():
    """Return gameznet.local URL if it resolves, otherwise fall back to 127.0.0.1."""
    import socket
    try:
        socket.getaddrinfo("gameznet.local", PORT)
        return f"http://gameznet.local:{PORT}"
    except Exception:
        return f"http://127.0.0.1:{PORT}"

def ensure_hosts_entry():
    """Write 127.0.0.1 gameznet.local to the Windows hosts file if missing."""
    hosts_path = r"C:\Windows\System32\drivers\etc\hosts"
    try:
        with open(hosts_path, "r") as f:
            content = f.read()
        if "gameznet.local" in content:
            return
        with open(hosts_path, "a") as f:
            f.write("\n127.0.0.1 gameznet.local\n")
        log.info("Added gameznet.local to hosts file")
    except Exception as e:
        log.warning("Could not update hosts file: %s", e)

# ─── Dynamic Server Config ───────────────────────────────────────────────────

def fetch_server_config():
    """
    Fetches live server config from the Cloudflare Worker.
    Falls back to hardcoded values if the Worker is unreachable.
    """
    import urllib.request
    try:
        req = urllib.request.Request(
            f"{WORKER_URL}/api/server-config",
            headers={"Cache-Control": "no-cache", "Pragma": "no-cache", "User-Agent": "GamezNET"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode()
            log.debug("fetch_server_config raw response: %s", raw)
            data = json.loads(raw)
            return {
                "endpoint":   data.get("endpoint",  SERVER_ENDPOINT),
                "public_key": data.get("publicKey", SERVER_PUBLIC_KEY),
                "allowed_ips": data.get("allowedIPs", ALLOWED_IPS)
            }
    except Exception as e:
        log.warning("fetch_server_config failed, using hardcoded fallback: %s", e)
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
    if _connected and os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                cfg = json.load(f)
            import urllib.request as _ur
            _hb = json.dumps({"name": cfg.get("name", ""), "vpn_ip": cfg.get("vpn_ip", ""), "disconnecting": True}).encode()
            # Always use public WORKER_URL for cleanup heartbeat
            _req = _ur.Request(f"{WORKER_URL}/api/heartbeat", data=_hb, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}, method="POST")
            _ur.urlopen(_req, timeout=4)
            log.debug("Cleanup heartbeat sent to %s", WORKER_URL)
        except Exception as _e:
            log.debug("Cleanup heartbeat failed: %s", _e)
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

# ─── Telemetry Engine ─────────────────────────────────────────────────────────

_telemetry = {
    "ping": "---",
    "received": "0 B",
    "sent": "0 B",
    "handshake": "Never",
    "motd": "",
    "alert": None,
    "session": None
}

def update_telemetry():
    """Background thread to poll ping and wg stats silently."""
    global _telemetry, _connected
    import urllib.request

    motd_timer = 0
    alert_timer = 0
    session_timer = 0
    last_session_id = None
    version_timer = 0

    while True:
        if _connected:
            # 1. Update MOTD every ~30 seconds
            if motd_timer <= 0:
                try:
                    req = urllib.request.Request(f"{_backend_url()}/api/motd", headers={'User-Agent': 'GamezNET'})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode())
                        _telemetry["motd"] = data.get("message", "Connected to GamezNET")
                except Exception:
                    pass
                motd_timer = 15
            motd_timer -= 1

            # 1b. Update Alert every ~10 seconds
            if alert_timer <= 0:
                try:
                    req = urllib.request.Request(f"{_backend_url()}/api/alert", headers={'User-Agent': 'GamezNET'})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode())
                        _telemetry["alert"] = data.get("alert", None)
                except Exception:
                    pass
                alert_timer = 5
            alert_timer -= 1

            # 1c. Poll session every ~30 seconds
            if session_timer <= 0:
                try:
                    req = urllib.request.Request(f"{_backend_url()}/api/session", headers={'User-Agent': 'GamezNET'})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        data = json.loads(resp.read().decode())
                        _telemetry["session"] = data.get("session", None)
                except Exception:
                    pass
                session_timer = 15
            session_timer -= 1

            # 1d. Check Version every ~60 seconds
            if version_timer <= 0:
                check_version()
                version_timer = 30
            version_timer -= 1

        if _connected:
            # 2. Ping Latency (Targeting internal VPN Gateway to prove tunnel works)
            try:
                # Ping gateway (.1 of last subnet in AllowedIPs = server-side LAN)
                matches = re.findall(r"(\d+\.\d+\.\d+)\.", ALLOWED_IPS)
                target = f"{matches[-1]}.1" if matches else SERVER_ENDPOINT.split(":")[0]

                CREATE_NO_WINDOW = 0x08000000
                output = subprocess.check_output(
                    f"ping -n 2 -w 1500 {target}",
                    shell=True,
                    creationflags=CREATE_NO_WINDOW
                ).decode()

                all_pings = [int(m) for m in re.findall(r"time[=<](\d+)ms", output)]
                _telemetry["ping"] = f"{min(all_pings)}ms" if all_pings else "Timed Out"
            except subprocess.CalledProcessError:
                _telemetry["ping"] = "Timed Out"
            except Exception:
                _telemetry["ping"] = "Error"

            # 3. WireGuard Stats (wg show via wg.exe, not wireguard.exe)
            try:
                wg = wg_cli()
                if wg:
                    CREATE_NO_WINDOW = 0x08000000
                    output = subprocess.check_output(
                        [wg, "show", TUNNEL_NAME],
                        text=True,
                        creationflags=CREATE_NO_WINDOW
                    )
                    
                    # Parse Handshake
                    h_match = re.search(r"latest handshake: (.*)", output)
                    if h_match: _telemetry["handshake"] = h_match.group(1).strip()
                    
                    # Parse Transfer
                    t_match = re.search(r"transfer: ([\d\.]+ \w+) received, ([\d\.]+ \w+) sent", output)
                    if t_match:
                        _telemetry["received"] = t_match.group(1)
                        _telemetry["sent"] = t_match.group(2)
            except Exception:
                pass
        else:
            _telemetry["ping"] = "---"
            _telemetry["handshake"] = "Never"
            _telemetry["received"] = "0 B"
            _telemetry["sent"] = "0 B"

        time.sleep(2)

# ─── Flask App ────────────────────────────────────────────────────────────────

app = Flask(__name__,
            template_folder=resource_path("templates"),
            static_folder=resource_path("static"))
app.config['MAX_CONTENT_LENGTH'] = 550 * 1024 * 1024  # 550MB max upload
_lock = threading.Lock()
_connected = False
_invisible = False
icon_holder = {"icon": None}
_player_status = ""
_full_route = False
_update_required = False

def cleanup_stale_tunnel():
    """
    On startup, check if WireGuard tunnel is still running from a previous unclean shutdown.
    If so, uninstall it and flush DNS caches.
    """
    try:
        wg = wg_exe()
        if not wg:
            return

        CREATE_NO_WINDOW = 0x08000000

        # Check if tunnel service exists
        svc = subprocess.run(
            ["sc", "query", f"WireGuardTunnel${TUNNEL_NAME}"],
            capture_output=True, text=True,
            creationflags=CREATE_NO_WINDOW
        )

        if "does not exist" not in svc.stdout.lower() and svc.returncode == 0:
            log.warning("Found stale WireGuard tunnel from previous unclean shutdown — cleaning up")

            # Uninstall the tunnel
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, creationflags=CREATE_NO_WINDOW,
                timeout=10
            )

            # Remove config file
            conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
            if os.path.exists(conf_path):
                os.remove(conf_path)

            # Flush DNS cache
            subprocess.run(
                ["ipconfig", "/flushdns"],
                capture_output=True, creationflags=CREATE_NO_WINDOW,
                timeout=5
            )
            log.info("Stale tunnel cleaned up and DNS cache flushed")
    except Exception as e:
        log.debug("Stale tunnel cleanup failed (non-critical): %s", e)

def _backend_url():
    """Return VPN backend URL when connected (direct IP, no DNS), else external public URL."""
    return VPN_BACKEND_URL if _connected else WORKER_URL

def _version_tuple(v):
    try:
        return tuple(int(x) for x in v.split('.'))
    except Exception:
        return (0,)

def check_version():
    global _update_required
    import urllib.request
    try:
        req = urllib.request.Request(f"{_backend_url()}/api/version", headers={'User-Agent': 'GamezNET'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            min_ver = data.get("min_version", "1.0.0")
            _update_required = _version_tuple(VERSION) < _version_tuple(min_ver)
            if _update_required:
                log.warning("Update required: client=%s min=%s", VERSION, min_ver)
    except Exception as e:
        log.debug("Version check failed: %s", e)

@app.route("/")
def index():
    return render_template("index.html", connected=_connected, worker_url=WORKER_URL)

@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify({
        "connected": _connected,
        "telemetry": _telemetry,
        "update_required": _update_required,
        "version": VERSION,
        "full_route": _full_route,
        "player_status": _player_status
    })

@app.route("/api/connect", methods=["POST"])
def api_connect():
    global _connected
    log.info("Connect requested")
    if not os.path.exists(CONFIG_FILE):
        log.error("No config file found at %s", CONFIG_FILE)
        return jsonify({"error": "No configuration found. Please redeem a token first."}), 400

    try:
        with open(CONFIG_FILE, "r") as f:
            config_data = json.load(f)
        log.info("Config loaded — player=%s vpn_ip=%s", config_data.get("name"), config_data.get("vpn_ip"))

        # Pre-connect heartbeat: tells backend to re-add UDM peer before tunnel installs
        try:
            import urllib.request as _ur
            _hb = json.dumps({"name": config_data.get("name", ""), "vpn_ip": config_data.get("vpn_ip", ""), "version": VERSION}).encode()
            _req = _ur.Request(f"{WORKER_URL}/api/heartbeat", data=_hb, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}, method="POST")
            _ur.urlopen(_req, timeout=5)
            log.info("Pre-connect heartbeat sent to public URL")
        except Exception as _e:
            log.warning("Pre-connect heartbeat failed: %s", _e)

        # Fetch live server config (falls back to hardcoded if Worker unreachable)
        srv = fetch_server_config()
        log.info("Server config — endpoint=%s public_key=%s allowed_ips=%s",
                 srv["endpoint"], srv["public_key"], srv["allowed_ips"])

        # Build the WireGuard config file
        allowed_ips = "0.0.0.0/0, ::/0" if _full_route else srv['allowed_ips']
        dns_line = "DNS = 1.1.1.1, 1.0.0.1\n" if _full_route else ""
        conf_content = f"""[Interface]
PrivateKey = {config_data['private_key']}
Address = {config_data['vpn_ip']}
MTU = 1360
{dns_line}
[Peer]
PublicKey = {srv['public_key']}
Endpoint = {srv['endpoint']}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
"""
        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        with open(conf_path, "w") as f:
            f.write(conf_content)
        log.info("WireGuard config written to %s", conf_path)

        # Install and start tunnel service
        wg = wg_exe()
        if not wg:
            log.error("wireguard.exe not found")
            return jsonify({"error": "WireGuard not found. Please run the installer again from https://gameznet.looknet.ca/install"}), 500
        log.info("Using wireguard.exe at %s", wg)
        CREATE_NO_WINDOW = 0x08000000

        # Clean up any leftover service from a previous failed attempt
        uninstall_pre = subprocess.run(
            [wg, "/uninstalltunnelservice", TUNNEL_NAME],
            capture_output=True, text=True,
            creationflags=CREATE_NO_WINDOW
        )
        log.debug("pre-connect uninstall: stdout=%r stderr=%r returncode=%s",
                  uninstall_pre.stdout, uninstall_pre.stderr, uninstall_pre.returncode)
        time.sleep(1)  # give SCM a moment to clean up

        install_result = subprocess.run(
            [wg, "/installtunnelservice", conf_path],
            capture_output=True, text=True, timeout=10,
            creationflags=CREATE_NO_WINDOW
        )
        log.info("installtunnelservice stdout=%r stderr=%r returncode=%s",
                 install_result.stdout, install_result.stderr, install_result.returncode)
        if install_result.returncode != 0:
            log.error("installtunnelservice FAILED — stdout=%r stderr=%r",
                      install_result.stdout, install_result.stderr)
            return jsonify({"error": f"WireGuard failed to install tunnel service (code {install_result.returncode}). Try running the GamezNET installer again."}), 503

        # Verify the tunnel interface actually came up (wg show returns valid output).
        # We do NOT require a handshake here — that needs the server to respond,
        # which is a server-side concern. The telemetry will show if traffic flows.
        wg_show = wg_cli()
        log.info("wg.exe path: %s", wg_show)
        tunnel_up = False
        for i in range(10):
            time.sleep(1)
            if wg_show:
                result = subprocess.run(
                    [wg_show, "show", TUNNEL_NAME],
                    capture_output=True, text=True,
                    creationflags=CREATE_NO_WINDOW
                )
                log.debug("wg show [%d] stdout=%r stderr=%r", i, result.stdout, result.stderr)
                if f"interface: {TUNNEL_NAME.lower()}" in result.stdout.lower():
                    tunnel_up = True
                    log.info("Tunnel interface confirmed on attempt %d", i + 1)
                    break
            else:
                # wg.exe not found — check Windows service state
                svc = subprocess.run(
                    ["sc", "query", f"WireGuardTunnel${TUNNEL_NAME}"],
                    capture_output=True, text=True,
                    creationflags=CREATE_NO_WINDOW
                )
                log.debug("sc query [%d]: %r", i, svc.stdout)
                if "RUNNING" in svc.stdout:
                    tunnel_up = True
                    log.info("Service RUNNING confirmed on attempt %d (no wg.exe)", i + 1)
                    break

        if not tunnel_up:
            log.warning("Tunnel interface did not appear after 10s — tearing down")
            subprocess.run(
                [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                capture_output=True, creationflags=CREATE_NO_WINDOW
            )
            return jsonify({"error": "WireGuard tunnel failed to start. Try running the installer again."}), 503

        with _lock:
            _connected = True
        log.info("Connected successfully")
        return jsonify({"success": True, "connected": True})
    except Exception as e:
        log.exception("Unhandled error in api_connect")
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

            # Verify the tunnel interface is actually gone (mirrors connect's verification loop).
            # Without this, a slow SCM or silent uninstall failure leaves the adapter IP alive
            # and causes system-wide routing instability until reboot.
            wg_show = wg_cli()
            tunnel_down = False
            for i in range(10):
                time.sleep(1)
                if wg_show:
                    result = subprocess.run(
                        [wg_show, "show", TUNNEL_NAME],
                        capture_output=True, text=True,
                        creationflags=CREATE_NO_WINDOW
                    )
                    log.debug("wg show (disconnect verify) [%d] stdout=%r stderr=%r", i, result.stdout, result.stderr)
                    if f"interface: {TUNNEL_NAME.lower()}" not in result.stdout.lower():
                        tunnel_down = True
                        log.info("Tunnel interface confirmed down on attempt %d", i + 1)
                        break
                else:
                    # wg.exe not found — check Windows service state
                    svc = subprocess.run(
                        ["sc", "query", f"WireGuardTunnel${TUNNEL_NAME}"],
                        capture_output=True, text=True,
                        creationflags=CREATE_NO_WINDOW
                    )
                    if "does not exist" in svc.stdout.lower() or svc.returncode != 0:
                        tunnel_down = True
                        log.info("Service confirmed gone on attempt %d (no wg.exe)", i + 1)
                        break

            if not tunnel_down:
                log.warning("Tunnel interface still present after 10s — forcing second uninstall")
                subprocess.run(
                    [wg, "/uninstalltunnelservice", TUNNEL_NAME],
                    capture_output=True, creationflags=CREATE_NO_WINDOW
                )

        conf_path = os.path.join(os.path.expanduser("~"), f"{TUNNEL_NAME}.conf")
        if os.path.exists(conf_path):
            os.remove(conf_path)

        # Send disconnecting heartbeat before clearing state (use WORKER_URL, not _backend_url)
        try:
            import urllib.request
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                payload = json.dumps({
                    "name": cfg.get("name", ""),
                    "vpn_ip": cfg.get("vpn_ip", ""),
                    "disconnecting": True
                }).encode()
                req = urllib.request.Request(
                    f"{WORKER_URL}/api/heartbeat",
                    data=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
                log.debug("Disconnect heartbeat sent to %s", WORKER_URL)
        except Exception as hb_err:
            log.debug("Disconnect heartbeat failed: %s", hb_err)

        # Flush DNS and routing caches to clear any stale VPN routes
        try:
            CREATE_NO_WINDOW = 0x08000000
            subprocess.run(["ipconfig", "/flushdns"], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=5)
            log.debug("DNS cache flushed")
        except Exception as flush_err:
            log.debug("DNS flush failed: %s", flush_err)

        with _lock:
            _connected = False
        return jsonify({"success": True, "connected": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/launch_game", methods=["POST"])
def api_launch_game():
    """Launch a Steam game directly via executable to bypass the steam:// arguments warning."""
    data = request.json or {}
    appid = data.get("appid")
    ip = data.get("ip")
    port = data.get("port")
    if not appid or not ip or not port:
        return jsonify({"error": "Missing parameters"}), 400

    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_exe = winreg.QueryValueEx(key, "SteamExe")[0]
    except Exception:
        steam_exe = r"C:\Program Files (x86)\Steam\steam.exe"

    args = [steam_exe, "-applaunch", str(appid)]
    
    if str(appid) == "526870":  # Satisfactory
        args.extend(["+open", f"{ip}:{port}"])
    else:
        args.extend(["+connect", f"{ip}:{port}"])

    try:
        # CREATE_NO_WINDOW to prevent a brief command prompt flash
        subprocess.Popen(args, creationflags=0x08000000)
        return jsonify({"success": True})
    except Exception as e:
        log.error("Game launch failed: %s", e)
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
            "client_ip": data.get("vpn_ip", ""),
            "token":     data.get("token", "")
        })
    except Exception as e:
        return jsonify({"provisioned": False, "name": "", "client_ip": ""}), 500

@app.route("/api/mobile-token", methods=["GET"])
def api_mobile_token():
    """Returns the player's token for mobile QR generation."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "Not provisioned"}), 404
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        token = data.get("token")
        if not token:
            # Auto-migrate: look up token from backend using stored private key
            private_key = data.get("private_key")
            if not private_key:
                return jsonify({"error": "Not provisioned"}), 404
            try:
                import urllib.request as _ur
                req_obj = _ur.Request(
                    f"{_backend_url()}/api/token-migrate",
                    data=json.dumps({"private_key": private_key}).encode(),
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}
                )
                with _ur.urlopen(req_obj, timeout=5) as resp:
                    result = json.loads(resp.read().decode())
                token = result.get("token")
                if token:
                    data["token"] = token
                    _write_config(data)
            except Exception as e:
                log.warning("token-migrate failed: %s", e)
                return jsonify({"error": "Could not retrieve token automatically. Re-provision to enable mobile QR."}), 404
        return jsonify({"token": token})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/mobile-status", methods=["GET"])
def api_mobile_status():
    """Returns whether the player has an active mobile session."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "Not provisioned"}), 404
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        private_key = data.get("private_key")
        if not private_key:
            return jsonify({"error": "Not provisioned"}), 404
        import urllib.request as _ur
        req_obj = _ur.Request(
            f"{_backend_url()}/api/mobile/session-status",
            data=json.dumps({"private_key": private_key}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}
        )
        with _ur.urlopen(req_obj, timeout=5) as resp:
            return jsonify(json.loads(resp.read().decode()))
    except Exception as e:
        log.warning("mobile-status failed: %s", e)
        return jsonify({"active": False, "session_at": None})


@app.route("/api/mobile-revoke", methods=["POST"])
def api_mobile_revoke():
    """Revokes the player's active mobile session."""
    if not os.path.exists(CONFIG_FILE):
        return jsonify({"error": "Not provisioned"}), 404
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
        private_key = data.get("private_key")
        if not private_key:
            return jsonify({"error": "Not provisioned"}), 404
        import urllib.request as _ur
        req_obj = _ur.Request(
            f"{_backend_url()}/api/mobile/revoke",
            data=json.dumps({"private_key": private_key}).encode(),
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}
        )
        with _ur.urlopen(req_obj, timeout=5) as resp:
            return jsonify(json.loads(resp.read().decode()))
    except Exception as e:
        log.warning("mobile-revoke failed: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/provision", methods=["POST"])
def api_provision():
    """Saves provisioned credentials after a successful token redemption."""
    data = request.json
    if not data or 'private_key' not in data or 'client_ip' not in data:
        return jsonify({"error": "Invalid payload"}), 400
    try:
        config = {
            "private_key": data["private_key"],
            "vpn_ip":      data["client_ip"],
            "name":        data.get("name", "Player")
        }
        if data.get("steam_id"):
            config["steam_id"] = data["steam_id"]
        if data.get("token"):
            config["token"] = data["token"]
        _write_config(config)
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
        _write_config({
            "private_key": data["private_key"],
            "vpn_ip":      data["vpn_ip"],
            "name":        data.get("name", "Player")
        })
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/rename", methods=["POST"])
def api_rename():
    """Change display name — validated server-side by vpn_ip + old_name."""
    data = request.json or {}
    new_name = (data.get("new_name") or "").strip()
    if not new_name:
        return jsonify({"error": "Name is required"}), 400
    try:
        with open(CONFIG_FILE) as f:
            config = json.load(f)
    except Exception:
        return jsonify({"error": "Not provisioned"}), 400
    old_name = config.get("name", "")
    vpn_ip   = config.get("vpn_ip", "")
    import urllib.request as _ur2
    body = json.dumps({"old_name": old_name, "new_name": new_name, "vpn_ip": vpn_ip}).encode()
    req = _ur2.Request(f"{_backend_url()}/api/rename", data=body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
    try:
        with _ur2.urlopen(req, timeout=5) as r:
            resp = json.loads(r.read().decode())
    except _ur2.HTTPError as e:
        try:
            resp = json.loads(e.read().decode())
        except Exception:
            resp = {"error": f"Backend error {e.code}"}
        return jsonify(resp), e.code
    except Exception as e:
        return jsonify({"error": str(e)}), 502
    if not resp.get("success"):
        return jsonify(resp), 400
    config["name"] = resp["name"]
    _write_config(config)
    return jsonify({"success": True, "name": resp["name"]})

@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Clear provisioned credentials (for re-setup)."""
    if os.path.exists(CONFIG_FILE):
        os.remove(CONFIG_FILE)
    return jsonify({"success": True})

@app.route("/api/logs", methods=["GET"])
def api_logs():
    """Return the last 100 lines of the log file for debugging."""
    try:
        if not os.path.exists(LOG_FILE):
            return jsonify({"log": "No log file yet."})
        with open(LOG_FILE, "r") as f:
            lines = f.readlines()
        return jsonify({"log": "".join(lines[-100:])})
    except Exception as e:
        return jsonify({"log": f"Error reading log: {e}"})

@app.route("/api/report", methods=["POST"])
def api_report():
    """Collect log tail and send an error report to the Worker."""
    import urllib.request
    data = request.json or {}
    error_message = data.get("error_message", "") or "No error message provided"

    # Collect the last 150 lines of the log file
    log_tail = ""
    try:
        if os.path.exists(LOG_FILE):
            with open(LOG_FILE, "r") as f:
                lines = f.readlines()
            log_tail = "".join(lines[-150:])
    except Exception as e:
        log_tail = f"Could not read log: {e}"

    # Read player config for identification
    player_name = "Unknown"
    vpn_ip = ""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r") as f:
                cfg = json.load(f)
            player_name = cfg.get("name", "") or "Unknown"
            vpn_ip = cfg.get("vpn_ip", "")
    except Exception:
        pass

    # POST to Worker
    try:
        payload = json.dumps({
            "player": player_name,
            "vpn_ip": vpn_ip,
            "error_message": error_message,
            "log_tail": log_tail
        }).encode()
        req = urllib.request.Request(
            f"{_backend_url()}/api/report",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
        log.info("Error report sent for player=%s error=%s", player_name, error_message)
        return jsonify({"success": True})
    except Exception as e:
        log.error("Failed to send error report: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/online", methods=["GET"])
def api_online():
    """Proxy to Worker /api/online so the client UI can call it locally."""
    import urllib.request
    try:
        req = urllib.request.Request(f"{_backend_url()}/api/online", headers={'User-Agent': 'GamezNET'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {'Content-Type': 'application/json'}
    except Exception as e:
        log.debug("api_online proxy failed: %s", e)
        return jsonify([])

@app.route("/api/fullroute", methods=["GET", "POST"])
def api_fullroute():
    global _full_route
    data = request.get_json(silent=True) or {}
    if "enabled" in data and _connected:
        return jsonify({"error": "Disconnect first to change routing mode"}), 400
    if "enabled" in data:
        _full_route = bool(data["enabled"])
    return jsonify({"full_route": _full_route})

@app.route("/api/chat", methods=["GET"])
def api_chat():
    """Proxy GET /api/chat?since= to backend."""
    import urllib.request
    since = request.args.get("since", "")
    try:
        url = f"{_backend_url()}/api/chat?since={urllib.request.quote(since)}"
        req = urllib.request.Request(url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.debug("api_chat proxy failed: %s", e)
        return jsonify([])

@app.route("/api/chat/send", methods=["POST"])
def api_chat_send():
    """Proxy POST /api/chat/send to backend."""
    import urllib.request
    try:
        data = request.get_json(silent=True) or {}
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{_backend_url()}/api/chat/send",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.debug("api_chat_send proxy failed: %s", e)
        return jsonify({"error": str(e)}), 500

@app.route("/api/invisible", methods=["GET", "POST"])
def api_invisible():
    global _invisible
    if request.method == "POST":
        data = request.json or {}
        new_val = bool(data.get("invisible", False))
        _invisible = new_val
        log.info("Invisible mode set to: %s", _invisible)
        return jsonify({"invisible": _invisible})
    return jsonify({"invisible": _invisible})

@app.route("/api/status/set", methods=["POST"])
def api_status_set():
    global _player_status
    data = request.json or {}
    new_status = str(data.get("status", ""))
    if len(new_status) > 40:
        return jsonify({"error": "Status too long (max 40 characters)"}), 400
    _player_status = new_status
    log.info("Player status set to: %r", _player_status)
    try:
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        cfg["status"] = new_status
        _write_config(cfg)
    except Exception:
        pass
    return jsonify({"success": True})

@app.route("/minecraft")
def play_minecraft():
    """Serve Eaglercraft, downloading it on-demand first if missing."""
    install_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(install_dir, "templates")
    static_dir = os.path.join(install_dir, "static")
    os.makedirs(static_dir, exist_ok=True)
    mc_file = os.path.join(static_dir, "eaglercraft.html")

    if not os.path.exists(mc_file):
        try:
            import urllib.request
            import shutil
            
            # Try central server first, fallback to raw GitHub repo
            urls = [
                "https://pub-aa3ac1ad195f45e9b7872a5b32d6ebbd.r2.dev/eaglercraft.html",
            ]
            
            for url in urls:
                try:
                    log.info("Downloading Eaglercraft from %s", url)
                    req = urllib.request.Request(url, headers={'User-Agent': 'GamezNET'})
                    with urllib.request.urlopen(req, timeout=60) as resp, open(mc_file, 'wb') as out_file:
                        shutil.copyfileobj(resp, out_file)
                    log.info("Eaglercraft downloaded successfully.")
                    return send_from_directory(static_dir, "eaglercraft.html")
                except Exception as e:
                    log.warning("Failed to download from %s: %s", url, e)
            raise Exception("Could not download eaglercraft.html from R2.")
        except Exception as e:
            log.error("Failed to download Eaglercraft: %s", e)
            if os.path.exists(mc_file): os.remove(mc_file)
            return f"<h2 style='font-family:sans-serif;color:#ff3366;'>Download Failed</h2><p style='font-family:sans-serif;'>Could not fetch Minecraft client from the central server. Ensure eaglercraft.html is placed in the backend data/public folder! Error: {e}</p>", 500

    return send_from_directory(static_dir, "eaglercraft.html")

@app.route("/api/minecraft/prepare", methods=["POST"])
def api_minecraft_prepare():
    """Pre-downloads Eaglercraft so the UI can show a loading state."""
    install_dir = os.path.dirname(os.path.abspath(__file__))
    template_dir = os.path.join(install_dir, "templates")
    static_dir = os.path.join(install_dir, "static")
    os.makedirs(static_dir, exist_ok=True)
    mc_file = os.path.join(static_dir, "eaglercraft.html")

    if os.path.exists(mc_file) or os.path.exists(os.path.join(template_dir, "eaglercraft.html")):
        return jsonify({"success": True, "source": "bundled"})

    try:
        import urllib.request
        import shutil
        urls = [
            "https://pub-aa3ac1ad195f45e9b7872a5b32d6ebbd.r2.dev/eaglercraft.html",
        ]

        for url in urls:
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'GamezNET'})
                with urllib.request.urlopen(req, timeout=60) as resp, open(mc_file, 'wb') as out_file:
                    shutil.copyfileobj(resp, out_file)
                return jsonify({"success": True})
            except Exception as e:
                pass
        raise Exception("Could not download eaglercraft.html from R2.")
    except Exception as e:
        if os.path.exists(mc_file): os.remove(mc_file)
        return jsonify({"error": f"Failed to download client: {e}"}), 500

def _watch_rustdesk_process(name_to_end):
    """Background thread that tracks RustDesk by executable name instead of a volatile PID."""
    def watcher():
        import psutil
        import urllib.request
        import json
        try:
            # Give RustDesk time to fully launch and spawn its child processes
            time.sleep(5)

            # Wait until we see at least 2 rustdesk.exe processes (base + connection window)
            # then watch for the count to drop — when connection window closes, kill the remaining base window
            peak_count = 0
            for _ in range(20):  # wait up to 60s for multi-process state
                procs = [p for p in psutil.process_iter(['name']) if (p.info.get('name') or '').lower() == 'rustdesk.exe']
                peak_count = max(peak_count, len(procs))
                if peak_count >= 2:
                    break
                time.sleep(3)

            log.info(f"[RUSTDESK TRACKER] Peak rustdesk.exe count: {peak_count}. Now watching for session close...")

            # Poll until count drops below peak (connection window closed), then kill all remaining
            while True:
                procs = [p for p in psutil.process_iter(['name']) if (p.info.get('name') or '').lower() == 'rustdesk.exe']
                count = len(procs)
                if count == 0:
                    break  # fully gone
                if peak_count >= 2 and count < peak_count:
                    # Connection window closed — kill the remaining base window(s)
                    log.info(f"[RUSTDESK TRACKER] Count dropped {peak_count}->{count}. Killing remaining rustdesk.exe...")
                    for p in procs:
                        try: p.kill()
                        except Exception: pass
                    break
                if peak_count < 2:
                    # Never saw multi-process state — fall back to waiting for zero
                    time.sleep(3)
                    continue
                time.sleep(3)

            log.info(f"[RUSTDESK TRACKER] RustDesk session ended. Ending session for '{name_to_end}'...")
            _body = json.dumps({"name": name_to_end}).encode()
            _req = urllib.request.Request(f"{_backend_url()}/api/remote/end", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
            urllib.request.urlopen(_req, timeout=5)
            # Also run local cleanup in case the UI didn't (e.g. RustDesk closed without CANCEL)
            _approve_mode_stop.set()
            subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
        except Exception as e:
            log.debug(f"[RUSTDESK TRACKER] Watcher finished or failed: {e}")

    threading.Thread(target=watcher, daemon=True).start()


_host_lock = threading.Lock()
_helper_lock = threading.Lock()

# Tracks in-progress start-host background threads: requester -> {"status": "running"|"done"|"error", ...}
_host_start_status: dict = {}

def _rustdesk_encrypt_password(plaintext: str) -> str:
    """Encrypt a plaintext password the same way RustDesk does for RustDesk.toml storage.
    RustDesk uses XSalsa20-Poly1305 (libsodium secretbox) with:
      key  = machine UUID bytes, zero-padded to 32 bytes
      nonce = 24 zero bytes
    Output format: '00' + base64(ciphertext)
    """
    import nacl.secret
    import base64
    import winreg
    reg = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography")
    uuid_str, _ = winreg.QueryValueEx(reg, "MachineGuid")
    winreg.CloseKey(reg)
    uuid_bytes = uuid_str.encode("utf-8")
    keybuf = (uuid_bytes + b"\x00" * 32)[:32]
    box = nacl.secret.SecretBox(keybuf)
    nonce = b"\x00" * 24
    ct = box.encrypt(plaintext.encode("utf-8"), nonce=nonce)
    return "00" + base64.b64encode(ct[24:]).decode()


# Event set by cleanup/session-end to stop the approve_mode guardian thread
_approve_mode_stop = threading.Event()


def _approve_mode_guardian(config_path: str, enc_password: str) -> None:
    """Watch RustDesk.toml and restore password + approve_mode if RustDesk flushes them."""
    _approve_mode_stop.clear()
    log.info("[RUSTDESK TRACKER] approve_mode guardian started.")
    while not _approve_mode_stop.wait(timeout=1.0):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                content = f.read()
            needs_fix = (
                f"password = '{enc_password}'" not in content or
                "approve_mode = 'password'" not in content
            )
            if needs_fix:
                content = re.sub(r"^password\s*=.*\n?", "", content, flags=re.MULTILINE)
                content = re.sub(r"^approve_mode\s*=.*\n?", "", content, flags=re.MULTILINE)
                inject = f"password = '{enc_password}'\napprove_mode = 'password'\n"
                fs = re.search(r"^\[", content, flags=re.MULTILINE)
                if fs:
                    content = content[:fs.start()] + inject + "\n" + content[fs.start():]
                else:
                    content = content.rstrip("\n") + "\n" + inject
                with open(config_path, "w", encoding="utf-8") as f:
                    f.write(content)
                log.debug("[RUSTDESK TRACKER] guardian restored password + approve_mode in RustDesk.toml")
        except Exception:
            pass
    log.info("[RUSTDESK TRACKER] approve_mode guardian stopped.")


def _download_rustdesk(rustdesk_exe: str) -> None:
    """Download rustdesk.exe with a timeout. Raises on failure."""
    import urllib.request as _ur
    log.info("[RUSTDESK TRACKER] Downloading RustDesk from %s...", RUSTDESK_URL)
    req = _ur.Request(RUSTDESK_URL, headers={"User-Agent": "GamezNET"})
    with _ur.urlopen(req, timeout=30) as r, open(rustdesk_exe, "wb") as f:
        f.write(r.read())
    with open(rustdesk_exe + ".version", "w") as f:
        f.write(RUSTDESK_VERSION)
    log.info("[RUSTDESK TRACKER] RustDesk downloaded.")


def _ensure_rustdesk(rustdesk_exe: str) -> None:
    """Download rustdesk.exe if missing or if cached version stamp doesn't match RUSTDESK_VERSION."""
    stamp = rustdesk_exe + ".version"
    cached_version = ""
    if os.path.exists(stamp):
        try:
            with open(stamp) as f:
                cached_version = f.read().strip()
        except Exception:
            pass
    if not os.path.exists(rustdesk_exe) or cached_version != RUSTDESK_VERSION:
        if os.path.exists(rustdesk_exe):
            log.info("[RUSTDESK TRACKER] Cached rustdesk.exe is version '%s', expected '%s' — re-downloading...", cached_version, RUSTDESK_VERSION)
            try:
                os.remove(rustdesk_exe)
            except Exception:
                pass
        _download_rustdesk(rustdesk_exe)


def _wait_for_rustdesk_daemon(max_wait: float = 10.0) -> bool:
    """Poll psutil until rustdesk.exe appears or timeout expires. Returns True if found."""
    import psutil
    deadline = time.monotonic() + max_wait
    while time.monotonic() < deadline:
        for proc in psutil.process_iter(['name']):
            if (proc.info.get('name') or '').lower() == 'rustdesk.exe':
                return True
        time.sleep(0.3)
    return False


def _do_start_host(requester: str, password: str) -> None:
    """Background worker for start-host. Updates _host_start_status[requester] when done."""
    import urllib.request as _ur2
    import psutil
    try:
        install_dir = os.path.dirname(os.path.abspath(__file__))
        rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
        id_log_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "log", "get-id", "rustdesk_rCURRENT.log")

        _ensure_rustdesk(rustdesk_exe)

        subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
        # Wait for the process to fully die before writing config (event-driven, not fixed sleep)
        kill_deadline = time.monotonic() + 3.0
        while time.monotonic() < kill_deadline:
            if not any((p.info.get('name') or '').lower() == 'rustdesk.exe' for p in psutil.process_iter(['name'])):
                break
            time.sleep(0.2)

        config_dir = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config")
        os.makedirs(config_dir, exist_ok=True)
        config2_path = os.path.join(config_dir, "RustDesk2.toml")
        config_path = os.path.join(config_dir, "RustDesk.toml")

        # Encrypt password before launch so we can write full config pre-launch.
        log.info("[RUSTDESK TRACKER] Encrypting password and writing config before launch...")
        enc_password = _rustdesk_encrypt_password(password)

        # Write RustDesk2.toml (server config) before launch.
        toml2 = "rendezvous_server = '192.168.30.58:21116'\nnat_type = 1\nserial = 0\n\n[options]\ncustom-rendezvous-server = '192.168.30.58'\nrelay-server = '192.168.30.58'\napi-server = ''\nkey = 'SxmcYEwpZmrBiOTTkmuyZnaGAfh3nyMJ69FU+mjZtQ0='\n"
        with open(config2_path, "w", encoding="utf-8") as f:
            f.write(toml2)

        # Patch RustDesk.toml with password + approve_mode before launch so RustDesk reads them at startup.
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                toml_content = f.read()
        except OSError:
            toml_content = ""
        toml_content = re.sub(r"^password\s*=.*\n?", "", toml_content, flags=re.MULTILINE)
        toml_content = re.sub(r"^approve_mode\s*=.*\n?", "", toml_content, flags=re.MULTILINE)
        # Insert at top-level (before any [section]) so TOML parses them as global fields
        first_section = re.search(r"^\[", toml_content, flags=re.MULTILINE)
        inject = f"password = '{enc_password}'\napprove_mode = 'password'\n"
        if first_section:
            toml_content = toml_content[:first_section.start()] + inject + "\n" + toml_content[first_section.start():]
        else:
            toml_content = toml_content.rstrip("\n") + "\n" + inject
        with open(config_path, "w", encoding="utf-8") as f:
            f.write(toml_content)
        log.info("[RUSTDESK TRACKER] Password and approve_mode written to RustDesk.toml before launch.")

        # Launch RustDesk — it reads both TOMLs fresh with our settings already in place.
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 6  # SW_MINIMIZE
        log.info("[RUSTDESK TRACKER] Launching rustdesk.exe minimized...")
        subprocess.Popen([rustdesk_exe], startupinfo=si)

        if not _wait_for_rustdesk_daemon(max_wait=10.0):
            raise RuntimeError("RustDesk daemon did not appear within 10s")

        # Aggressively hold RustDesk2.toml to our server config for 5s after launch.
        # RustDesk writes its default (public) server on startup — we restore instantly
        # so it never registers with the public hbbs.
        toml2_hold_deadline = time.monotonic() + 5.0
        while time.monotonic() < toml2_hold_deadline:
            time.sleep(0.05)
            try:
                current2 = open(config2_path, "r", encoding="utf-8").read()
                if "192.168.30.58" not in current2:
                    with open(config2_path, "w", encoding="utf-8") as f:
                        f.write(toml2)
                    log.debug("[RUSTDESK TRACKER] RustDesk2.toml restored to self-hosted server.")
            except OSError:
                pass
        log.info("[RUSTDESK TRACKER] RustDesk2.toml hold complete.")

        os.makedirs(os.path.dirname(id_log_path), exist_ok=True)
        if os.path.exists(id_log_path):
            try:
                os.remove(id_log_path)
            except Exception:
                pass

        # Retry --get-id until IPC responds (replaces fixed sleep after --password)
        rustdesk_id = None
        for attempt in range(20):
            get_id_result = subprocess.run(
                [rustdesk_exe, "--get-id"], capture_output=True, text=True,
                errors="ignore", timeout=15, creationflags=0x08000000
            )
            for line in reversed((get_id_result.stdout + get_id_result.stderr).splitlines()):
                if re.match(r'^\d{6,12}$', line.strip()):
                    rustdesk_id = line.strip()
                    break
            if rustdesk_id:
                break
            log.info("[RUSTDESK TRACKER] --get-id attempt %d returned no ID, retrying...", attempt + 1)
            time.sleep(0.5)

        # Fallback: poll log files
        if not rustdesk_id:
            log.info("[RUSTDESK TRACKER] --get-id exhausted, polling log files...")
            id_log_dir = os.path.dirname(id_log_path)
            for _ in range(20):
                time.sleep(0.5)
                if not os.path.exists(id_log_dir):
                    continue
                log_files = sorted(
                    [os.path.join(id_log_dir, f) for f in os.listdir(id_log_dir) if f.endswith(".log")],
                    key=os.path.getmtime, reverse=True
                )
                for lf in log_files:
                    try:
                        with open(lf, "r", errors="ignore") as f:
                            for line in reversed(f.readlines()):
                                m = re.search(r"Generated id (\d+)", line)
                                if m:
                                    rustdesk_id = m.group(1)
                                    break
                    except Exception:
                        pass
                    if rustdesk_id:
                        break
                if rustdesk_id:
                    break

        if not rustdesk_id:
            raise RuntimeError("Could not read RustDesk ID after all retries")

        # Ensure password + approve_mode are in the file right now before posting ready.
        # RustDesk's startup write may have wiped them; restore and verify before Nikki connects.
        for attempt in range(10):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    current = f.read()
                if f"password = '{enc_password}'" in current and "approve_mode = 'password'" in current:
                    log.info("[RUSTDESK TRACKER] Config verified: password + approve_mode present.")
                    break
                current = re.sub(r"^password\s*=.*\n?", "", current, flags=re.MULTILINE)
                current = re.sub(r"^approve_mode\s*=.*\n?", "", current, flags=re.MULTILINE)
                inject = f"password = '{enc_password}'\napprove_mode = 'password'\n"
                fs = re.search(r"^\[", current, flags=re.MULTILINE)
                if fs:
                    current = current[:fs.start()] + inject + "\n" + current[fs.start():]
                else:
                    current = current.rstrip("\n") + "\n" + inject
                with open(config_path, "w", encoding="utf-8") as f:
                    f.write(current)
                log.info("[RUSTDESK TRACKER] Config restored (attempt %d), re-verifying...", attempt + 1)
                time.sleep(0.3)
            except Exception as e:
                log.warning("[RUSTDESK TRACKER] Config verify/restore failed: %s", e)
                time.sleep(0.3)

        # Brief wait for RustDesk to re-register with hbbs after the --option server switch.
        time.sleep(2)

        log.info(f"[RUSTDESK TRACKER] RustDesk ID acquired: {rustdesk_id}. Posting /api/remote/ready...")
        _body = json.dumps({"requester": requester, "rustdesk_id": rustdesk_id, "password": password}).encode()
        _req = _ur2.Request(f"{_backend_url()}/api/remote/ready", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
        with _ur2.urlopen(_req, timeout=5) as resp:
            log.info(f"[RUSTDESK TRACKER] /api/remote/ready post success: {resp.status}")

        threading.Thread(target=_approve_mode_guardian, args=(config_path, enc_password), daemon=True).start()

        _host_start_status[requester] = {"status": "done", "rustdesk_id": rustdesk_id}
        _watch_rustdesk_process(requester)
        log.info("[RUSTDESK TRACKER] Host start complete.")

    except Exception as e:
        log.error("[RUSTDESK TRACKER] _do_start_host failed: %s", repr(e), exc_info=True)
        _host_start_status[requester] = {"status": "error", "error": str(e)}
    finally:
        _host_lock.release()


@app.route("/api/remote/start-host", methods=["POST"])
def api_remote_start_host():
    """
    Kick off host setup in a background thread and return immediately.
    The frontend polls /api/remote/status for the 'ready' state transition.
    """
    data = request.json or {}
    password = data.get("password", "")
    requester = data.get("requester", "")

    log.info(f"[RUSTDESK TRACKER] Local start-host triggered by: {requester}")

    if not password or not requester:
        return jsonify({"error": "Missing password or requester"}), 400

    if not _host_lock.acquire(blocking=False):
        log.info("[RUSTDESK TRACKER] Ignoring duplicate start-host request (already running)")
        return jsonify({"success": True, "queued": True}), 200

    _host_start_status[requester] = {"status": "running"}
    threading.Thread(target=_do_start_host, args=(requester, password), daemon=True).start()
    return jsonify({"success": True, "queued": True})


@app.route("/api/steam/link", methods=["POST"])
def api_steam_link():
    """Open Steam OpenID login in the default browser to link the player's Steam account."""
    data = request.json or {}
    name = data.get("name", "")
    if not name:
        return jsonify({"error": "Missing name"}), 400
    import webbrowser
    webbrowser.open(f"{WORKER_URL}/auth/steam?token={name}")
    return jsonify({"success": True})


def _notify_connected(helper):
    """Tell the backend the helper has launched RustDesk so the host modal can advance."""
    if not helper:
        return
    log.info(f"[RUSTDESK TRACKER] Notifying server that helper '{helper}' connected...")
    try:
        import urllib.request as _ur3
        _body = json.dumps({"helper": helper}).encode()
        _req = _ur3.Request(f"{_backend_url()}/api/remote/connected", data=_body, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"})
        with _ur3.urlopen(_req, timeout=5) as resp:
            log.info(f"[RUSTDESK TRACKER] /api/remote/connected post success: {resp.status}")
    except Exception as _e:
        log.warning("[RUSTDESK TRACKER] remote/connected notify failed: %s", repr(_e))


@app.route("/api/remote/start-helper", methods=["POST"])
def api_remote_start_helper():
    """
    Download RustDesk (if needed) and attempt to connect to the requester.
    """
    if not _helper_lock.acquire(blocking=False):
        log.info("[RUSTDESK TRACKER] Ignoring duplicate start-helper request")
        return jsonify({"success": True, "ignored": True}), 200

    try:
        data = request.json or {}
        target_id = data.get("rustdesk_id", "")
        password = data.get("password", "")
        helper = data.get("helper", "")

        log.info(f"[RUSTDESK TRACKER] Local start-helper triggered. Helper: {helper}, Target ID: {target_id}")

        if not target_id or not password:
            log.warning("[RUSTDESK TRACKER] Local start-helper missing rustdesk_id or password")
            return jsonify({"error": "Missing rustdesk_id or password"}), 400

        install_dir = os.path.dirname(os.path.abspath(__file__))
        rustdesk_exe = os.path.join(install_dir, "rustdesk.exe")
        _ensure_rustdesk(rustdesk_exe)

        log.info(f"[RUSTDESK TRACKER] Attempting CLI connect to {target_id}")
        
        # Failsafe: Copy password to clipboard
        try:
            subprocess.run(['clip'], input=password, text=True, creationflags=0x08000000)
            log.info("[RUSTDESK TRACKER] Session password copied to Windows clipboard.")
        except Exception:
            pass

        subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
        # Wait for process to fully die before writing config (event-driven, not fixed sleep)
        import psutil as _psutil
        kill_deadline = time.monotonic() + 3.0
        while time.monotonic() < kill_deadline:
            if not any((p.info.get('name') or '').lower() == 'rustdesk.exe' for p in _psutil.process_iter(['name'])):
                break
            time.sleep(0.2)

        config_dir = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config")
        os.makedirs(config_dir, exist_ok=True)
        config2_path = os.path.join(config_dir, "RustDesk2.toml")

        # Launch bare daemon so RustDesk performs its startup TOML rewrite first.
        # We must wait until RustDesk finishes writing before we overwrite.
        log.info("[RUSTDESK TRACKER] Launching bare daemon to trigger startup TOML write...")
        si_h = subprocess.STARTUPINFO()
        si_h.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si_h.wShowWindow = 6
        subprocess.Popen([rustdesk_exe], startupinfo=si_h)

        # Poll until RustDesk2.toml has content (i.e. RustDesk finished its startup write)
        import psutil as _psutil
        toml2_deadline = time.monotonic() + 10.0
        last_size = -1
        stable_count = 0
        while time.monotonic() < toml2_deadline:
            time.sleep(0.3)
            try:
                size = os.path.getsize(config2_path)
                if size > 0 and size == last_size:
                    stable_count += 1
                    if stable_count >= 2:  # stable for 0.6s — write is done
                        break
                else:
                    stable_count = 0
                last_size = size
            except OSError:
                pass
        log.info("[RUSTDESK TRACKER] RustDesk startup write done. Overwriting with self-hosted relay...")

        # Now overwrite with our server settings
        toml2 = "rendezvous_server = '192.168.30.58:21116'\nnat_type = 1\nserial = 0\n\n[options]\ncustom-rendezvous-server = '192.168.30.58'\nrelay-server = '192.168.30.58'\napi-server = ''\nkey = 'SxmcYEwpZmrBiOTTkmuyZnaGAfh3nyMJ69FU+mjZtQ0='\n"
        with open(config2_path, "w", encoding="utf-8") as f:
            f.write(toml2)
        log.info("[RUSTDESK TRACKER] RustDesk2.toml overwritten:\n%s", toml2)

        # Inject via --option IPC so settings are also applied to the running daemon
        log.info("[RUSTDESK TRACKER] Injecting server options via --option IPC...")
        for opt_key, opt_val in [
            ("custom-rendezvous-server", "192.168.30.58"),
            ("relay-server", "192.168.30.58"),
            ("api-server", ""),
            ("key", "SxmcYEwpZmrBiOTTkmuyZnaGAfh3nyMJ69FU+mjZtQ0="),
        ]:
            subprocess.run([rustdesk_exe, "--option", opt_key, opt_val], capture_output=True, creationflags=0x08000000)

        # Wipe stale peer config so RustDesk doesn't auto-try an old invalid password
        peer_path = os.path.join(config_dir, "peers", f"{target_id}.toml")
        if os.path.exists(peer_path):
            try:
                os.remove(peer_path)
            except Exception:
                pass

        # Call --connect on the already-running daemon (do NOT kill and relaunch —
        # relaunching triggers another startup TOML overwrite that reverts our server config)
        log.info("[RUSTDESK TRACKER] Sending --connect to running daemon...")
        subprocess.Popen([rustdesk_exe, "--connect", target_id, "--password", password])

        log.info("[RUSTDESK TRACKER] CLI Connect successfully initiated connection window.")
        _notify_connected(helper)
        
        _watch_rustdesk_process(helper)
        return jsonify({"success": True, "mode": "connected"})

    except Exception as e:
        log.error("[RUSTDESK TRACKER] remote start-helper failed: %s", repr(e), exc_info=True)
        return jsonify({"error": str(e)}), 500
    finally:
        _helper_lock.release()


@app.route("/api/remote/cleanup", methods=["POST"])
def api_remote_cleanup():
    """Kill RustDesk and clear the session password from config."""
    log.info("[RUSTDESK TRACKER] Local cleanup triggered. Killing processes...")
    _approve_mode_stop.set()  # Stop the approve_mode guardian if running
    config_path = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "RustDesk", "config", "RustDesk.toml")
    killed = []
    try:
        import psutil
        for proc in psutil.process_iter(['name', 'pid']):
            if (proc.info.get('name') or '').lower() == 'rustdesk.exe':
                proc.kill()
                killed.append(proc.info.get('pid'))
    except Exception as e:
        log.warning("[RUSTDESK TRACKER] psutil kill error: %s", e)
    log.info("[RUSTDESK TRACKER] psutil killed PIDs: %s", killed)
    # Fallback: taskkill catches any processes psutil missed
    result = subprocess.run(["taskkill", "/F", "/IM", "rustdesk.exe"], capture_output=True, creationflags=0x08000000)
    log.info("[RUSTDESK TRACKER] taskkill exit=%d stdout=%s stderr=%s", result.returncode, result.stdout.decode(errors='replace').strip(), result.stderr.decode(errors='replace').strip())
    # Clear password from config
    try:
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                toml = f.read()
            toml = re.sub(r"^password\s*=.*$", "password = ''", toml, flags=re.MULTILINE)
            with open(config_path, "w") as f:
                f.write(toml)
    except Exception:
        pass
    log.info("[RUSTDESK TRACKER] RustDesk session cleaned up.")
    return jsonify({"success": True})


@app.route("/api/remote/stop-beep", methods=["POST"])
def api_remote_stop_beep():
    _stop_beep_alert()
    return jsonify({"ok": True})


@app.route("/api/remote/<path:endpoint>", methods=["GET", "POST"])
def proxy_remote_api(endpoint):
    """
    Proxy missing remote endpoints (status, pending, request, end) to the central server.
    Specific routes like start-host and start-helper are matched first by Flask.
    """
    import urllib.request
    import urllib.error
    url = f"{_backend_url()}/api/remote/{endpoint}"
    
    # Forward query parameters (e.g., ?name=User)
    if request.query_string:
        url += "?" + request.query_string.decode('utf-8')
        
    log.info(f"[RUSTDESK TRACKER] Proxying request to: {url} [{request.method}]")
        
    try:
        req = urllib.request.Request(url, method=request.method)
        req.add_header("User-Agent", "GamezNET-Proxy")
        
        if request.method == "POST":
            req.add_header("Content-Type", "application/json")
            if request.data:
                req.data = request.data
                log.info(f"[RUSTDESK TRACKER] Outgoing payload: {request.get_data(as_text=True)}")
                
        with urllib.request.urlopen(req, timeout=5) as response:
            content_type = response.headers.get('Content-Type', 'application/json')
            body = response.read()
            # Log a small snippet of the response body to avoid spamming the log if it's huge
            log.info(f"[RUSTDESK TRACKER] Response from server ({response.status}): {body.decode()[:150]}")
            return body, response.status, {'Content-Type': content_type}
            
    except urllib.error.HTTPError as e:
        content_type = e.headers.get('Content-Type', 'application/json')
        body = e.read()
        log.warning(f"[RUSTDESK TRACKER] Server returned HTTP Error ({e.code}): {body.decode()[:150]}")
        return body, e.code, {'Content-Type': content_type}
    except Exception as e:
        log.error("[RUSTDESK TRACKER] Proxy error to %s: %s", url, repr(e))
        return jsonify({"error": str(e)}), 500

INSTALLER_URL = "https://github.com/natelook1/gameznet-public/releases/latest/download/GamezNET-Setup.exe"

@app.route("/api/update", methods=["POST"])
def api_update():
    """Update GamezNET. Exe builds download the installer directly; bat/dev builds
    pull the latest source zip first so the new bat can bootstrap the installer."""
    import urllib.request
    import ssl
    import tempfile

    # Prefer Windows cert store; fall back to certifi; last resort skip verify
    try:
        ctx = ssl.create_default_context()
        ctx.load_default_certs()
    except Exception:
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except Exception:
            ctx = ssl._create_unverified_context()

    # ── Path A: running as compiled exe ───────────────────────────────────────
    if getattr(sys, "frozen", False):
        try:
            tmp = os.path.join(tempfile.gettempdir(), "GamezNET-Setup.exe")
            log.info("Downloading installer from %s", INSTALLER_URL)
            req = urllib.request.Request(INSTALLER_URL, headers={"User-Agent": "GamezNET"})
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                with open(tmp, "wb") as f:
                    f.write(resp.read())
        except Exception as e:
            log.error("Installer download failed: %r", e, exc_info=True)
            return jsonify({"error": f"Failed to download installer: {repr(e)}"}), 500

        exe_path = os.path.join(os.environ.get("LOCALAPPDATA", ""), "GamezNET", "GamezNET.exe")

        def _install_and_relaunch():
            time.sleep(0.8)
            try:
                ctypes.windll.kernel32.ReleaseMutex(_instance_mutex)
                ctypes.windll.kernel32.CloseHandle(_instance_mutex)
            except Exception:
                pass
            log.info("Running installer — Inno Setup CurStepChanged will taskkill us to release file locks")
            # Block on the installer. Inno Setup's CurStepChanged runs:
            #   taskkill /F /IM GamezNET.exe
            # which kills this process mid-wait, releasing all DLL locks.
            # The installer continues as an independent process, installs files,
            # then its [Run] section (no postinstall flag) launches the new exe.
            subprocess.run([tmp, "/VERYSILENT", "/NORESTART"],
                           creationflags=subprocess.CREATE_NO_WINDOW)
            os._exit(0)

        threading.Thread(target=_install_and_relaunch, daemon=True).start()
        return jsonify({"success": True})

    # ── Path B: running as python/bat — pull source zip then relaunch via bat ─
    install_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        import zipfile
        import io
        zip_url = "https://github.com/natelook1/gameznet-public/archive/refs/heads/main.zip"
        log.info("Downloading source update from %s", zip_url)
        req = urllib.request.Request(zip_url, headers={"User-Agent": "GamezNET"})
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            with zipfile.ZipFile(io.BytesIO(resp.read())) as z:
                for member in z.namelist():
                    if not member.startswith("gameznet-public-main/"):
                        continue
                    relative_path = member.replace("gameznet-public-main/", "", 1)
                    if not relative_path:
                        continue
                    if relative_path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico')):
                        continue
                    target_path = os.path.join(install_dir, relative_path)
                    if member.endswith('/'):
                        os.makedirs(target_path, exist_ok=True)
                        continue
                    os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    with open(target_path, "wb") as f:
                        f.write(z.read(member))
        log.info("Source update extracted. Relaunching via Python.")
    except Exception as e:
        log.error("Source update failed: %r", e, exc_info=True)
        return jsonify({"error": f"Failed to download update: {repr(e)}"}), 500

    def _relaunch():
        time.sleep(0.8)
        try:
            ctypes.windll.kernel32.ReleaseMutex(_instance_mutex)
            ctypes.windll.kernel32.CloseHandle(_instance_mutex)
        except Exception:
            pass
        args = [sys.executable] + sys.argv
        if "--no-browser" not in args:
            args.append("--no-browser")
        subprocess.Popen(args, cwd=install_dir,
                         creationflags=subprocess.CREATE_NO_WINDOW)
        os._exit(0)
    threading.Thread(target=_relaunch, daemon=True).start()
    return jsonify({"success": True})


@app.route("/api/satisfactory/save-version", methods=["GET"])
def api_satisfactory_save_version():
    import urllib.request as _ur
    try:
        req = _ur.Request(f"{_backend_url()}/api/satisfactory/save-version", headers={"User-Agent": "GamezNET"})
        with _ur.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        return jsonify({"version": 0}), 200

@app.route("/api/satisfactory/players", methods=["GET"])
def api_satisfactory_players():
    """Proxy with extended timeout — SF API can take up to 15s to respond."""
    import urllib.request as _ur
    try:
        req = _ur.Request(f"{_backend_url()}/api/satisfactory/players", headers={"User-Agent": "GamezNET"})
        with _ur.urlopen(req, timeout=20) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.error("satisfactory players proxy failed: %s", e)
        return jsonify({"error": str(e)}), 502

@app.route("/api/satisfactory/map-data", methods=["GET"])
def api_satisfactory_map_data():
    """Proxy to backend — uses extended timeout since .sav parsing can take several seconds."""
    import urllib.request as _ur
    try:
        req = _ur.Request(f"{_backend_url()}/api/satisfactory/map-data", headers={"User-Agent": "GamezNET"})
        with _ur.urlopen(req, timeout=120) as resp:
            return resp.read(), resp.status, {"Content-Type": "application/json"}
    except Exception as e:
        log.error("satisfactory map-data proxy failed: %s", e)
        return jsonify({"error": str(e)}), 502

@app.route("/api/satisfactory/map-background")
def api_satisfactory_map_background():
    """Proxy the wiki map image to avoid CORS issues in the browser."""
    import urllib.request as _ur
    try:
        req = _ur.Request(
            "https://satisfactory.wiki.gg/images/Map.jpg",
            headers={"User-Agent": "Mozilla/5.0 GamezNET"}
        )
        with _ur.urlopen(req, timeout=15) as resp:
            data = resp.read()
            return data, 200, {"Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400"}
    except Exception as e:
        log.error("satisfactory map background proxy failed: %s", e)
        return "", 502

@app.route("/conan-exiles")
def conan_exiles():
    return send_from_directory("static", "conan-exiles.html")

@app.route("/static/map-tiles/<path:tile_path>")
def map_tiles_proxy(tile_path):
    import urllib.request as _ur
    try:
        url = f"{_backend_url()}/static/map-tiles/{tile_path}"
        req = _ur.Request(url, headers={"User-Agent": "GamezNET"})
        with _ur.urlopen(req, timeout=10) as resp:
            return resp.read(), resp.status, {"Content-Type": "image/png"}
    except Exception:
        return "", 404

@app.route("/api/alert", methods=["GET"])
def api_alert():
    """Proxy GET to Worker /api/alert and return the JSON."""
    import urllib.request as _urllib_request
    try:
        req = _urllib_request.Request(f"{_backend_url()}/api/alert", headers={'User-Agent': 'GamezNET'})
        with _urllib_request.urlopen(req, timeout=5) as resp:
            return resp.read(), resp.status, {'Content-Type': 'application/json'}
    except Exception as e:
        log.debug("api_alert proxy failed: %s", e)
        return jsonify({"alert": None})


_beep_alert_stop = threading.Event()
_beep_alert_thread = None

def _beep_alert_loop():
    import winsound
    while not _beep_alert_stop.is_set():
        winsound.Beep(880, 200)
        winsound.Beep(660, 200)
        _beep_alert_stop.wait(timeout=2.6)

def _start_beep_alert():
    global _beep_alert_thread
    _beep_alert_stop.clear()
    if _beep_alert_thread and _beep_alert_thread.is_alive():
        return
    _beep_alert_thread = threading.Thread(target=_beep_alert_loop, daemon=True)
    _beep_alert_thread.start()

def _stop_beep_alert():
    _beep_alert_stop.set()

@app.route("/api/remote/stream")
def api_remote_stream():
    """SSE proxy for real-time remote assistance events. Triggers winsound beep on pending requests."""
    import urllib.request as _ur
    from flask import Response, stream_with_context
    name = request.args.get("name", "")
    url = f"{_backend_url()}/api/remote/stream?name={_ur.quote(name)}"
    def _generate():
        buf = b""
        try:
            req = _ur.Request(url, headers={"User-Agent": "GamezNET", "Accept": "text/event-stream"})
            with _ur.urlopen(req, timeout=None) as resp:
                while True:
                    chunk = resp.read(1024)
                    if not chunk:
                        break
                    buf += chunk
                    # Parse SSE events to trigger local beep without browser autoplay restrictions
                    while b"\n\n" in buf:
                        msg_bytes, buf = buf.split(b"\n\n", 1)
                        if msg_bytes.startswith(b"data:"):
                            try:
                                ev = json.loads(msg_bytes[5:].strip())
                                if ev.get("status") == "pending":
                                    _start_beep_alert()
                                elif ev.get("status") in ("none", "accepted", "connected"):
                                    _stop_beep_alert()
                            except Exception:
                                pass
                    yield chunk
        except Exception as e:
            _stop_beep_alert()
            yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()
    return Response(stream_with_context(_generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/chat/stream")
def api_chat_stream():
    """SSE proxy for real-time chat — keeps connection alive through the VPN path."""
    import urllib.request as _ur
    from flask import Response, stream_with_context
    name = request.args.get("name", "")
    url = f"{_backend_url()}/api/chat/stream?name={_ur.quote(name)}"
    def _generate():
        buf = b""
        try:
            req = _ur.Request(url, headers={"User-Agent": "GamezNET", "Accept": "text/event-stream"})
            with _ur.urlopen(req, timeout=None) as resp:
                while True:
                    chunk = resp.read(1024)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\n\n" in buf:
                        msg_bytes, buf = buf.split(b"\n\n", 1)
                        if msg_bytes.startswith(b"data:"):
                            try:
                                msg = json.loads(msg_bytes[5:].strip())
                                if msg.get("type") == "server_state":
                                    _name = msg.get("name", "Server")
                                    _state = msg.get("state", "")
                                    if _state in ("running", "stopping"):
                                        _label = "is now online" if _state == "running" else "is stopping"
                                        _icon = icon_holder.get("icon")
                                        if _icon:
                                            try: _icon.notify(f"{_name} {_label}", "GamezNET")
                                            except Exception: pass
                            except Exception:
                                pass
                        yield msg_bytes + b"\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()
    return Response(stream_with_context(_generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.route("/api/<path:subpath>", methods=["GET", "POST"])
def api_proxy(subpath):
    """Catch-all proxy for unhandled /api/* routes — forwards to backend."""
    import urllib.request as _ur
    import urllib.error as _ue
    try:
        qs = request.query_string.decode()
        url = f"{_backend_url()}/api/{subpath}" + (f"?{qs}" if qs else "")
        body = request.get_data() or None
        ct = request.content_type or "application/json"
        # Forward auth headers so token-gated routes (WoW, mobile, etc.) work
        fwd_headers = {"User-Agent": "GamezNET", "Content-Type": ct}
        for h in ("X-Token", "X-Session", "X-Filename", "X-Description", "X-Admin-Password", "X-Allowed-Users", "X-Blueprint-Folder"):
            val = request.headers.get(h) or request.headers.get(h.lower())
            if val:
                fwd_headers[h] = val

        # Debug: log file upload headers
        if 'files/upload' in url:
            log.debug(f"[API Proxy] File upload to {url} - Received headers: {dict(request.headers)}")
            log.debug(f"[API Proxy] File upload - Forwarding headers: {fwd_headers}")
        req = _ur.Request(url, data=body, headers=fwd_headers, method=request.method)
        with _ur.urlopen(req, timeout=10) as resp:
            return resp.read(), resp.status, {"Content-Type": resp.headers.get("Content-Type", "application/json")}
    except _ue.HTTPError as e:
        body = e.read()
        log.error("api proxy HTTP %s for %s: %s", e.code, subpath, body)
        return body, e.code, {"Content-Type": e.headers.get("Content-Type", "application/json")}
    except Exception as e:
        log.error("api proxy failed for %s: %s", subpath, e)
        return jsonify({"error": str(e)}), 502

@app.route("/auth/<path:subpath>", methods=["GET", "POST"])
def auth_proxy(subpath):
    """Proxy /auth/* routes to backend (YouTube OAuth)."""
    import urllib.request as _ur
    qs = request.query_string.decode()
    url = f"{WORKER_URL}/auth/{subpath}" + (f"?{qs}" if qs else "")
    from flask import redirect
    return redirect(url)

# ─── Heartbeat Thread ─────────────────────────────────────────────────────────

def heartbeat_loop():
    """Send presence heartbeat to the Worker every 3 seconds while connected."""
    import urllib.request
    _steam_counter = 10  # start at threshold so first heartbeat polls Steam immediately
    _last_steam_game = None
    while True:
        time.sleep(3)
        if _connected and os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                # Local process scan runs every heartbeat — detects any installed Steam game
                # or non-Steam launcher game instantly without any network call.
                game = detect_game()
                # Steam API poll every 30s as a supplement: picks up games running on other
                # devices or games where local process detection isn't available.
                steam_id = cfg.get("steam_id")
                if steam_id:
                    _steam_counter += 1
                    if _steam_counter >= 10:
                        _steam_counter = 0
                        _last_steam_game = detect_game_steam(steam_id)
                    if not game:
                        game = _last_steam_game
                payload = json.dumps({
                    "name": cfg.get("name", ""),
                    "vpn_ip": cfg.get("vpn_ip", ""),
                    "game": game,
                    "hidden": _invisible,
                    "ping": _telemetry.get("ping", None),
                    "version": VERSION,
                    "status": _player_status
                }).encode()
                # Use VPN backend URL for heartbeat while connected (proves tunnel is alive)
                req = urllib.request.Request(
                    f"{VPN_BACKEND_URL}/api/heartbeat",
                    data=payload,
                    headers={"Content-Type": "application/json", "User-Agent": "GamezNET"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception as e:
                log.warning("Heartbeat failed: %s", e)

# ─── Entry Point ──────────────────────────────────────────────────────────────

def open_browser():
    time.sleep(1.2)
    webbrowser.open(_local_url())

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
    """
    Tray icon using the real gameznet.png:
      - Disconnected: desaturated + dimmed
      - Connected:    full colour + small green dot in the bottom-right corner
    """
    try:
        from PIL import Image, ImageDraw, ImageEnhance
    except ImportError:
        return None

    size = 64
    icon_path = resource_path(os.path.join("static", "gameznet.png"))
    try:
        img = Image.open(icon_path).convert("RGBA").resize((size, size), Image.LANCZOS)
    except Exception:
        # Fallback: plain coloured circle so the tray still works
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        color = (0, 180, 220, 255) if connected else (30, 48, 70, 255)
        ImageDraw.Draw(img).ellipse([2, 2, size - 2, size - 2], fill=color)
        return img

    if not connected:
        # Desaturate then dim while preserving the alpha channel
        r, g, b, a = img.split()
        rgb = Image.merge("RGB", (r, g, b))
        rgb = ImageEnhance.Color(rgb).enhance(0.2)
        rgb = ImageEnhance.Brightness(rgb).enhance(0.5)
        r2, g2, b2 = rgb.split()
        img = Image.merge("RGBA", (r2, g2, b2, a))
    else:
        # Green connected dot — dark border ring for contrast against any background
        draw = ImageDraw.Draw(img)
        dr = 10
        cx, cy = size - dr - 2, size - dr - 2
        draw.ellipse([cx - dr - 2, cy - dr - 2, cx + dr + 2, cy + dr + 2],
                     fill=(7, 9, 15, 210))
        draw.ellipse([cx - dr, cy - dr, cx + dr, cy + dr],
                     fill=(0, 232, 122, 255))

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

    def refresh_icon():
        img = make_tray_icon(_connected)
        if img and icon_holder["icon"]:
            icon_holder["icon"].icon = img

    def on_open(icon, item):
        webbrowser.open(_local_url())

    def on_disconnect(icon, item):
        if _connected:
            try:
                import urllib.request
                urllib.request.urlopen(
                    urllib.request.Request(
                        f"http://127.0.0.1:{PORT}/api/disconnect",
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

    # Notify when friends come online
    def presence_watcher():
        import urllib.request as _ur
        known = None  # None = first poll, don't notify yet
        my_name = None
        while True:
            time.sleep(5)
            if not _connected:
                known = None
                continue
            try:
                if my_name is None and os.path.exists(CONFIG_FILE):
                    with open(CONFIG_FILE) as f:
                        my_name = json.load(f).get("name", "")
                req = _ur.Request(f"{_backend_url()}/api/online", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    online = {p["name"] for p in json.loads(resp.read()) if p.get("name") != my_name and not p.get("mobile")}
                if known is None:
                    known = online
                else:
                    for name in online - known:
                        try:
                            tray.notify(f"{name} joined GamezNET", "GamezNET")
                        except Exception:
                            pass
                    for name in known - online:
                        try:
                            tray.notify(f"{name} left GamezNET", "GamezNET")
                        except Exception:
                            pass
                    known = online
            except Exception:
                pass
    threading.Thread(target=presence_watcher, daemon=True).start()

    # Notify when admin broadcasts an alert
    def alert_watcher():
        import urllib.request as _ur
        last_alert_id = None
        while True:
            time.sleep(15)
            if not _connected:
                continue
            try:
                req = _ur.Request(f"{_backend_url()}/api/alert", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                alert = data.get("alert")
                if alert and alert.get("id") != last_alert_id:
                    last_alert_id = alert["id"]
                    try:
                        tray.notify(alert.get("message", "Admin alert"), "GamezNET")
                    except Exception:
                        pass
                elif not alert:
                    last_alert_id = None
            except Exception:
                pass
    threading.Thread(target=alert_watcher, daemon=True).start()

    # Notify when a session is scheduled
    def session_watcher():
        import urllib.request as _ur
        last_id = None
        while True:
            time.sleep(20)
            if not _connected:
                continue
            try:
                req = _ur.Request(f"{_backend_url()}/api/session", headers={"User-Agent": "GamezNET"})
                with _ur.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode())
                session = data.get("session")
                if session and session.get("id") != last_id:
                    last_id = session["id"]
                    t = session.get("scheduled_time", "")
                    try:
                        import datetime as _dt, re as _re
                        t_clean = _re.sub(r'\.\d+', '', t.replace("Z", "+00:00"))
                        dt = _dt.datetime.fromisoformat(t_clean)
                        dt = dt.astimezone()  # convert UTC → local
                        time_str = dt.strftime("%b %d at %I:%M %p")
                    except Exception:
                        time_str = t
                    try:
                        tray.notify(f"{session.get('host','Someone')} scheduled {session.get('game','')} · {time_str}", "GamezNET Session")
                    except Exception:
                        pass
                elif not session:
                    last_id = None
            except Exception:
                pass
    threading.Thread(target=session_watcher, daemon=True).start()

    tray.run()

if __name__ == "__main__":
    # Tell Windows this is a distinct app, not just "Python", so notifications are branded correctly
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("GamezNET")
    except Exception:
        pass

    _instance_mutex = ensure_single_instance()   # ← single-instance guard (must be first)
    ensure_admin()
    hide_console()
    ensure_hosts_entry()                          # ← repair hosts entry if missing

    # Restore persisted status from config
    try:
        with open(CONFIG_FILE) as f:
            _player_status = json.load(f).get("status", "")
    except Exception:
        pass

    # Startup WireGuard cleanup: if tunnel service is running from a previous unclean exit,
    # send a pre-connect heartbeat to re-add UDM peer if needed, then resume connected state.
    # If no config exists, uninstall the orphaned tunnel and stay disconnected.
    try:
        CREATE_NO_WINDOW = 0x08000000
        wg = wg_cli()
        if wg:
            result = subprocess.run([wg, "show", TUNNEL_NAME], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=3)
            if result.returncode == 0 and result.stdout.strip():
                if os.path.exists(CONFIG_FILE):
                    try:
                        with open(CONFIG_FILE, "r") as f:
                            _cfg = json.load(f)
                        import urllib.request as _ur
                        _hb = json.dumps({"name": _cfg.get("name", ""), "vpn_ip": _cfg.get("vpn_ip", ""), "version": VERSION}).encode()
                        _req = _ur.Request(f"{WORKER_URL}/api/heartbeat", data=_hb, headers={"Content-Type": "application/json", "User-Agent": "GamezNET"}, method="POST")
                        _ur.urlopen(_req, timeout=5)
                        log.info("Startup pre-connect heartbeat sent (tunnel was already running)")
                    except Exception as _e:
                        log.warning("Startup heartbeat failed: %s", _e)
                    _connected = True
                else:
                    subprocess.run([wg, "/uninstalltunnelservice", TUNNEL_NAME], capture_output=True, creationflags=CREATE_NO_WINDOW)
                    log.info("Orphaned tunnel uninstalled on startup (no config found)")
                    # Flush DNS after uninstalling orphaned tunnel
                    try:
                        subprocess.run(["ipconfig", "/flushdns"], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=5)
                        log.debug("DNS cache flushed after orphaned tunnel cleanup")
                    except Exception as _flush_err:
                        log.debug("DNS flush failed: %s", _flush_err)
    except Exception:
        pass

    # Auto-migrate: if running as python and exe not installed, silently install it
    if not getattr(sys, "frozen", False):
        def _auto_migrate():
            exe_path = os.path.join(os.environ.get("LOCALAPPDATA", ""), "GamezNET", "GamezNET.exe")
            if os.path.exists(exe_path):
                return
            time.sleep(8)
            log.info("Running as python without native install — auto-migrating to exe")
            try:
                import urllib.request, ssl, certifi, tempfile
                ctx = ssl.create_default_context(cafile=certifi.where())
                tmp = os.path.join(tempfile.gettempdir(), "GamezNET-Setup.exe")
                req = urllib.request.Request(INSTALLER_URL, headers={"User-Agent": "GamezNET"})
                with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                    with open(tmp, "wb") as f:
                        f.write(resp.read())
                subprocess.run([tmp, "/VERYSILENT", "/NORESTART"],
                               creationflags=subprocess.CREATE_NO_WINDOW)
                os._exit(0)
            except Exception as e:
                log.error("Auto-migration failed: %s", e)
        threading.Thread(target=_auto_migrate, daemon=True).start()

    # Start Telemetry Thread
    threading.Thread(target=update_telemetry, daemon=True).start()

    # Start Heartbeat Thread
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    # Start Flask in background thread
    # Use waitress instead of Flask dev server for better frozen app stability
    try:
        from waitress import serve
        flask_thread = threading.Thread(
            target=lambda: serve(app, host="127.0.0.1", port=PORT, _quiet=True),
            daemon=True
        )
    except ImportError:
        # Fallback to Flask dev server if waitress unavailable
        log.warning("waitress not available, using Flask development server")
        flask_thread = threading.Thread(
            target=lambda: app.run(host="127.0.0.1", port=PORT, debug=False, use_reloader=False),
            daemon=True
        )
    flask_thread.start()

    # Open browser after Flask is up (skip on silent update — existing tab reloads itself)
    if "--no-browser" not in sys.argv:
        threading.Thread(target=open_browser, daemon=True).start()

    # Run tray icon on main thread (blocks until Exit clicked)
    run_tray(flask_thread)