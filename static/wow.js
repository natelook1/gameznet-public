import { h } from 'https://esm.sh/preact@10';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10/hooks';
import htm from 'https://esm.sh/htm@3';
const html = htm.bind(h);

const API = 'https://gameznet.looknet.ca';
const RIO = 'https://raider.io/api/v1';

function req(path, opts = {}) {
  const token   = localStorage.getItem('gzn_token');
  const session = localStorage.getItem('gzn_session');
  return fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token   ? { 'X-Token':   token   } : {}),
      ...(session ? { 'X-Session': session } : {}),
      ...(opts.headers || {})
    }
  });
}

function charAvatar(c, charCacheRef) {
  if (c && c.thumbnail) return c.thumbnail;
  if (c && charCacheRef) {
    const ck = `${c.region}-${c.realm}-${c.name}`;
    if (charCacheRef.current[ck]?.thumbnail_url) return charCacheRef.current[ck].thumbnail_url;
  }
  return 'https://render.worldofwarcraft.com/us/icons/56/inv_misc_questionmark.jpg';
}

// ── CSS injection (runs once on first WowTab mount) ──────────────────────────
function injectWowAssets() {
  if (document.getElementById('wow-styles')) return;

  // Inject Google Fonts
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&family=Exo+2:wght@300;400;600&display=swap';
  document.head.appendChild(fonts);

  // Inject WoWHead Config
  const whCfg = document.createElement('script');
  whCfg.text = 'var whTooltips = {colorLinks:true, iconizeLinks:false, renameLinks:false};';
  document.head.appendChild(whCfg);

  // Inject WoWHead Widget
  const whScript = document.createElement('script');
  whScript.id = 'wowhead-widget';
  whScript.src = 'https://wow.zamimg.com/widgets/power.js';
  document.head.appendChild(whScript);

  // Inject Scoped CSS
  const style = document.createElement('style');
  style.id = 'wow-styles';
  style.textContent = `
    .wow-wrap {
      --wow-bg:         #0d0f14;
      --wow-surface:    #13161e;
      --wow-surface2:   #1a1e2a;
      --wow-border:     #252a38;
      --wow-border2:    #2e3447;
      --wow-accent:     #00c3ff;
      --wow-accent-dim: rgba(0,195,255,0.12);
      --wow-gold:       #f0b429;
      --wow-gold-dim:   rgba(240,180,41,0.15);
      --wow-green:      #22c55e;
      --wow-green-dim:  rgba(34,197,94,0.12);
      --wow-red:        #ef4444;
      --wow-red-dim:    rgba(239,68,68,0.12);
      --wow-purple:     #a855f7;
      --wow-text:       #e2e8f0;
      --wow-muted:      #64748b;
      --wow-dim:        #94a3b8;
      --wow-radius:     6px;
      --wow-mono:       'Share Tech Mono', monospace;
      --wow-sans:       'Exo 2', sans-serif;
      --wow-display:    'Rajdhani', sans-serif;
      background:       var(--wow-bg);
      color:            var(--wow-text);
      font-family:      var(--wow-sans);
      min-height:       100%;
      font-size: 13px;
    }
    .wow-wrap .wow-nav-tabs {
      background: var(--wow-surface);
      border-bottom: 1px solid var(--wow-border);
      display: flex;
      align-items: center;
      padding: 0 20px;
      position: sticky;
      top: 0;
      z-index: 190;
      overflow-x: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .wow-wrap .wow-nav-tabs::-webkit-scrollbar { display: none; }
    .wow-wrap .wow-nav-tab {
      font-family: var(--wow-display);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 12px 18px;
      color: var(--wow-muted);
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 7px;
      user-select: none;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .wow-wrap .wow-nav-tab:hover { color: var(--wow-dim); }
    .wow-wrap .wow-nav-tab.active { color: var(--wow-text); border-bottom-color: var(--wow-accent); }
    .wow-wrap .wow-nav-tab.active.tab-world { border-bottom-color: var(--wow-green); color: var(--wow-green); }
    .wow-wrap .wow-nav-tab.active.tab-pve { border-bottom-color: var(--wow-accent); color: var(--wow-accent); }
    .wow-wrap .wow-nav-tab.active.tab-pvp { border-bottom-color: var(--wow-purple); color: var(--wow-purple); }
    .wow-wrap .wow-nav-tab.active.tab-account { border-bottom-color: var(--wow-gold); color: var(--wow-gold); }
    .wow-wrap .tab-icon { font-size: 14px; }
    .wow-wrap .layout-full { padding: 16px 20px; max-width: 1400px; margin: 0 auto; }
    .wow-wrap .wow-card { background: var(--wow-surface); border: 1px solid var(--wow-border); border-radius: var(--wow-radius); overflow: hidden; }
    .wow-wrap .card-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--wow-border);
      display: flex; align-items: center; justify-content: space-between;
      background: var(--wow-surface2);
    }
    .wow-wrap .card-title {
      font-family: var(--wow-display); font-size: 13px; font-weight: 700;
      letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-dim);
      display: flex; align-items: center; gap: 8px;
    }
    .wow-wrap .card-title .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--wow-accent); box-shadow: 0 0 6px var(--wow-accent); }
    .wow-wrap .card-title .dot-gold { background: var(--wow-gold); box-shadow: 0 0 6px var(--wow-gold); }
    .wow-wrap .card-body { padding: 14px; }
    .wow-wrap .wow-badge {
      font-family: var(--wow-mono); font-size: 10px; padding: 2px 8px;
      border-radius: 3px; letter-spacing: 1px;
    }
    .wow-wrap .badge-free { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.3); }
    .wow-wrap .badge-gold { background: var(--wow-gold-dim); color: var(--wow-gold); border: 1px solid rgba(240,180,41,0.3); }
    .wow-wrap .badge-purple { background: rgba(168,85,247,0.12); color: var(--wow-purple); border: 1px solid rgba(168,85,247,0.3); }
    .wow-wrap .badge-dim { background: var(--wow-surface2); color: var(--wow-muted); border: 1px solid var(--wow-border2); }
    .wow-wrap .btn { padding: 7px 14px; border-radius: 4px; border: none; cursor: pointer; font-family: var(--wow-display); font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; transition: all 0.15s; }
    .wow-wrap .btn-accent { background: var(--wow-accent); color: #000; }
    .wow-wrap .btn-accent:hover { background: #33d1ff; }
    .wow-wrap .btn-ghost { background: transparent; border: 1px solid var(--wow-border2); color: var(--wow-muted); }
    .wow-wrap .btn-ghost:hover { border-color: var(--wow-accent); color: var(--wow-accent); }
    .wow-wrap .admin-input {
      width: 100%; background: var(--wow-bg); border: 1px solid var(--wow-border2); border-radius: 4px;
      padding: 7px 10px; color: var(--wow-text); font-family: var(--wow-mono); font-size: 12px;
      outline: none; transition: border-color 0.15s;
    }
    .wow-wrap .admin-input:focus { border-color: var(--wow-accent); }
    .wow-wrap .admin-input::placeholder { color: var(--wow-muted); }
    .wow-wrap .char-list { display: flex; flex-direction: column; gap: 6px; }
    .wow-wrap .char-list-row {
      display: flex; align-items: center; gap: 10px;
      background: var(--wow-surface2); border: 1px solid var(--wow-border2); border-radius: 4px; padding: 8px 12px;
    }
    .wow-wrap .char-list-avatar { width: 32px; height: 32px; border-radius: 3px; object-fit: cover; background: var(--wow-bg); border: 1px solid var(--wow-border2); flex-shrink: 0; }
    .wow-wrap .char-list-name { flex: 1; font-family: var(--wow-display); font-size: 13px; font-weight: 600; }
    .wow-wrap .char-list-realm { font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .char-list-del { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-red); cursor: pointer; padding: 2px 6px; border: 1px solid rgba(239,68,68,0.3); border-radius: 3px; }
    .wow-wrap .char-list-del:hover { background: rgba(239,68,68,0.12); }
    .wow-wrap .empty { text-align: center; padding: 24px; color: var(--wow-muted); font-family: var(--wow-mono); font-size: 11px; letter-spacing: 1px; }
    .wow-wrap .info-box { background: var(--wow-bg); border: 1px solid var(--wow-border); border-left: 3px solid var(--wow-accent); border-radius: 4px; padding: 10px 12px; font-size: 11px; color: var(--wow-muted); line-height: 1.7; margin-bottom: 12px; }
    .wow-wrap .info-box strong { color: var(--wow-text); }
    .wow-wrap .info-box.gold { border-left-color: var(--wow-gold); }
    
    .wow-wrap .score-display { text-align: center; padding: 14px 0 6px; }
    .wow-wrap .score-big { font-family: var(--wow-mono); font-size: 52px; font-weight: 700; color: var(--wow-accent); line-height: 1; text-shadow: 0 0 30px rgba(0,195,255,0.3); }
    .wow-wrap .score-lbl { font-size: 10px; color: var(--wow-muted); letter-spacing: 3px; margin-top: 4px; }
    .wow-wrap .score-season { font-size: 11px; color: var(--wow-muted); margin-top: 6px; }
    .wow-wrap .score-roles { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-top: 14px; }
    .wow-wrap .role-box { background: var(--wow-surface2); border: 1px solid var(--wow-border2); border-radius: 4px; padding: 8px; text-align: center; }
    .wow-wrap .role-val { font-family: var(--wow-mono); font-size: 16px; font-weight: 700; }
    .wow-wrap .role-lbl { font-size: 9px; color: var(--wow-muted); letter-spacing: 1.5px; margin-top: 2px; }
    .wow-wrap .run-list { display: flex; flex-direction: column; gap: 5px; }
    .wow-wrap .run-row { display: flex; align-items: center; gap: 10px; background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: 4px; padding: 8px 12px; transition: border-color 0.15s; }
    .wow-wrap .run-row:hover { border-color: var(--wow-border2); }
    .wow-wrap .run-key { font-family: var(--wow-mono); font-size: 14px; font-weight: 700; width: 30px; text-align: center; flex-shrink: 0; }
    .wow-wrap .run-key.high { color: var(--wow-purple); }
    .wow-wrap .run-key.mid  { color: var(--wow-accent); }
    .wow-wrap .run-key.low  { color: var(--wow-dim); }
    .wow-wrap .run-dungeon  { flex: 1; }
    .wow-wrap .run-dname    { font-family: var(--wow-display); font-size: 13px; font-weight: 600; }
    .wow-wrap .run-dshort   { font-size: 10px; color: var(--wow-muted); margin-top: 1px; }
    .wow-wrap .run-time { font-family: var(--wow-mono); font-size: 11px; }
    .wow-wrap .run-time.timed    { color: var(--wow-green); }
    .wow-wrap .run-time.depleted { color: var(--wow-red); }
    .wow-wrap .run-score { font-family: var(--wow-mono); font-size: 12px; color: var(--wow-gold); width: 48px; text-align: right; }
    .wow-wrap .boss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 130px), 1fr)); gap: 6px; }
    .wow-wrap .boss-pip { background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: 4px; padding: 7px 10px; display: flex; align-items: center; gap: 7px; }
    .wow-wrap .boss-pip.killed-n { border-color: rgba(34,197,94,0.35); }
    .wow-wrap .boss-pip.killed-h { border-color: rgba(0,195,255,0.35); }
    .wow-wrap .boss-pip.killed-m { border-color: rgba(168,85,247,0.4); }
    .wow-wrap .boss-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .wow-wrap .boss-dot.n { background: var(--wow-green); box-shadow: 0 0 4px var(--wow-green); }
    .wow-wrap .boss-dot.h { background: var(--wow-accent); box-shadow: 0 0 4px var(--wow-accent); }
    .wow-wrap .boss-dot.m { background: var(--wow-purple); box-shadow: 0 0 4px var(--wow-purple); }
    .wow-wrap .boss-dot.x { background: var(--wow-border2); }
    .wow-wrap .boss-name { font-family: var(--wow-display); font-size: 11px; font-weight: 600; color: var(--wow-dim); }
    .wow-wrap .raid-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .wow-wrap .raid-name   { font-family: var(--wow-display); font-size: 16px; font-weight: 700; }
    .wow-wrap .diff-pill { font-family: var(--wow-mono); font-size: 10px; padding: 3px 8px; border-radius: 3px; letter-spacing: 1px; }
    .wow-wrap .diff-n { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.4); }
    .wow-wrap .diff-h { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,195,255,0.4); }
    .wow-wrap .diff-m { background: rgba(168,85,247,0.12); color: var(--wow-purple); border: 1px solid rgba(168,85,247,0.4); }
    .wow-wrap .weekly-run { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: 4px; margin-bottom: 5px; }
    .wow-wrap .wk-key  { font-family: var(--wow-mono); font-size: 16px; font-weight: 700; color: var(--wow-gold); width: 28px; text-align: center; flex-shrink: 0; }
    .wow-wrap .wk-name { flex: 1; font-family: var(--wow-display); font-size: 13px; font-weight: 600; }
    .wow-wrap .wk-time { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-muted); }
    .wow-wrap .pvp-coming { background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: var(--wow-radius); padding: 20px; }
    .wow-wrap .pvp-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr)); gap: 10px; margin-bottom: 14px; }
    .wow-wrap .pvp-stat-box { background: var(--wow-bg); border: 1px solid var(--wow-border2); border-radius: 5px; padding: 14px; text-align: center; }
    .wow-wrap .pvp-stat-val { font-family: var(--wow-mono); font-size: 26px; font-weight: 700; color: var(--wow-purple); line-height: 1; }
    .wow-wrap .pvp-stat-lbl { font-size: 9px; color: var(--wow-muted); letter-spacing: 2px; margin-top: 4px; text-transform: uppercase; }
    .wow-wrap .pvp-note { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); text-align: center; letter-spacing: 1px; padding: 12px; border: 1px dashed var(--wow-border2); border-radius: 4px; }
    .wow-wrap .conquest-bar-wrap { background: var(--wow-bg); border: 1px solid var(--wow-border); border-radius: 4px; height: 12px; overflow: hidden; margin: 8px 0 4px; }
    .wow-wrap .conquest-bar-fill { height: 100%; background: linear-gradient(90deg, var(--wow-purple), #7c3aed); border-radius: 4px; transition: width 0.8s ease; }
    .wow-wrap .reset-banner { background: linear-gradient(90deg, var(--wow-surface) 0%, rgba(240,180,41,0.06) 50%, var(--wow-surface) 100%); border-bottom: 1px solid rgba(240,180,41,0.2); padding: 7px 20px; display: flex; align-items: center; justify-content: center; gap: 16px; }
    .wow-wrap .reset-label   { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); text-transform: uppercase; letter-spacing: 2px; }
    .wow-wrap .reset-time    { font-family: var(--wow-mono); font-size: 15px; color: var(--wow-gold); font-weight: 700; letter-spacing: 3px; }
    .wow-wrap .reset-divider { color: var(--wow-border2); }
    .wow-wrap .level-hero { background: var(--wow-surface2); border: 1px solid var(--wow-border2); border-radius: var(--wow-radius); padding: 20px; display: flex; align-items: center; gap: 20px; }
    .wow-wrap .level-big { font-family: var(--wow-mono); font-size: 64px; font-weight: 700; color: var(--wow-green); line-height: 1; text-shadow: 0 0 30px rgba(34,197,94,0.3); flex-shrink: 0; }
    .wow-wrap .level-info { flex: 1; }
    .wow-wrap .level-label { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); letter-spacing: 3px; text-transform: uppercase; margin-bottom: 8px; }
    .wow-wrap .level-bar-wrap { background: var(--wow-bg); border: 1px solid var(--wow-border); border-radius: 4px; height: 10px; overflow: hidden; margin-bottom: 6px; }
    .wow-wrap .level-bar-fill { height: 100%; background: linear-gradient(90deg, var(--wow-green), #16a34a); border-radius: 4px; transition: width 0.8s ease; }
    .wow-wrap .level-xp { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-muted); }
    .wow-wrap .level-max-note { font-size: 11px; color: var(--wow-muted); margin-top: 4px; }

    @media (max-width: 768px) {
      .wow-wrap .level-hero { flex-direction: column; text-align: center; padding: 16px; gap: 10px; }
      .wow-wrap .wow-nav-tabs { padding: 0 10px; }
      .wow-wrap .wow-nav-tab { padding: 12px 14px; font-size: 12px; }
      .wow-wrap .wow-layout, .wow-wrap .layout-full { padding: 12px 10px; }
      .wow-wrap .card-header, .wow-wrap .card-body { padding: 10px; }
    }
    .wow-wrap .dungeon-list { display: flex; flex-direction: column; gap: 5px; }
    .wow-wrap .dungeon-row { display: flex; align-items: center; gap: 10px; background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: 4px; padding: 8px 12px; }
    .wow-wrap .dungeon-icon { font-size: 16px; flex-shrink: 0; }
    .wow-wrap .dungeon-name { flex: 1; font-family: var(--wow-display); font-size: 13px; font-weight: 600; }
    .wow-wrap .dungeon-status { font-family: var(--wow-mono); font-size: 10px; padding: 2px 6px; border-radius: 3px; }
    .wow-wrap .ds-unlocked { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.3); }
    .wow-wrap .ds-locked   { background: var(--wow-surface); color: var(--wow-muted); border: 1px solid var(--wow-border); }
    .wow-wrap .ds-current  { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,195,255,0.3); }
    
    .wow-wrap .char-bar { background: var(--wow-surface2); border-bottom: 1px solid var(--wow-border); padding: 0 20px; display: flex; align-items: stretch; position: sticky; top: 48px; z-index: 180; overflow: hidden; }
    .wow-wrap .char-bar-overview { display: flex; align-items: center; flex-shrink: 0; padding: 0 14px 0 0; margin-right: 4px; border-right: 1px solid var(--wow-border2); }
    .wow-wrap .char-bar-scroll { display: flex; align-items: center; gap: 0; overflow-x: auto; flex: 1; scrollbar-width: none; -ms-overflow-style: none; }
    .wow-wrap .char-bar-scroll::-webkit-scrollbar { display: none; }
    .wow-wrap .char-group { display: flex; align-items: stretch; flex-shrink: 0; border-right: 1px solid var(--wow-border); padding: 0 4px; }
    .wow-wrap .char-group:last-child { border-right: none; }
    .wow-wrap .char-group-inner { display: flex; flex-direction: column; justify-content: center; gap: 0; }
    .wow-wrap .char-group-label { font-family: var(--wow-mono); font-size: 8px; color: var(--wow-muted); letter-spacing: 1.5px; text-transform: uppercase; padding: 4px 8px 0; line-height: 1; }
    .wow-wrap .char-group-chips { display: flex; align-items: center; gap: 3px; padding: 4px 4px 4px; }
    .wow-wrap .char-chip { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 4px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: all 0.15s; font-family: var(--wow-display); font-size: 13px; font-weight: 600; color: var(--wow-muted); white-space: nowrap; flex-shrink: 0; }
    .wow-wrap .char-chip:hover { border-color: var(--wow-border2); color: var(--wow-text); background: var(--wow-bg); }
    .wow-wrap .char-chip.active { border-color: var(--wow-accent); color: var(--wow-text); background: var(--wow-accent-dim); box-shadow: 0 0 8px rgba(0,195,255,0.1); }
    .wow-wrap .char-chip.is-main.active { border-color: var(--wow-gold); background: var(--wow-gold-dim); }
    .wow-wrap .char-chip.is-alt { font-size: 12px; opacity: 0.75; }
    .wow-wrap .char-chip.is-alt:hover, .wow-wrap .char-chip.is-alt.active { opacity: 1; }
    .wow-wrap .char-chip .chip-avatar { width: 20px; height: 20px; border-radius: 3px; object-fit: cover; background: var(--wow-border2); flex-shrink: 0; }
    .wow-wrap .char-chip.is-main .chip-avatar { width: 24px; height: 24px; border-radius: 4px; }
    .wow-wrap .char-chip .chip-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
    .wow-wrap .char-chip .chip-dot.online { background: var(--wow-green); box-shadow: 0 0 4px var(--wow-green); }
    .wow-wrap .char-chip .chip-dot.offline { background: var(--wow-border2); }
    .wow-wrap .overview-chip { display: flex; align-items: center; gap: 7px; padding: 8px 12px; font-family: var(--wow-display); font-size: 13px; font-weight: 600; color: var(--wow-muted); cursor: pointer; border-radius: 4px; transition: all 0.15s; white-space: nowrap; border: 1px solid transparent; }
    .wow-wrap .overview-chip:hover, .wow-wrap .overview-chip.active { color: var(--wow-text); border-color: var(--wow-border2); background: var(--wow-bg); }
    
    .wow-wrap .skel { background: linear-gradient(90deg, var(--wow-surface2) 25%, var(--wow-border) 50%, var(--wow-surface2) 75%); background-size: 200% 100%; animation: wow-shimmer 1.4s infinite; border-radius: 4px; }
    @keyframes wow-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    .wow-wrap .col-main { display: flex; flex-direction: column; gap: 14px; flex: 1; min-width: 0; }
    .wow-wrap .col-side { display: flex; flex-direction: column; gap: 14px; width: 340px; flex-shrink: 0; }
    .wow-wrap .wow-layout { display: flex; gap: 16px; padding: 16px 20px; max-width: 1400px; margin: 0 auto; }
    @media (max-width: 1000px) { .wow-wrap .wow-layout { flex-direction: column; } .wow-wrap .col-side { width: 100%; order: -1; } }
    
    .wow-wrap .affix-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .wow-wrap .affix-pill { display: flex; align-items: center; gap: 10px; background: var(--wow-surface2); border: 1px solid var(--wow-border2); border-radius: 4px; padding: 8px 12px; flex: 1; min-width: 160px; }
    .wow-wrap .affix-icon { width: 34px; height: 34px; border-radius: 4px; border: 1px solid var(--wow-border2); object-fit: cover; flex-shrink: 0; background: var(--wow-bg); }
    .wow-wrap .affix-name { font-family: var(--wow-display); font-size: 14px; font-weight: 600; }
    .wow-wrap .affix-desc { font-size: 10px; color: var(--wow-muted); margin-top: 2px; line-height: 1.4; }
    
    .wow-wrap .roster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
    .wow-wrap .player-card { background: var(--wow-surface2); border: 1px solid var(--wow-border2); border-radius: var(--wow-radius); overflow: hidden; transition: border-color 0.15s; }
    .wow-wrap .player-card:hover { border-color: var(--wow-border); }
    .wow-wrap .player-card-bar { height: 3px; }
    .wow-wrap .player-card-bar.dk { background: linear-gradient(90deg,#C41E3A,#8B0000); box-shadow: 0 0 8px rgba(196,30,58,0.4); }
    .wow-wrap .player-card-bar.mage { background: linear-gradient(90deg,#3FC7EB,#1a8fa8); }
    .wow-wrap .player-card-bar.hunter { background: linear-gradient(90deg,#AAD372,#6a9a3a); }
    .wow-wrap .player-card-bar.paladin { background: linear-gradient(90deg,#F48CBA,#c45a8a); }
    .wow-wrap .player-card-bar.warrior { background: linear-gradient(90deg,#C69B3A,#8a6a1a); }
    .wow-wrap .player-card-bar.priest { background: linear-gradient(90deg,#FFFFFF,#aaaaaa); }
    .wow-wrap .player-card-bar.druid { background: linear-gradient(90deg,#FF7C0A,#c04a00); }
    .wow-wrap .player-card-bar.rogue { background: linear-gradient(90deg,#FFF468,#c0b030); }
    .wow-wrap .player-card-bar.shaman { background: linear-gradient(90deg,#0070DD,#004a99); }
    .wow-wrap .player-card-bar.warlock { background: linear-gradient(90deg,#8788EE,#5555bb); }
    .wow-wrap .player-card-bar.monk { background: linear-gradient(90deg,#00FF98,#009955); }
    .wow-wrap .player-card-bar.dh { background: linear-gradient(90deg,#A330C9,#6a0099); }
    .wow-wrap .player-card-bar.evoker { background: linear-gradient(90deg,#33937F,#1a6055); }
    .wow-wrap .player-card-bar.default { background: var(--wow-border2); }
    
    .wow-wrap .player-main { padding: 12px 14px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: background 0.15s; }
    .wow-wrap .player-main:hover { background: rgba(255,255,255,0.03); }
    .wow-wrap .player-main-avatar { width: 52px; height: 52px; border-radius: 5px; object-fit: cover; flex-shrink: 0; background: var(--wow-bg); border: 1px solid var(--wow-border2); }
    .wow-wrap .player-main-info { flex: 1; min-width: 0; }
    .wow-wrap .player-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 1px; }
    .wow-wrap .player-name { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); letter-spacing: 2px; text-transform: uppercase; }
    .wow-wrap .player-online-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--wow-green); box-shadow: 0 0 4px var(--wow-green); flex-shrink: 0; }
    .wow-wrap .player-online-dot.offline { background: var(--wow-border2); box-shadow: none; }
    .wow-wrap .char-name { font-family: var(--wow-display); font-size: 18px; font-weight: 700; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wow-wrap .char-sub { font-size: 11px; color: var(--wow-muted); margin-top: 3px; }
    .wow-wrap .char-stats { display: flex; gap: 5px; margin-top: 7px; flex-wrap: wrap; }
    .wow-wrap .cs { font-family: var(--wow-mono); font-size: 10px; padding: 2px 7px; border-radius: 3px; }
    .wow-wrap .cs-ilvl { background: var(--wow-gold-dim); color: var(--wow-gold); border: 1px solid rgba(240,180,41,0.3); }
    .wow-wrap .cs-score { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,195,255,0.3); }
    .wow-wrap .cs-raid { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.3); }
    
    .wow-wrap .main-nav-btn { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
    .wow-wrap .nav-btn { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1px; padding: 4px 8px; border-radius: 3px; border: 1px solid var(--wow-border2); color: var(--wow-muted); cursor: pointer; transition: all 0.15s; text-align: center; white-space: nowrap; }
    .wow-wrap .nav-btn:hover { border-color: var(--wow-accent); color: var(--wow-accent); background: var(--wow-accent-dim); }
    .wow-wrap .nav-btn.pve:hover { border-color: var(--wow-accent); color: var(--wow-accent); }
    .wow-wrap .nav-btn.pvp:hover { border-color: var(--wow-purple); color: var(--wow-purple); background: rgba(168,85,247,0.08); }
    .wow-wrap .nav-btn.lvl:hover { border-color: var(--wow-green); color: var(--wow-green); background: var(--wow-green-dim); }
    
    .wow-wrap .player-alts { border-top: 1px solid var(--wow-border); padding: 8px 14px; display: flex; align-items: center; gap: 6px; background: rgba(0,0,0,0.15); flex-wrap: wrap; }
    .wow-wrap .alts-label { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); letter-spacing: 1.5px; text-transform: uppercase; flex-shrink: 0; margin-right: 2px; }
    .wow-wrap .alt-chip { display: flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 3px; border: 1px solid var(--wow-border); background: var(--wow-bg); cursor: pointer; font-family: var(--wow-display); font-size: 11px; font-weight: 600; color: var(--wow-muted); transition: all 0.15s; }
    .wow-wrap .alt-chip:hover { border-color: var(--wow-border2); color: var(--wow-text); }
    .wow-wrap .alt-chip img { width: 16px; height: 16px; border-radius: 2px; object-fit: cover; }
  `;
  document.head.appendChild(style);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function lastSeenStr(cacheEntry) {
  const ts = cacheEntry?._bnet?.charStatus?.last_login_timestamp;
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ───────────────────────────────────────────────────────────
function WowOverview({ characters, charCacheRef, affixCacheRef, onSelectChar, onSubTab, dataTick }) {
  const players = {};
  characters.forEach((c, i) => {
    const p = c.player_name || c.display_name;
    if (!players[p]) players[p] = { main: null, alts: [] };
    if (c.is_main) players[p].main = { c, i };
    else           players[p].alts.push({ c, i });
  });

  Object.values(players).forEach(p => {
    if (!p.main && p.alts.length) p.main = p.alts.shift();
  });

  const getClassBarKey = (cls) => {
    if (!cls) return 'default';
    const c = cls.toLowerCase();
    if (c.includes('death knight')) return 'dk';
    if (c.includes('demon hunter')) return 'dh';
    if (c.includes('evoker'))       return 'evoker';
    return c.split(' ')[0] || 'default';
  };

  const renderRosterCard = ([playerName, { main, alts }]) => {
    if (!main) return null;
    const { c, i } = main;
    const cacheKey = `${c.region}-${c.realm}-${c.name}`;
    const rio = charCacheRef.current[cacheKey];

    const ilvl = rio?.gear?.item_level_equipped ?? '—';
    const score = rio?.mythic_plus_scores_by_season?.[0]?.scores?.all;
    const lastSeen = lastSeenStr(charCacheRef.current[cacheKey]);
    const title = charCacheRef.current[cacheKey]?._bnet?.profile?.active_title?.display_string;

    const raidSummary = (prog) => {
      if (!prog) return '—';
      const raids = Object.entries(prog);
      if (!raids.length) return '—';
      const data = raids[raids.length-1][1];
      if (data.mythic_bosses_killed > 0) return `${data.mythic_bosses_killed}/${data.total_bosses}M`;
      if (data.heroic_bosses_killed > 0) return `${data.heroic_bosses_killed}/${data.total_bosses}H`;
      if (data.normal_bosses_killed > 0) return `${data.normal_bosses_killed}/${data.total_bosses}N`;
      return `0/${data.total_bosses}`;
    };
    const raid = raidSummary(rio?.raid_progression);
    const barKey = getClassBarKey(c.class);
    const achieveMeta = rio?.raid_achievement_meta || {};
    const latestRaidKey = Object.keys(achieveMeta).pop();
    const latestMeta = latestRaidKey ? achieveMeta[latestRaidKey] : null;

    return html`
      <div class="player-card">
        <div class="player-card-bar ${barKey}"></div>
        <div class="player-main" onClick=${() => { onSelectChar(i); onSubTab('world'); }}>
          <img class="player-main-avatar" src=${charAvatar(c, charCacheRef)} onError=${e => e.target.style.opacity='0.3'} />
          <div class="player-main-info">
            <div class="player-name-row">
              <div class="player-name">${playerName}</div>
              <div class="player-online-dot offline" title=${lastSeen ? `Last online ${lastSeen}` : 'Last login unknown'}></div>
              ${lastSeen ? html`<span style="font-size:10px;color:var(--wow-muted);margin-left:4px;">${lastSeen}</span>` : ''}
            </div>
            <div class="char-name">
              ${c.display_name} ${c.is_main ? html`<span style="font-size:12px;color:var(--wow-gold);">★</span>` : ''}
              ${latestMeta?.has_ce ? html`<span title="Cutting Edge" style="font-size:9px;padding:1px 4px;border-radius:2px;background:linear-gradient(135deg,#a335ee,#ff8000);color:#fff;font-weight:700;margin-left:4px;">CE</span>` : (latestMeta?.has_aotc ? html`<span title="Ahead of the Curve" style="font-size:9px;padding:1px 4px;border-radius:2px;background:rgba(0,200,255,0.15);border:1px solid var(--wow-accent);color:var(--wow-accent);font-weight:700;margin-left:4px;">AotC</span>` : '')}
            </div>
            ${title ? html`<div style="font-size:10px;color:var(--wow-gold);opacity:0.8;margin-bottom:2px;font-style:italic;">${title.replace('{name}', c.display_name)}</div>` : ''}
            <div class="char-sub">${c.spec||''} ${c.class||''} · ${c.realm}</div>
            <div class="char-stats">
              <span class="cs cs-ilvl">${ilvl} ilvl</span>
              ${score ? html`<span class="cs cs-score">${Math.round(score)} M+</span>` : ''}
              ${raid !== '—' ? html`<span class="cs cs-raid">${raid}</span>` : ''}
            </div>
          </div>
          <div class="main-nav-btn">
            <div class="nav-btn pve" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('pve'); }}>⚔ PVE</div>
            <div class="nav-btn pvp" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('pvp'); }}>🏆 PVP</div>
            <div class="nav-btn lvl" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('world'); }}>🌍 WRLD</div>
          </div>
        </div>
        ${alts.length > 0 ? html`
          <div class="player-alts">
            <div class="alts-label">Alts</div>
            ${alts.map(({ c: ac, i: ai }) => html`
              <div class="alt-chip" onClick=${(e) => { e.stopPropagation(); onSelectChar(ai); onSubTab('world'); }} title="${ac.display_name} · ${ac.spec||''} ${ac.class||''} · ${ac.realm}">
                <img src=${charAvatar(ac, charCacheRef)} onError=${e => e.target.style.display='none'} />
                ${ac.display_name}
              </div>
            `)}
          </div>
        ` : ''}
      </div>
    `;
  };

  const affixes = affixCacheRef.current?.affix_details || [];

  const activities = [];
  characters.forEach(c => {
    const cacheKey = `${c.region}-${c.realm}-${c.name}`;
    const cache = charCacheRef.current[cacheKey];
    if (!cache) return;
    
    if (cache.mythic_plus_recent_runs) {
      cache.mythic_plus_recent_runs.forEach(run => {
        if (run.completed_at) {
          activities.push({ type: 'mplus', char: c, ts: new Date(run.completed_at).getTime(), run });
        }
      });
    }
    if (cache._bnet?.achievements?.recent_events) {
      cache._bnet.achievements.recent_events.forEach(ev => {
        activities.push({ type: 'achievement', char: c, ts: ev.timestamp, achievement: ev.achievement });
      });
    }
  });
  activities.sort((a, b) => b.ts - a.ts);
  const recentActivities = activities.slice(0, 15);

  const renderActivity = (act) => {
    const diffMs = Date.now() - act.ts;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    let timeStr = 'Just now';
    if (diffDays > 0) timeStr = `${diffDays}d ago`;
    else if (diffHours > 0) timeStr = `${diffHours}h ago`;
    else if (diffMins > 0) timeStr = `${diffMins}m ago`;

    if (act.type === 'mplus') {
      const timed = act.run.num_keystone_upgrades > 0;
      return html`<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;margin-bottom:6px;"><div style="width:24px;height:24px;border-radius:3px;background:var(--wow-bg);display:flex;align-items:center;justify-content:center;font-size:12px;">🗝️</div><div style="flex:1;min-width:0;"><div style="font-family:var(--wow-display);font-size:12px;font-weight:600;"><span style="color:var(--wow-accent);cursor:pointer;" onClick=${() => { onSelectChar(characters.indexOf(act.char)); onSubTab('pve'); }}>${act.char.display_name}</span> completed +${act.run.mythic_level} ${act.run.dungeon}</div><div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${timeStr}</div></div><div style="font-size:12px;color:${timed ? 'var(--wow-green)' : 'var(--wow-red)'};">${timed ? '✓' : '✗'}</div></div>`;
    } else if (act.type === 'achievement') {
      return html`<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;margin-bottom:6px;"><div style="width:24px;height:24px;border-radius:3px;background:var(--wow-bg);display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 0 6px rgba(240,180,41,0.2);">🏆</div><div style="flex:1;min-width:0;"><div style="font-family:var(--wow-display);font-size:12px;font-weight:600;"><span style="color:var(--wow-accent);cursor:pointer;" onClick=${() => { onSelectChar(characters.indexOf(act.char)); onSubTab('world'); }}>${act.char.display_name}</span> earned <a href="https://www.wowhead.com/achievement=${act.achievement.id}" target="_blank" style="color:var(--wow-gold);text-decoration:none;" data-wowhead="achievement=${act.achievement.id}">${act.achievement.name}</a></div><div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${timeStr}</div></div></div>`;
    }
  };

  return html`
    <div class="wow-layout">
      <div class="col-main">
        <div class="wow-card">
          <div class="card-header">
            <div class="card-title"><div class="dot"></div> This Week's Affixes</div>
          </div>
          <div class="card-body">
            <div class="affix-row">
              ${affixes.length > 0 ? affixes.slice(0,4).map(a => html`
                <div class="affix-pill">
                  <img class="affix-icon" src="https://wow.zamimg.com/images/wow/icons/medium/${a.icon}.jpg" onError=${e => e.target.style.display='none'} />
                  <div>
                    <div class="affix-name">${a.name}</div>
                    <div class="affix-desc">${(a.description||'').slice(0,65)}${(a.description||'').length>65?'…':''}</div>
                  </div>
                </div>
              `) : html`
                <div class="affix-pill skel" style="height:52px;"></div>
                <div class="affix-pill skel" style="height:52px;"></div>
                <div class="affix-pill skel" style="height:52px;"></div>
              `}
            </div>
          </div>
        </div>

        <div class="wow-card">
          <div class="card-header">
            <div class="card-title"><div class="dot"></div> Roster</div>
          </div>
          <div class="card-body">
            <div class="roster-grid">
              ${Object.keys(players).length > 0 ? Object.entries(players).map(renderRosterCard) : html`
                <div class="empty" style="grid-column: 1/-1;">No characters found. Add some in My Account!</div>
              `}
            </div>
          </div>
        </div>
      </div>
      
      <div class="col-side">
        <div class="wow-card">
          <div class="card-header">
            <div class="card-title"><div class="dot"></div> Quick Stats</div>
          </div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;margin-bottom:6px;">
              <span style="font-family:var(--wow-display);font-size:12px;font-weight:600;">Players</span>
              <span style="font-family:var(--wow-mono);font-size:14px;color:var(--wow-text);">${Object.keys(players).length}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;margin-bottom:6px;">
              <span style="font-family:var(--wow-display);font-size:12px;font-weight:600;">Characters</span>
              <span style="font-family:var(--wow-mono);font-size:14px;color:var(--wow-text);">${characters.length}</span>
            </div>
          </div>
        </div>
        <div class="wow-card">
          <div class="card-header">
            <div class="card-title"><div class="dot"></div> Recent Activity</div>
          </div>
          <div class="card-body" style="max-height:480px;overflow-y:auto;padding:10px;">
            ${Object.keys(charCacheRef.current).length === 0 && characters.length > 0 ? html`
              <div class="skel" style="height:48px;margin-bottom:8px;border-radius:4px;"></div>
              <div class="skel" style="height:48px;margin-bottom:8px;border-radius:4px;"></div>
              <div class="skel" style="height:48px;margin-bottom:8px;border-radius:4px;"></div>
            ` : (recentActivities.length > 0 ? recentActivities.map(renderActivity) : html`<div class="empty">No recent activity found.</div>`)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function getZoneProgress(lvl) {
  return [
    { name: 'The War Within — Isle of Dorn',      min: 70, max: 72, done: lvl >= 72 },
    { name: 'The War Within — The Ringing Deeps', min: 72, max: 74, done: lvl >= 74 },
    { name: 'The War Within — Hallowfall',        min: 74, max: 76, done: lvl >= 76 },
    { name: 'The War Within — Azj-Kahet',         min: 76, max: 90, done: lvl >= 90 },
  ];
}

function getDungeonUnlocks(lvl) {
  const status = (min) => lvl >= min ? (lvl === min ? 'ds-current' : 'ds-unlocked') : 'ds-locked';
  const label  = (min) => lvl >= min ? (lvl === min ? 'IN PROGRESS' : 'UNLOCKED') : 'LOCKED';
  return [
    { name: 'Normal Dungeons',  icon: '🗡️', status: status(10),  label: label(10)  },
    { name: 'Heroic Dungeons',  icon: '⚔️',  status: status(70),  label: label(70)  },
    { name: 'Mythic Dungeons',  icon: '💀',  status: status(70),  label: label(70)  },
    { name: 'Mythic+ (Season)', icon: '🔑',  status: status(90),  label: label(90)  },
    { name: 'LFR Raid',         icon: '🏰',  status: status(90),  label: label(90)  },
    { name: 'Normal Raid',      icon: '🏰',  status: status(90),  label: label(90)  },
    { name: 'Heroic Raid',      icon: '🏰',  status: status(90),  label: label(90)  },
  ];
}

function WowWorld({ characters, activeChar, charCacheRef, bnetTokenRef, collectionsRef, dataTick }) {
  const [colView, setColView] = useState(null); // 'mounts' | 'pets' | null
  const [colSearch, setColSearch] = useState('');
  const [colCompareIdx, setColCompareIdx] = useState(-1);
  const [loadingCol, setLoadingCol] = useState(false);
  const [colError, setColError] = useState(false);
  const [expandedProf, setExpandedProf] = useState(null); // profession name string
  const [profRecipeSearch, setProfRecipeSearch] = useState('');

  const character = characters[activeChar];
  if (!character) return null;
  
  const cacheKey = `${character.region}-${character.realm}-${character.name}`;
  const c = charCacheRef.current[cacheKey] || {};
  const bnet = c._bnet || {};

  const lvl = bnet?.profile?.level || c.level || 90;
  const maxLvl = 90;
  const isMax = lvl >= maxLvl;
  const pct = isMax ? 100 : Math.round((lvl / maxLvl) * 100);

  const openCollection = async (type) => {
    setColView(type);
    setColSearch('');
    setColCompareIdx(-1);
    
    if (!collectionsRef.current[type]) {
      setLoadingCol(true);
      setColError(false);
      try {
        const singularType = type === 'mounts' ? 'mount' : 'pet';
        const url = `https://${character.region || 'us'}.api.blizzard.com/data/wow/${singularType}/index?namespace=static-${character.region || 'us'}&locale=en_US`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${bnetTokenRef.current}` } });
        if (res.ok) {
          const data = await res.json();
          collectionsRef.current[type] = data[type] || data[type + 's'] || [];
        } else {
          setColError(true);
        }
      } catch (e) {
        setColError(true);
      } finally {
        setLoadingCol(false);
      }
    }
  };

  const renderCollectionsView = () => {
    if (loadingCol) return html`
      <div class="layout-full" style="display:flex;align-items:center;justify-content:center;height:300px;flex-direction:column;gap:14px;">
        <div class="skel" style="width:40px;height:40px;border-radius:50%;"></div>
        <div style="font-family:var(--wow-mono);font-size:12px;color:var(--wow-muted);letter-spacing:2px;">LOADING COLLECTIONS...</div>
      </div>
    `;

    if (colError) return html`
      <div class="layout-full">
        <div class="empty" style="margin-top:100px;">Failed to load collection data.</div>
        <div style="text-align:center;"><button class="btn btn-ghost" onClick=${() => setColView(null)}>← Back to World</button></div>
      </div>
    `;

    const masterList = collectionsRef.current[colView] || [];
    const charA = character;
    const charB = colCompareIdx >= 0 ? characters[colCompareIdx] : null;

    const getOwnedSet = (ch) => {
      const set = new Set();
      const cbKey = ch ? `${ch.region}-${ch.realm}-${ch.name}` : null;
      const cbnet = cbKey ? charCacheRef.current[cbKey]?._bnet : null;
      if (!cbnet || !cbnet[colView]) return set;
      const arr = cbnet[colView][colView] || [];
      arr.forEach(item => {
        const id = colView === 'mounts' ? item.mount?.id : item.species?.id;
        if (id) set.add(id);
      });
      return set;
    };

    const ownedA = getOwnedSet(charA);
    const ownedB = getOwnedSet(charB);

    let countA = 0, countB = 0, countBoth = 0;
    const gridItems = [];

    masterList.forEach(item => {
      const hasA = ownedA.has(item.id);
      const hasB = charB ? ownedB.has(item.id) : false;
      
      if (hasA) countA++;
      if (hasB) countB++;
      if (hasA && hasB) countBoth++;

      if (colSearch && !item.name.toLowerCase().includes(colSearch)) return;

      let boxStyle = 'background:var(--wow-surface2);border:1px solid var(--wow-border);';
      let textStyle = 'color:var(--wow-text);';
      let badgeHtml = '';

      if (charB) {
        if (hasA && hasB) {
          boxStyle = 'background:var(--wow-surface2);border:1px solid rgba(0,195,255,0.4);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;background:rgba(0,195,255,0.1);color:var(--wow-accent);padding:2px 6px;border-radius:3px;">Both Have</div>`;
        } else if (hasA) {
          boxStyle = 'background:var(--wow-surface2);border:1px solid rgba(34,197,94,0.4);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;background:rgba(34,197,94,0.1);color:var(--wow-green);padding:2px 6px;border-radius:3px;">${charA.display_name}</div>`;
        } else if (hasB) {
          boxStyle = 'background:var(--wow-surface2);border:1px solid rgba(240,180,41,0.5);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;background:rgba(240,180,41,0.1);color:var(--wow-gold);padding:2px 6px;border-radius:3px;">${charB.display_name}</div>`;
        } else {
          boxStyle = 'background:var(--wow-bg);border:1px solid var(--wow-border);opacity:0.4;filter:grayscale(1);';
          textStyle = 'color:var(--wow-muted);';
        }
      } else {
        if (hasA) {
          boxStyle = 'background:var(--wow-surface2);border:1px solid rgba(34,197,94,0.3);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-green);">✓ Owned</div>`;
        } else {
          boxStyle = 'background:var(--wow-bg);border:1px solid var(--wow-border);opacity:0.4;filter:grayscale(1);';
          textStyle = 'color:var(--wow-muted);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);">Missing</div>`;
        }
      }

      const whType = colView === 'mounts' ? 'mount' : 'npc';
      const whLink = `https://www.wowhead.com/${whType}=${item.id}`;

      gridItems.push(html`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:4px;transition:all 0.15s;${boxStyle}">
          <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;">
            <a href="${whLink}" target="_blank" style="${textStyle}text-decoration:none;" data-wowhead="${whType}=${item.id}">${item.name}</a>
          </div>
          <div style="flex-shrink:0;">${badgeHtml}</div>
        </div>
      `);
    });

    return html`
      <div class="layout-full">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:16px;">
            <button class="btn btn-ghost" onClick=${() => setColView(null)}>← Back</button>
            <div style="font-family:var(--wow-display);font-size:24px;font-weight:700;color:var(--wow-text);letter-spacing:1px;">
              ${colView === 'mounts' ? '🐎 Mounts' : '🐈 Pets'} Database
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <input type="text" placeholder="Search..." class="admin-input" style="width:200px;" value=${colSearch} onInput=${e => setColSearch(e.target.value.toLowerCase())} />
            <select class="admin-input" style="width:220px;cursor:pointer;" value=${colCompareIdx} onChange=${e => setColCompareIdx(parseInt(e.target.value, 10))}>
              <option value="-1">-- Compare With Roster --</option>
              ${characters.map((ch, i) => i !== activeChar && charCacheRef.current[`${ch.region}-${ch.realm}-${ch.name}`]?._bnet ? html`<option value=${i}>${ch.display_name} (${ch.realm})</option>` : null)}
            </select>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;font-family:var(--wow-mono);font-size:12px;color:var(--wow-muted);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--wow-border);">
          ${charB ? html`
            <div style="color:var(--wow-text);">Total in Game: <span style="color:var(--wow-text);font-weight:700;">${masterList.length.toLocaleString()}</span></div>
            <div>|</div>
            <div style="color:var(--wow-green);">${charA.display_name}: <span style="font-weight:700;">${countA.toLocaleString()}</span></div>
            <div>|</div>
            <div style="color:var(--wow-gold);">${charB.display_name}: <span style="font-weight:700;">${countB.toLocaleString()}</span></div>
            <div>|</div>
            <div style="color:var(--wow-accent);">Shared: <span style="font-weight:700;">${countBoth.toLocaleString()}</span></div>
            <div style="margin-left:auto;">Hover names for 3D models & info</div>
          ` : html`
            <div style="color:var(--wow-text);">Total in Game: <span style="color:var(--wow-text);font-weight:700;">${masterList.length.toLocaleString()}</span></div>
            <div>|</div>
            <div style="color:var(--wow-green);">Owned: <span style="font-weight:700;">${countA.toLocaleString()}</span> (${masterList.length ? Math.round((countA / masterList.length) * 100) : 0}%)</div>
            <div style="margin-left:auto;">Hover names for 3D models & info</div>
          `}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(min(100%, 280px), 1fr));gap:8px;max-height:calc(100vh - 240px);overflow-y:auto;padding-right:10px;">
          ${gridItems.length > 0 ? gridItems : html`<div class="empty" style="grid-column: 1 / -1;margin-top:40px;">No results match your search.</div>`}
        </div>
      </div>
    `;
  };

  if (colView) return renderCollectionsView();

  const renderCollections = () => {
    if (bnet && (bnet.mounts || bnet.pets)) {
      const mounts = bnet.mounts?.mounts?.length || 0;
      const pets = bnet.pets?.pets?.length || 0;
      return html`
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%, 120px), 1fr));gap:10px;">
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:12px;text-align:center;position:relative;">
            <button class="btn btn-ghost" style="position:absolute;top:6px;right:6px;font-size:9px;padding:3px 6px;" onClick=${() => openCollection('mounts')}>Browse</button>
            <div style="font-size:24px;margin-bottom:4px;">🐎</div>
            <div style="font-family:var(--wow-mono);font-size:24px;font-weight:700;color:var(--wow-text);line-height:1;">${mounts.toLocaleString()}</div>
            <div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:4px;">MOUNTS</div>
          </div>
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:12px;text-align:center;position:relative;">
            <button class="btn btn-ghost" style="position:absolute;top:6px;right:6px;font-size:9px;padding:3px 6px;" onClick=${() => openCollection('pets')}>Browse</button>
            <div style="font-size:24px;margin-bottom:4px;">🐈</div>
            <div style="font-family:var(--wow-mono);font-size:24px;font-weight:700;color:var(--wow-text);line-height:1;">${pets.toLocaleString()}</div>
            <div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:4px;">PETS</div>
          </div>
        </div>`;
    }
    return html`<div class="empty" style="padding:16px;">Collections data not available.</div>`;
  };

  const renderAchv = () => {
    const achvPoints = bnet?.profile?.achievement_points || c.achievement_points || 0;
    let recentAchvHtml = '';

    if (bnet && bnet.achievements?.recent_events?.length > 0) {
      const charAchvs = bnet.achievements.recent_events.slice(0, 3);
      recentAchvHtml = html`<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
        ${charAchvs.map(e => {
          const diffMs = Date.now() - e.timestamp;
          const diffDays = Math.floor(diffMs / 86400000);
          const timeStr = diffDays > 0 ? `${diffDays}d ago` : 'Today';
          return html`
            <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;">
              <div style="font-size:14px;flex-shrink:0;">🏅</div>
              <div style="flex:1;min-width:0;">
                <div style="font-family:var(--wow-display);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  <a href="https://www.wowhead.com/achievement=${e.achievement.id}" target="_blank" style="color:var(--wow-gold);text-decoration:none;" data-wowhead="achievement=${e.achievement.id}">${e.achievement.name}</a>
                </div>
              </div>
              <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${timeStr}</div>
            </div>`;
        })}
      </div>`;
    } else { recentAchvHtml = html`<div class="empty" style="margin-top:10px;">No recent achievements found.</div>`; }

    return html`
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="width:48px;height:48px;background:var(--wow-surface2);border:1px solid var(--wow-gold);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 10px rgba(240,180,41,0.2);">🏆</div>
        <div>
          <div style="font-family:var(--wow-mono);font-size:24px;font-weight:700;color:var(--wow-gold);line-height:1;">${achvPoints.toLocaleString()}</div>
          <div style="font-size:10px;color:var(--wow-muted);letter-spacing:2px;margin-top:2px;">ACHIEVEMENT POINTS</div>
        </div>
      </div>
      ${recentAchvHtml}`;
  };

  const renderProfessions = () => {
    if (bnet && bnet.professions) {
      const primaries = bnet.professions.primaries || [];
      const secondaries = bnet.professions.secondaries || [];
      const allProfs = [...primaries, ...secondaries];

      if (allProfs.length > 0) {
        const iconMap = {
          'Mining': '⛏️', 'Blacksmithing': '⚒️', 'Herbalism': '🌿', 'Alchemy': '🧪',
          'Skinning': '🔪', 'Leatherworking': '🧵', 'Tailoring': '🪡', 'Engineering': '⚙️',
          'Enchanting': '✨', 'Jewelcrafting': '💎', 'Inscription': '📜', 'Cooking': '🍲',
          'Fishing': '🎣', 'Archaeology': '🏺'
        };

        const expandedProfData = expandedProf ? allProfs.find(p => p.profession?.name === expandedProf) : null;
        const filteredRecipes = (() => {
          if (!expandedProfData) return [];
          const q = profRecipeSearch.trim().toLowerCase();
          return (expandedProfData.tiers || []).map(t => ({
            tierName: t.tier?.name || '',
            recipes: (t.known_recipes || []).filter(r => !q || r.name.toLowerCase().includes(q))
          })).filter(t => t.recipes.length > 0);
        })();
        const totalKnown = expandedProfData ? (expandedProfData.tiers || []).reduce((n, t) => n + (t.known_recipes?.length || 0), 0) : 0;

        return html`
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%, 160px), 1fr));gap:10px;">
            ${allProfs.map(p => {
              const profName = p.profession?.name || 'Unknown';
              let tier = p.tiers?.[0] || {};
              p.tiers?.forEach(t => { if ((t.skill_points||0) > (tier.skill_points||0)) tier = t; });

              const skill = tier.skill_points || 0;
              const maxSkill = tier.max_skill_points || 100;
              const profPct = maxSkill > 0 ? Math.min(100, Math.round((skill/maxSkill)*100)) : 0;
              const recipeCount = (p.tiers || []).reduce((n, t) => n + (t.known_recipes?.length || 0), 0);
              const isExpanded = expandedProf === profName;

              let icon = '🛠️';
              for (let key in iconMap) if (profName.includes(key)) icon = iconMap[key];
              const cleanName = profName.replace(/^(Khaz Algar |Dragon Isles |Shadowlands |Kul Tiran |Zandalari )/i, '');

              return html`
                <div style="background:var(--wow-surface2);border:1px solid ${isExpanded ? 'var(--wow-gold)' : 'var(--wow-border)'};border-radius:4px;padding:10px;cursor:${recipeCount > 0 ? 'pointer' : 'default'};"
                     onClick=${() => recipeCount > 0 && (isExpanded ? setExpandedProf(null) : (setExpandedProf(profName), setProfRecipeSearch('')))}>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <div style="width:24px;height:24px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;">${icon}</div>
                    <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;" title="${profName}">${cleanName}</div>
                    ${recipeCount > 0 ? html`<span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${recipeCount}</span>` : ''}
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);margin-bottom:4px;">
                    <span>Skill</span><span style="color:${profPct===100?'var(--wow-green)':'var(--wow-gold)'};">${skill} / ${maxSkill}</span>
                  </div>
                  <div style="height:6px;background:var(--wow-bg);border-radius:3px;overflow:hidden;"><div style="height:100%;background:${profPct===100?'var(--wow-green)':'var(--wow-gold)'};width:${profPct}%;"></div></div>
                </div>`;
            })}
          </div>
          ${expandedProfData ? html`
            <div style="margin-top:12px;background:var(--wow-surface2);border:1px solid var(--wow-gold);border-radius:4px;padding:12px;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
                <div style="font-family:var(--wow-display);font-size:13px;font-weight:600;flex:1;min-width:120px;">${expandedProf} <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);font-weight:400;">${totalKnown} recipes</span></div>
                <input
                  type="text"
                  placeholder="Search recipes..."
                  value=${profRecipeSearch}
                  onInput=${e => setProfRecipeSearch(e.target.value)}
                  onClick=${e => e.stopPropagation()}
                  style="background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;padding:4px 8px;font-size:11px;color:var(--wow-text);flex:1;max-width:160px;min-width:80px;font-family:var(--wow-mono);"
                />
                <button onClick=${e => { e.stopPropagation(); setExpandedProf(null); }} style="background:none;border:none;color:var(--wow-muted);cursor:pointer;font-size:14px;padding:0 4px;">✕</button>
              </div>
              ${filteredRecipes.length === 0
                ? html`<div style="font-size:12px;color:var(--wow-muted);font-family:var(--wow-mono);">No recipes match.</div>`
                : filteredRecipes.map(({ tierName, recipes }) => html`
                  <div style="margin-bottom:10px;">
                    <div style="font-size:10px;color:var(--wow-muted);letter-spacing:1px;font-family:var(--wow-mono);margin-bottom:6px;text-transform:uppercase;">${tierName}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px;">
                      ${recipes.map(r => html`
                        <a href="https://www.wowhead.com/spell=${r.id}" target="_blank" rel="noopener"
                           style="font-size:11px;font-family:var(--wow-mono);color:var(--wow-text);background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;padding:2px 6px;text-decoration:none;white-space:nowrap;"
                           onMouseover=${e => e.target.style.borderColor='var(--wow-gold)'}
                           onMouseout=${e => e.target.style.borderColor='var(--wow-border2)'}
                           onClick=${e => e.stopPropagation()}>
                          ${r.name}
                        </a>`)}
                    </div>
                  </div>`)}
            </div>
          ` : ''}`;
      }
      return html`<div class="empty" style="padding:10px;">No professions learned.</div>`;
    } 
    return html`<div class="empty" style="padding:16px;">Profession data unavailable.</div>`;
  };

  const renderHousing = () => html`
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%, 160px), 1fr));gap:10px;">
      <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:24px;height:24px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;">🏕️</div>
          <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;">Estate Level</div>
        </div>
        <div style="font-family:var(--wow-mono);font-size:20px;font-weight:700;color:var(--wow-green);margin-bottom:2px;">Tier 2</div>
        <div style="font-size:10px;color:var(--wow-muted);">Cozy Cabin</div>
      </div>
      <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <div style="width:24px;height:24px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;">🪵</div>
          <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;">Resources</div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;color:var(--wow-muted);">Timber</span>
          <span style="font-family:var(--wow-mono);font-size:13px;font-weight:700;color:var(--wow-gold);">1,250</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
          <span style="font-size:10px;color:var(--wow-muted);">Stone</span>
          <span style="font-family:var(--wow-mono);font-size:13px;font-weight:700;color:var(--wow-text);">420</span>
        </div>
      </div>
    </div>
  `;

  const renderRenown = () => {
    if (bnet && bnet.reputations) {
      const reps = bnet.reputations.reputations || [];
      const twwNames = ['Council of Dornogal', 'The Assembly of the Deeps', 'Hallowfall Arathi', 'The Severed Threads'];
      const twwReps = reps.filter(r => twwNames.includes(r.faction?.name));
      
      if (twwReps.length > 0) {
        return html`
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${twwReps.map(r => {
              const name = r.faction.name;
              const standingName = r.standing?.name || '';
              const match = standingName.match(/Renown (\d+)/i);
              const renownLevel = match ? match[1] : (r.standing?.tier || 0);
              const val = r.standing?.value || 0;
              const max = r.standing?.max || 2500;
              const repPct = max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 100;
              
              return html`
              <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:8px 10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                  <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;" title="${standingName}">${name}</span>
                  <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);">Renown ${renownLevel}</span>
                </div>
                <div style="height:4px;background:var(--wow-bg);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;background:var(--wow-gold);width:${repPct}%"></div>
                </div>
              </div>`;
            })}
          </div>`;
      }
      return html`<div class="empty">No Khaz Algar renown data found yet.</div>`;
    } 
    return html`<div class="empty">Reputation data unavailable.</div>`;
  };

  const renderSpec = () => {
    const specData = bnet.specializations;
    const activeSpecName = specData?.active_specialization?.name;
    const heroTalent = specData?.active_hero_talent?.hero_talent_tree?.name;
    if (!activeSpecName) return html`<div class="empty">Specialization data unavailable.</div>`;
    const specSpecs = specData.specializations || [];
    const activeSpecObj = specSpecs.find(s => s.specialization?.id === specData.active_specialization?.id) || specSpecs[0];
    const glyphs = activeSpecObj?.glyphs?.map(g => g.glyph?.name).filter(Boolean) || [];
    const specColorMap = { 'Blood':'var(--wow-red)','Frost':'var(--wow-accent)','Unholy':'var(--wow-green)','Havoc':'var(--wow-danger)','Vengeance':'#a335ee','Balance':'var(--wow-gold)','Feral':'var(--wow-warn)','Guardian':'var(--wow-warn)','Restoration':'var(--wow-green)','Beast Mastery':'var(--wow-warn)','Marksmanship':'var(--wow-accent)','Survival':'var(--wow-green)','Arcane':'var(--wow-accent)','Fire':'var(--wow-danger)','Brewmaster':'var(--wow-warn)','Mistweaver':'var(--wow-green)','Windwalker':'var(--wow-red)','Retribution':'var(--wow-gold)','Shadow':'#a335ee','Assassination':'var(--wow-danger)','Outlaw':'var(--wow-warn)','Subtlety':'#a335ee','Elemental':'var(--wow-accent)','Enhancement':'var(--wow-warn)','Affliction':'#a335ee','Demonology':'var(--wow-danger)','Destruction':'var(--wow-danger)','Arms':'var(--wow-danger)','Fury':'var(--wow-danger)','Devastation':'var(--wow-danger)','Preservation':'var(--wow-green)','Augmentation':'var(--wow-warn)' };
    const specColor = specColorMap[activeSpecName] || 'var(--wow-accent)';
    return html`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
        <div style="width:42px;height:42px;background:var(--wow-surface2);border:2px solid ${specColor};border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 10px ${specColor}40;flex-shrink:0;">⚔</div>
        <div>
          <div style="font-family:var(--wow-display);font-size:16px;font-weight:700;color:${specColor};">${activeSpecName}</div>
          <div style="font-size:10px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;">${character.class || ''}</div>
        </div>
      </div>
      ${heroTalent ? html`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(135deg,rgba(163,82,238,0.1),rgba(0,200,255,0.05));border:1px solid rgba(163,82,238,0.3);border-radius:4px;margin-bottom:8px;">
          <span style="font-size:14px;">✨</span>
          <div>
            <div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;text-transform:uppercase;">Hero Talent</div>
            <div style="font-family:var(--wow-display);font-size:13px;font-weight:600;color:#a335ee;">${heroTalent}</div>
          </div>
        </div>
      ` : ''}
      ${glyphs.length ? html`
        <div style="margin-top:6px;">
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Glyphs</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${glyphs.map(g => html`<span style="font-size:10px;padding:2px 6px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:3px;color:var(--wow-muted);">${g}</span>`)}
          </div>
        </div>
      ` : ''}
    `;
  };

  const zones = getZoneProgress(lvl);
  const dungeons = getDungeonUnlocks(lvl);

  return html`
    <div class="wow-layout">
      <div class="col-main">
        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Character Level</div></div>
          <div class="card-body">
            <div class="level-hero">
              <div class="level-big">${lvl}</div>
              <div class="level-info">
                <div class="level-label">Character Level</div>
                <div class="level-bar-wrap"><div class="level-bar-fill" style="width:${pct}%"></div></div>
                <div class="level-xp">${isMax ? 'MAX LEVEL — Ready for endgame' : `${lvl} / ${maxLvl}`}</div>
                ${isMax ? html`<div class="level-max-note" style="margin-top:8px;color:var(--wow-green);">✓ All content unlocked</div>` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Collections</div></div>
          <div class="card-body">${renderCollections()}</div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Character Achievements</div></div>
          <div class="card-body">${renderAchv()}</div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Professions</div></div>
          <div class="card-body">${renderProfessions()}</div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Player Estate</div></div>
          <div class="card-body">${renderHousing()}</div>
        </div>
      </div>
      
      <div class="col-side">
        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Specialization</div></div>
          <div class="card-body">${renderSpec()}</div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Khaz Algar Renown</div></div>
          <div class="card-body">${renderRenown()}</div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Campaign Progress</div></div>
          <div class="card-body">
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${zones.map(z => html`
                <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--wow-surface2);border:1px solid ${z.done?'rgba(34,197,94,0.3)':'var(--wow-border)'};border-radius:4px;">
                  <div style="width:8px;height:8px;border-radius:50%;background:${z.done?'var(--wow-green)':'var(--wow-border2)'};flex-shrink:0;${z.done?'box-shadow:0 0 4px var(--wow-green)':''}"></div>
                  <div style="flex:1;font-family:var(--wow-display);font-size:13px;font-weight:600;color:${z.done?'var(--wow-text)':'var(--wow-muted)'};">${z.name}</div>
                  <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">Lvl ${z.min}${z.max?'–'+z.max:'+'}  </div>
                </div>
              `)}
            </div>
          </div>
        </div>

        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Dungeon Unlock Status</div></div>
          <div class="card-body">
            <div class="dungeon-list">
              ${dungeons.map(d => html`
                <div class="dungeon-row">
                  <div class="dungeon-icon">${d.icon}</div>
                  <div class="dungeon-name">${d.name}</div>
                  <div class="dungeon-status ${d.status}">${d.label}</div>
                </div>
              `)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function WowPVE({ character, charCacheRef, dataTick }) {
  if (!character) return null;
  const cacheKey = `${character.region}-${character.realm}-${character.name}`;
  const c = charCacheRef.current[cacheKey] || {};
  const bnet = c._bnet || {};

  const pad = n => String(n).padStart(2,'0');
  const fmtTime = ms => { const t = Math.floor(ms/1000); return `${Math.floor(t/60)}:${pad(t%60)}`; };
  const keyClass = lvl => lvl >= 15 ? 'high' : lvl >= 10 ? 'mid' : 'low';
  
  const renderScore = () => {
    const season = c.mythic_plus_scores_by_season?.[0];
    const scores = season?.scores ?? {};
    const prevScores = c.previous_mythic_plus_scores;
    const prev = prevScores?.[0];
    const prevAll = prev?.scores?.all ? Math.round(prev.scores.all) : null;
    const prevLabel = prev?.season ? prev.season.replace(/^season-/, '').replace(/-/g,' ').toUpperCase() : '';
    return html`
      <div class="score-display">
        <div class="score-big">${scores.all ? Math.round(scores.all).toLocaleString() : '—'}</div>
        <div class="score-lbl">MYTHIC+ SCORE</div>
        <div class="score-season">${season?.season?.replace('season-','Season ') ?? ''}</div>
      </div>
      <div class="score-roles">
        <div class="role-box"><div class="role-val" style="color:var(--wow-red)">${scores.dps ? Math.round(scores.dps) : '—'}</div><div class="role-lbl">DPS</div></div>
        <div class="role-box"><div class="role-val" style="color:var(--wow-accent)">${scores.tank ? Math.round(scores.tank) : '—'}</div><div class="role-lbl">TANK</div></div>
        <div class="role-box"><div class="role-val" style="color:var(--wow-green)">${scores.healer ? Math.round(scores.healer) : '—'}</div><div class="role-lbl">HEALER</div></div>
      </div>
      ${prevAll ? html`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--wow-border);text-align:center;"><div style="font-family:var(--wow-mono);font-size:13px;color:var(--wow-muted);">${prevAll}</div><div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:2px;">PREV: ${prevLabel}</div></div>` : ''}
    `;
  };

  const renderEquipment = () => {
    const ilvl = bnet.profile?.equipped_item_level || c.gear?.item_level_equipped || 0;
    if (!bnet.equipment?.equipped_items?.length) {
      return html`
        <div class="empty">Gear data not available.</div>
      `;
    }

    const slotOrder = ['HEAD','NECK','SHOULDER','BACK','CHEST','WRIST','HANDS','WAIST','LEGS','FEET','FINGER_1','FINGER_2','TRINKET_1','TRINKET_2','MAIN_HAND','OFF_HAND'];
    const slotIcons = { HEAD:'🪖', NECK:'📿', SHOULDER:'🛡️', BACK:'🧣', CHEST:'👕', WRIST:'⌚', HANDS:'🧤', WAIST:'🪢', LEGS:'👖', FEET:'👢', FINGER_1:'💍', FINGER_2:'💍', TRINKET_1:'🔮', TRINKET_2:'🔮', MAIN_HAND:'⚔️', OFF_HAND:'🗡️' };
    const slotNames = { HEAD:'Head', NECK:'Neck', SHOULDER:'Shoulders', BACK:'Cloak', CHEST:'Chest', WRIST:'Bracers', HANDS:'Gloves', WAIST:'Belt', LEGS:'Legs', FEET:'Boots', FINGER_1:'Ring 1', FINGER_2:'Ring 2', TRINKET_1:'Trinket 1', TRINKET_2:'Trinket 2', MAIN_HAND:'Weapon', OFF_HAND:'Off Hand' };
    const qualityColor = { POOR: '#9d9d9d', COMMON: '#ffffff', UNCOMMON: '#1eff00', RARE: '#0070dd', EPIC: '#a335ee', LEGENDARY: '#ff8000', ARTIFACT: '#e6cc80' };
    const slotMap = {};
    bnet.equipment.equipped_items.forEach(item => { if (item.slot?.type) slotMap[item.slot.type] = item; });

    return html`
      <div style="text-align:center;padding:0 0 14px;">
        <div style="font-family:var(--wow-mono);font-size:42px;font-weight:700;color:var(--wow-gold);line-height:1;">${ilvl || '—'}</div>
        <div style="font-size:10px;color:var(--wow-muted);letter-spacing:3px;margin-top:4px;">EQUIPPED ILVL</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%, 160px),1fr));gap:6px;">
        ${slotOrder.map(slot => {
          const item = slotMap[slot];
          const i_ilvl = item?.level?.value;
          const qColor = qualityColor[item?.quality?.type ?? 'COMMON'] ?? '#ffffff';
          return html`
            <div style="background:var(--wow-surface2);border:1px solid ${item?'rgba(163,82,238,0.2)':'var(--wow-border)'};border-radius:4px;padding:7px 10px;display:flex;align-items:center;gap:8px;transition:border-color 0.15s;" onMouseOver=${e=>e.currentTarget.style.borderColor=qColor} onMouseOut=${e=>e.currentTarget.style.borderColor=item?'rgba(163,82,238,0.2)':'var(--wow-border)'}>
              <div style="font-size:16px;flex-shrink:0;">${slotIcons[slot]}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;">${slotNames[slot]?.toUpperCase()}</div>
                <div style="font-family:var(--wow-display);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  <a href=${item ? `https://www.wowhead.com/item=${item.item.id}` : null} data-wowhead=${item ? `item=${item.item.id}&ilvl=${i_ilvl}` : null} target="_blank" style="color:${item ? qColor : 'var(--wow-border2)'};text-decoration:none;">${item?.name ?? 'Empty'}</a>
                </div>
              </div>
              <div style="font-family:var(--wow-mono);font-size:13px;font-weight:700;color:${i_ilvl ? 'var(--wow-gold)' : 'var(--wow-border2)'};flex-shrink:0;">${i_ilvl ?? '—'}</div>
            </div>
          `;
        })}
      </div>
    `;
  };

  const renderStats = () => {
    if (!bnet.statistics) return html`<div class="empty">Combat stats unavailable.</div>`;
    const s = bnet.statistics;
    const primary = Math.max(s.strength?.effective||0, s.agility?.effective||0, s.intellect?.effective||0);
    const primaryLabel = (s.strength?.effective||0) === primary ? 'Strength' : ((s.agility?.effective||0) === primary ? 'Agility' : 'Intellect');
    
    return html`
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--wow-border);">
        <div>
          <div style="font-family:var(--wow-mono);font-size:20px;font-weight:700;color:var(--wow-green);">${s.health ? s.health.toLocaleString() : '—'}</div>
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;text-transform:uppercase;">HEALTH</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:var(--wow-mono);font-size:20px;font-weight:700;color:var(--wow-accent);">${s.power || '—'}</div>
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;text-transform:uppercase;">${s.power_type?.name?.toUpperCase() || 'POWER'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%, 120px), 1fr));gap:12px;">
        <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 10px;">
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;">${primaryLabel}</div>
          <div style="font-family:var(--wow-mono);font-size:14px;font-weight:700;">${primary.toLocaleString()}</div>
        </div>
        <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 10px;">
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;">Mastery</div>
          <div style="font-family:var(--wow-mono);font-size:14px;font-weight:700;color:var(--wow-gold);">${s.mastery?.value ? s.mastery.value.toFixed(1)+'%' : '—'}</div>
        </div>
        <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 10px;">
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;">Haste</div>
          <div style="font-family:var(--wow-mono);font-size:14px;font-weight:700;color:var(--wow-gold);">${s.melee_haste?.value ? s.melee_haste.value.toFixed(1)+'%' : '—'}</div>
        </div>
        <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 10px;">
          <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:2px;">Critical Strike</div>
          <div style="font-family:var(--wow-mono);font-size:14px;font-weight:700;color:var(--wow-gold);">${s.melee_crit?.value ? s.melee_crit.value.toFixed(1)+'%' : '—'}</div>
        </div>
        <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 10px;grid-column:1/-1;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;text-transform:uppercase;">Versatility</span>
            <span style="font-family:var(--wow-mono);font-size:14px;font-weight:700;color:var(--wow-gold);">${s.versatility_damage_done_bonus ? s.versatility_damage_done_bonus.toFixed(1)+'%' : '—'}</span>
          </div>
        </div>
      </div>
    `;
  };

  const renderRaid = () => {
    const prog = c.raid_progression ?? {};
    const achieveMeta = c.raid_achievement_meta || {};
    const raids = Object.entries(prog).slice(-2).reverse();
    if (!raids.length) return html`<div class="empty">No raid data</div>`;
    return raids.map(([key, data]) => {
      const name = key.replace(/-/g,' ').replace(/\b\w/g, l => l.toUpperCase());
      const total = data.total_bosses;
      let diff = 'n', killed = data.normal_bosses_killed, label = `${killed}/${total} Normal`, cls = 'diff-n';
      if (data.mythic_bosses_killed > 0) { diff = 'm'; killed = data.mythic_bosses_killed; label = `${killed}/${total} Mythic`; cls = 'diff-m'; }
      else if (data.heroic_bosses_killed > 0) { diff = 'h'; killed = data.heroic_bosses_killed; label = `${killed}/${total} Heroic`; cls = 'diff-h'; }
      const meta = achieveMeta[key] || {};

      return html`
        <div style="margin-bottom:14px;">
          <div class="raid-header">
            <div class="raid-name">${name}</div>
            <span class="diff-pill ${cls}">${label}</span>
            ${meta.has_aotc ? html`<span title="Ahead of the Curve" style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(0,200,255,0.2);border:1px solid var(--wow-accent);color:var(--wow-accent);font-weight:700;margin-left:4px;">AotC</span>` : ''}
            ${meta.has_ce ? html`<span title="Cutting Edge" style="font-size:10px;padding:1px 5px;border-radius:3px;background:linear-gradient(135deg,#a335ee,#ff8000);color:#fff;font-weight:700;margin-left:4px;">CE</span>` : ''}
          </div>
          <div class="boss-grid">
            ${Array.from({length:total}).map((_,i) => html`
              <div class="boss-pip ${i < killed ? 'killed-'+diff : ''}">
                <div class="boss-dot ${i < killed ? diff : 'x'}"></div>
                <div class="boss-name">Boss ${i+1}</div>
              </div>
            `)}
          </div>
        </div>
      `;
    });
  };

  const renderRuns = (runs) => {
    if (!runs?.length) return html`<div class="empty">No runs found</div>`;
    return html`<div class="run-list">
      ${runs.map(r => {
        const timed = r.num_keystone_upgrades > 0;
        return html`
          <div class="run-row">
            <div class="run-key ${keyClass(r.mythic_level)}">+${r.mythic_level}</div>
            <div class="run-dungeon"><div class="run-dname">${r.dungeon}</div>${r.par_time_ms && html`<div class="run-dshort">par ${fmtTime(r.par_time_ms)}</div>`}</div>
            <div class="run-time ${timed?'timed':'depleted'}">${fmtTime(r.clear_time_ms)} ${timed?'✓':'✗'}</div>
            <div class="run-score">${r.score ? (r.par_time_ms?'+':'') + Math.round(r.score) : ''}</div>
          </div>
        `;
      })}
    </div>`;
  };

  const renderKeystone = () => {
    const kpData = bnet.keystoneProfile;
    const allRuns = kpData?.seasons?.[0]?.best_runs || kpData?.current_period?.best_runs || [];
    if (!allRuns.length) return html`<div class="empty">No keystone data available.</div>`;
    const dungeonBest = {};
    allRuns.forEach(r => {
      const dName = r.dungeon?.name || r.dungeon;
      if (!dungeonBest[dName] || r.keystone_level > dungeonBest[dName].keystone_level) dungeonBest[dName] = r;
    });
    return html`
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${Object.values(dungeonBest).sort((a,b)=>b.keystone_level-a.keystone_level).map(r => {
          const dName = r.dungeon?.name || r.dungeon || 'Unknown';
          const lvl = r.keystone_level;
          const timed = r.is_completed_within_time;
          return html`
            <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;">
              <div class="run-key ${keyClass(lvl)}" style="flex-shrink:0;min-width:34px;text-align:center;">+${lvl}</div>
              <div style="flex:1;font-family:var(--wow-display);font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dName}</div>
              <div style="font-size:13px;color:${timed?'var(--wow-green)':'var(--wow-muted)'};">${timed?'✓':'✗'}</div>
            </div>
          `;
        })}
      </div>
    `;
  };

  const renderWeekly = () => {
    const runs = c.mythic_plus_weekly_highest_level_runs ?? [];
    return html`
      <div style="margin-bottom:12px;">
        <div style="font-family:var(--wow-mono);font-size:9px;letter-spacing:2px;color:var(--wow-muted);margin-bottom:8px;text-transform:uppercase;">Great Vault Slots</div>
        ${[1,4,10].map((n,i) => {
          const done = runs.length >= n;
          const best = runs[n-1];
          return html`
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <div style="width:22px;height:22px;border-radius:3px;border:1px solid ${done?'rgba(34,197,94,0.5)':'var(--wow-border2)'};background:${done?'rgba(34,197,94,0.15)':'var(--wow-bg)'};display:flex;align-items:center;justify-content:center;font-size:12px;">
                ${done?'✓':'·'}
              </div>
              <div style="flex:1;font-family:var(--wow-display);font-size:12px;font-weight:600;color:${done?'var(--wow-text)':'var(--wow-muted)'};">Slot ${i+1} — ${n} key${n>1?'s':''} needed</div>
              <div style="font-family:var(--wow-mono);font-size:11px;color:${done?'var(--wow-gold)':'var(--wow-muted)'};">${done?(best?'+'+best.mythic_level:'✓'):`${runs.length}/${n}`}</div>
            </div>
          `;
        })}
      </div>
      <div style="font-family:var(--wow-mono);font-size:9px;letter-spacing:2px;color:var(--wow-muted);margin-bottom:8px;text-transform:uppercase;">Runs This Week (${runs.length})</div>
      ${runs.length ? runs.map(r => html`
        <div class="weekly-run">
          <div class="wk-key">+${r.mythic_level}</div>
          <div class="wk-name">${r.dungeon}</div>
          <div class="wk-time">${fmtTime(r.clear_time_ms)}</div>
        </div>
      `) : html`<div class="empty">No keys run this week yet</div>`}
    `;
  };

  return html`
    <div class="wow-layout">
      <div class="col-main">
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-accent"></div> Equipped Gear</div></div><div class="card-body">${renderEquipment()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot"></div> Raid Progress</div></div><div class="card-body">${renderRaid()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot"></div> Recent M+ Runs</div></div><div class="card-body" style="padding:10px;">${renderRuns(c.mythic_plus_recent_runs)}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot"></div> Season Best Runs</div></div><div class="card-body" style="padding:10px;">${renderRuns(c.mythic_plus_best_runs)}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-accent"></div> Best Key Per Dungeon</div></div><div class="card-body" style="padding:10px;">${renderKeystone()}</div></div>
      </div>
      <div class="col-side">
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot"></div> Mythic+ Score</div></div><div class="card-body">${renderScore()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-accent"></div> Combat Statistics</div></div><div class="card-body">${renderStats()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-gold"></div> Great Vault Tracker</div></div><div class="card-body">${renderWeekly()}</div></div>
      </div>
    </div>
  `;
}

function WowPVP({ character, charCacheRef, dataTick }) {
  if (!character) return null;
  const cacheKey = `${character.region}-${character.realm}-${character.name}`;
  const c = charCacheRef.current[cacheKey] || {};
  const bnet = c._bnet || {};
  
  const { pvpSum, b2v2, b3v3, bRbg, equipment } = bnet;
  
  const cObj = pvpSum?.conquest ?? pvpSum?.honor_reward_status?.conquest ?? null;
  const conquest = cObj?.value ?? cObj?.earned ?? 0;
  const conquestCap = cObj?.cap ?? cObj?.cap_per_week ?? 1650;
  const pct = conquestCap > 0 ? Math.min(100, Math.round((conquest / conquestCap) * 100)) : 0;
  
  const stats = pvpSum?.pvp_map_statistics ?? [];
  let won = 0, lost = 0, total = 0, winPct = 0;
  if (stats.length) {
    won = stats.reduce((a,s)=>a+(s.match_statistics?.won??0), 0);
    lost = stats.reduce((a,s)=>a+(s.match_statistics?.lost??0), 0);
    total = stats.reduce((a,s)=>a+(s.match_statistics?.played??0), 0);
    winPct = total > 0 ? Math.round((won/total)*100) : 0;
  }
  
  const renderPvpGear = () => {
    if (!equipment?.equipped_items?.length) return html`<div class="pvp-note">PVP gear data not available.</div>`;
    
    const pvpSlots = ['HEAD','SHOULDER','CHEST','HANDS','LEGS','FEET','WAIST','WRIST','BACK','NECK','FINGER_1','FINGER_2','TRINKET_1','TRINKET_2','MAIN_HAND','OFF_HAND'];
    const slotNames = { HEAD:'Head',SHOULDER:'Shoulders',CHEST:'Chest',HANDS:'Gloves',LEGS:'Legs',FEET:'Boots',WAIST:'Belt',WRIST:'Bracers',BACK:'Cloak',NECK:'Neck',FINGER_1:'Ring 1',FINGER_2:'Ring 2',TRINKET_1:'Trinket 1',TRINKET_2:'Trinket 2',MAIN_HAND:'Weapon',OFF_HAND:'Off-Hand' };
    const slotMap = {};
    equipment.equipped_items.forEach(item => { if (item.slot?.type) slotMap[item.slot.type] = item; });
    
    const activeSlots = pvpSlots.filter(s=>slotMap[s]);
    const avgIlvl = (equipment.character?.equipped_item_level ?? Math.round(activeSlots.reduce((a,s)=>a+(slotMap[s]?.level?.value??0),0) / activeSlots.length)) || '—';
    const qColors = {POOR:'#9d9d9d',COMMON:'#fff',UNCOMMON:'#1eff00',RARE:'#0070dd',EPIC:'#a335ee',LEGENDARY:'#ff8000'};
    
    return html`
      <div style="text-align:center;padding:8px 0 14px;">
        <div style="font-family:var(--wow-mono);font-size:36px;font-weight:700;color:var(--wow-purple);line-height:1;">${avgIlvl}</div>
        <div style="font-size:9px;color:var(--wow-muted);letter-spacing:3px;margin-top:4px;">AVG EQUIPPED ILVL</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${activeSlots.map(s => {
          const item = slotMap[s];
          const ilvl = item?.level?.value ?? '—';
          const q    = item?.quality?.type ?? 'COMMON';
          return html`
            <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:3px;">
              <div style="font-size:9px;color:var(--wow-muted);letter-spacing:1px;width:72px;flex-shrink:0;">${slotNames[s]?.toUpperCase()}</div>
              <div style="flex:1;font-family:var(--wow-display);font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                <a href="https://www.wowhead.com/item=${item.item.id}" data-wowhead="item=${item.item.id}&ilvl=${ilvl}" target="_blank" style="color:${qColors[q]||'#fff'};text-decoration:none;">${item.name}</a>
              </div>
              <div style="font-family:var(--wow-mono);font-size:12px;font-weight:700;color:var(--wow-purple);flex-shrink:0;">${ilvl}</div>
            </div>
          `;
        })}
      </div>
    `;
  };

  return html`
    <div class="wow-layout">
      <div class="col-main">
        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-purple"></div> PVP Rating</div></div>
          <div class="card-body">
            <div class="pvp-stat-grid">
              <div class="pvp-stat-box"><div class="pvp-stat-val" style=${!b2v2?'font-size:14px;color:var(--wow-muted)':''}>${b2v2?.rating ?? 'Unranked'}</div><div class="pvp-stat-lbl">2v2 Rating</div></div>
              <div class="pvp-stat-box"><div class="pvp-stat-val" style=${!b3v3?'font-size:14px;color:var(--wow-muted)':''}>${b3v3?.rating ?? 'Unranked'}</div><div class="pvp-stat-lbl">3v3 Rating</div></div>
              <div class="pvp-stat-box"><div class="pvp-stat-val" style=${!bRbg?'font-size:14px;color:var(--wow-muted)':''}>${bRbg?.rating ?? 'Unranked'}</div><div class="pvp-stat-lbl">RBG Rating</div></div>
              <div class="pvp-stat-box"><div class="pvp-stat-val">${pvpSum?.honor_level ?? '—'}</div><div class="pvp-stat-lbl">Honor Level</div></div>
            </div>
          </div>
        </div>
        
        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-purple"></div> Conquest Progress</div></div>
          <div class="card-body">
            ${!pvpSum ? html`<div class="empty">Conquest data not available.</div>` : html`
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(min(100%, 80px), 1fr));gap:8px;margin-bottom:8px;">
                <div style="background:var(--wow-bg);border:1px solid rgba(34,197,94,0.2);border-radius:4px;padding:10px;text-align:center;">
                  <div style="font-family:var(--wow-mono);font-size:22px;font-weight:700;color:var(--wow-green);">${won}</div><div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:2px;">WINS</div>
                </div>
                <div style="background:var(--wow-bg);border:1px solid rgba(239,68,68,0.2);border-radius:4px;padding:10px;text-align:center;">
                  <div style="font-family:var(--wow-mono);font-size:22px;font-weight:700;color:var(--wow-red);">${lost}</div><div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:2px;">LOSSES</div>
                </div>
                <div style="background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:4px;padding:10px;text-align:center;">
                  <div style="font-family:var(--wow-mono);font-size:22px;font-weight:700;color:var(--wow-dim);">${total}</div><div style="font-size:9px;color:var(--wow-muted);letter-spacing:2px;margin-top:2px;">PLAYED</div>
                </div>
              </div>
              <div style="background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:4px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                <span style="font-family:var(--wow-display);font-size:12px;font-weight:600;color:var(--wow-muted);">Win Rate</span>
                <span style="font-family:var(--wow-mono);font-size:14px;color:${winPct>=50?'var(--wow-green)':'var(--wow-red)'};">${winPct}%</span>
              </div>
            `}
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">Weekly Conquest</span>
              <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-purple);">${conquest > 0 ? `${conquest.toLocaleString()} / ${conquestCap.toLocaleString()}` : `0 / ${conquestCap.toLocaleString()}`}</span>
            </div>
            <div class="conquest-bar-wrap"><div class="conquest-bar-fill" style="width:${pct}%"></div></div>
          </div>
        </div>
      </div>
      <div class="col-side">
        <div class="wow-card">
          <div class="card-header"><div class="card-title"><div class="dot dot-purple"></div> PVP Gear ilvl</div></div>
          <div class="card-body">${renderPvpGear()}</div>
        </div>
      </div>
    </div>
  `;
}

function WowAccount({ me, characters, onRefresh }) {
  const [busy, setBusy] = useState(null);
  const [bnetStatus, setBnetStatus] = useState(null);
  const [bnetChars, setBnetChars] = useState([]);
  const [bnetLoading, setBnetLoading] = useState(false);
  const [pickerSelections, setPickerSelections] = useState(new Set());
  const [pickerMain, setPickerMain] = useState('');
  const [pickerFilter, setPickerFilter] = useState('active');
  const [pickerSaving, setPickerSaving] = useState(false);

  const loadBnetStatus = useCallback(async () => {
    try {
      const res = await req('/api/wow/account/status');
      if (res.ok) {
        const data = await res.json();
        setBnetStatus(data);
        if (data.linked) {
          setBnetLoading(true);
          const charsRes = await req('/api/wow/bnet/characters');
          if (charsRes.ok) {
            const charsData = await charsRes.json();
            setBnetChars(Array.isArray(charsData) ? charsData : []);
          }
          setBnetLoading(false);
        }
      }
    } catch(e) { setBnetLoading(false); }
  }, []);

  useEffect(() => {
    loadBnetStatus();
  }, [loadBnetStatus]);

  useEffect(() => {
    const mine = characters.filter(c => c.player_name === me.name);
    const sel = new Set(mine.map(c => `${c.name.toLowerCase()}-${(c.realm?.slug || c.realm).toLowerCase()}`));
    setPickerSelections(sel);
    const main = mine.find(c => c.is_main);
    if (main) setPickerMain(`${main.name.toLowerCase()}-${(main.realm?.slug || main.realm).toLowerCase()}`);
  }, [characters, me.name]);

  const myChars = characters.filter(c => c.player_name === me.name);

  const doRemoveChar = async (id) => {
    if (!confirm('Remove this character from your roster?')) return;
    const mine = characters.filter(c => c.player_name === me.name && c.id !== id);
    const selectedChars = mine.map(c => ({ name: c.display_name || c.name, realm: c.realm, class: c.class, isMain: c.is_main }));
    if (selectedChars.length > 0 && !selectedChars.some(c => c.isMain)) selectedChars[0].isMain = true;
    setBusy(id + '-remove');
    try {
      await req('/api/wow/characters/sync', { method: 'POST', body: JSON.stringify({ characters: selectedChars }) });
      if (onRefresh) onRefresh();
    } catch(e) {}
    setBusy(null);
  };

  const doLinkBnet = () => {
    req('/api/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ name: me.name, vpn_ip: '0.0.0.0', version: '1.0.0' })
    }).catch(()=>{});

    const popupUrl = `${API}/auth/battlenet?name=${encodeURIComponent(me.name)}`;
    const popup = window.open(popupUrl, 'bnetauth', 'width=600,height=700');
    const handler = (e) => {
      if (e.data === 'bnet_auth_success') {
        window.removeEventListener('message', handler);
        if (popup) popup.close();
        loadBnetStatus();
        onRefresh && onRefresh();
      }
    };
    window.addEventListener('message', handler);
  };

  const doUnlinkBnet = async () => {
    if (!confirm('Unlink your Battle.net account? Your characters will be removed from the family roster.')) return;
    setBnetStatus(null);
    setBnetChars([]);
    await req('/api/wow/account/unlink', { method: 'POST' });
    if (onRefresh) onRefresh();
    loadBnetStatus();
  };

  const togglePickerChar = (id, checked) => {
    setPickerSelections(prev => {
      const next = new Set(prev);
      if (checked) {
        if (next.size < 5) next.add(id);
      } else {
        next.delete(id);
        if (pickerMain === id) setPickerMain([...next][0] || '');
      }
      if (checked && next.size === 1) setPickerMain(id);
      return next;
    });
  };

  const savePicker = async () => {
    setPickerSaving(true);
    const selectedChars = bnetChars
      .filter(c => pickerSelections.has(`${c.name.toLowerCase()}-${c.realm.slug}`))
      .map(c => {
         const idKey = `${c.name.toLowerCase()}-${c.realm.slug}`;
         return {
           name: c.name,
           realm: c.realm.slug,
           class: c.playable_class.name,
           isMain: idKey === pickerMain
         };
      });
      
    if (selectedChars.length > 0 && !selectedChars.some(c => c.isMain)) {
      selectedChars[0].isMain = true;
    }

    try {
      await req('/api/wow/characters/sync', { method: 'POST', body: JSON.stringify({ characters: selectedChars }) });
      if (onRefresh) onRefresh();
    } catch(e) {}
    setPickerSaving(false);
  };

  return html`
    <div class="layout-full">
      <div class="wow-card" style="max-width: 700px; margin: 0 auto 16px;">
        <div class="card-header">
          <div class="card-title"><div class="dot dot-gold"></div>Battle.net Account</div>
          ${bnetStatus?.linked ? html`<span class="wow-badge badge-free">LINKED</span>` : html`<span class="wow-badge badge-dim">NOT LINKED</span>`}
        </div>
        <div class="card-body">
          ${bnetStatus?.linked ? html`
            <div style="display:flex;align-items:center;gap:14px;padding:4px 0;">
              <div style="font-size:28px;">🔒</div>
              <div>
                <div style="font-family:var(--wow-display);font-size:16px;font-weight:700;color:var(--wow-green);">${bnetStatus.battletag}</div>
                <div style="font-size:11px;color:var(--wow-muted);margin-top:2px;">Battle.net account linked</div>
              </div>
              <div style="margin-left:auto;">
                <button class="wow-btn btn-ghost" style="border-color:var(--wow-red);color:var(--wow-red);font-size:11px;" onClick=${doUnlinkBnet}>Unlink Account</button>
              </div>
            </div>
          ` : html`
            <div style="text-align:center;padding:20px 0;">
              <div style="font-size:36px;margin-bottom:12px;">🔗</div>
              <div style="font-family:var(--wow-display);font-size:15px;font-weight:600;color:var(--wow-muted);margin-bottom:16px;">Link your Battle.net account to auto-discover your characters</div>
              <button class="wow-btn btn-accent" onClick=${doLinkBnet} style="margin-bottom:12px;">⚔️ Link Battle.net Account</button>
              <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">
                Linking the wrong account? <a href="https://account.battle.net/login/logout" target="_blank" style="color:var(--wow-gold);text-decoration:none;">Log out of Battle.net</a> first.
              </div>
            </div>
          `}
        </div>
      </div>

      <div class="wow-card" style="max-width: 700px; margin: 0 auto;">
        <div class="card-header">
          <div class="card-title"><div class="dot"></div>My Characters</div>
        </div>
        <div class="card-body" style="padding:0 14px;">
          ${myChars.length > 0 ? html`
            <div class="char-list">
              ${myChars.map(c => {
                return html`
                  <div class="char-list-row" key=${c.id}>
                    <img class="char-list-avatar" src=${c.thumbnail || 'https://render.worldofwarcraft.com/us/icons/56/inv_misc_questionmark.jpg'} onError=${e => e.target.style.opacity='0.3'} />
                    <div style="flex:1;min-width:0;">
                      <div class="char-list-name">${c.display_name}</div>
                      <div class="char-list-realm">${[c.spec, c.class].filter(Boolean).join(' ')} · ${c.realm}</div>
                    </div>
                    <button class="wow-btn btn-ghost" style="font-size:10px;padding:3px 8px;border-color:var(--wow-red);color:var(--wow-red);" disabled=${busy === c.id + '-remove'} onClick=${() => doRemoveChar(c.id)}>Remove</button>
                  </div>`;
              })}
            </div>
          ` : html`
            <div class="empty" style="padding:16px 0;">No characters in your roster.</div>
          `}
        </div>
      </div>

      ${bnetStatus?.linked ? html`
        <div class="wow-card" style="max-width: 700px; margin: 0 auto;">
          <div class="card-header">
            <div class="card-title"><div class="dot"></div>Battle.net Characters</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="picker-filter ${pickerFilter === 'active' ? 'active' : ''}" onClick=${() => setPickerFilter('active')} style="font-family:var(--wow-mono);font-size:10px;padding:4px 10px;border-radius:3px;border:1px solid ${pickerFilter === 'active' ? 'rgba(0,195,255,0.4)' : 'var(--wow-border2)'};color:${pickerFilter === 'active' ? 'var(--wow-accent)' : 'var(--wow-muted)'};cursor:pointer;letter-spacing:1px;background:${pickerFilter === 'active' ? 'var(--wow-accent-dim)' : 'transparent'};">Max Level</div>
              <div class="picker-filter ${pickerFilter === 'all' ? 'active' : ''}" onClick=${() => setPickerFilter('all')} style="font-family:var(--wow-mono);font-size:10px;padding:4px 10px;border-radius:3px;border:1px solid ${pickerFilter === 'all' ? 'rgba(0,195,255,0.4)' : 'var(--wow-border2)'};color:${pickerFilter === 'all' ? 'var(--wow-accent)' : 'var(--wow-muted)'};cursor:pointer;letter-spacing:1px;background:${pickerFilter === 'all' ? 'var(--wow-accent-dim)' : 'transparent'};">All</div>
            </div>
          </div>
          <div class="card-body" style="max-height:400px;overflow-y:auto;padding:0 14px;">
            ${bnetLoading ? html`<div class="empty">Loading characters from Battle.net...</div>` : html`
              ${bnetChars.length === 0 ? html`<div class="empty">No characters found on this account.</div>` : html`
                ${bnetChars.filter(c => pickerFilter === 'all' || c.level >= 90).map(c => {
                  const idKey = `${c.name.toLowerCase()}-${c.realm.slug}`;
                  const selected = pickerSelections.has(idKey);
                  const isMain = idKey === pickerMain;
                  const disabled = !selected && pickerSelections.size >= 5;
                  return html`
                    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--wow-border);opacity:${disabled ? '0.4' : '1'};">
                      <input type="checkbox" checked=${selected} disabled=${disabled && !selected} onChange=${e => togglePickerChar(idKey, e.target.checked)} style="width:16px;height:16px;accent-color:var(--wow-accent);flex-shrink:0;cursor:pointer;" />
                      <div style="flex:1;">
                        <div style="font-family:var(--wow-display);font-size:14px;font-weight:700;color:${selected ? 'var(--wow-text)' : 'var(--wow-muted)'}">${c.name}</div>
                        <div style="font-size:10px;color:var(--wow-muted);">${c.playable_class.name} · ${c.realm.name} · Lvl ${c.level}</div>
                      </div>
                      ${selected ? html`
                        <button onClick=${() => setPickerMain(idKey)} style="font-family:var(--wow-mono);font-size:10px;padding:3px 8px;border-radius:3px;cursor:pointer;background:${isMain ? 'var(--wow-gold-dim)' : 'transparent'};border:1px solid ${isMain ? 'rgba(240,180,41,0.4)' : 'var(--wow-border2)'};color:${isMain ? 'var(--wow-gold)' : 'var(--wow-muted)'};">
                          ★ ${isMain ? 'Main' : 'Set Main'}
                        </button>
                      ` : ''}
                    </div>
                  `;
                })}
                ${pickerFilter === 'active' && bnetChars.filter(c => c.level < 90).length > 0 ? html`
                  <div style="text-align:center;padding:12px;font-size:11px;color:var(--wow-muted);font-family:var(--wow-mono);">
                    ${bnetChars.filter(c => c.level < 90).length} character(s) hidden (below level 90)
                    <span onClick=${() => setPickerFilter('all')} style="color:var(--wow-accent);cursor:pointer;margin-left:6px;">Show all</span>
                  </div>
                ` : ''}
              `}
            `}
          </div>
          <div class="card-body" style="border-top:1px solid var(--wow-border);background:var(--wow-surface2);display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:11px;color:var(--wow-muted);">
              <span style="font-family:var(--wow-mono);color:var(--wow-text);font-weight:700;margin-right:8px;">${pickerSelections.size} / 5 selected</span>
              (1 Main, up to 4 Alts)
            </div>
            <button class="wow-btn btn-accent" disabled=${pickerSaving || bnetLoading} onClick=${savePicker}>${pickerSaving ? 'Saving...' : 'Save to Roster'}</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function WowCharBar({ characters, activeChar, subTab, onSelect, charCacheRef, dataTick }) {
  if (!['world', 'pve', 'pvp'].includes(subTab)) return null;

  const mains = characters.map((c, i) => ({ ...c, globalIdx: i })).filter(c => c.is_main);
  const alts = characters.map((c, i) => ({ ...c, globalIdx: i })).filter(c => !c.is_main);
  const altGroups = {};
  
  alts.forEach(c => {
    const p = c.player_name || c.display_name;
    if (!altGroups[p]) altGroups[p] = [];
    altGroups[p].push(c);
  });

  const renderChip = (c, isMain) => {
    const chipKey = `${c.region}-${c.realm}-${c.name}`;
    const chipLastSeen = lastSeenStr(charCacheRef.current[chipKey]);
    return html`
    <div class="char-chip ${c.globalIdx === activeChar ? 'active' : ''} ${isMain ? 'is-main' : 'is-alt'}"
         onClick=${() => onSelect(c.globalIdx)}
         title="${c.display_name} · ${c.spec || ''} ${c.class || ''} · ${c.realm}${chipLastSeen ? ` · Last online ${chipLastSeen}` : ''}">
      <img class="chip-avatar" src=${charAvatar(c, charCacheRef)} onError=${e => e.target.style.display='none'} />
      <div class="chip-dot offline"></div>
      ${c.display_name}
      ${isMain ? html`<span style="font-size:9px;color:var(--wow-gold);margin-left:1px;">★</span>` : ''}
    </div>
  `;
  };

  return html`
    <div class="char-bar">
      <div class="char-bar-overview">
        <div class="overview-chip ${activeChar === -1 ? 'active' : ''}" onClick=${() => onSelect(-1)}>👥 Roster</div>
      </div>
      <div class="char-bar-scroll">
        ${mains.length > 0 && html`<div class="char-group"><div class="char-group-inner"><div class="char-group-label">Mains</div><div class="char-group-chips">${mains.map(c => renderChip(c, true))}</div></div></div>`}
        ${Object.entries(altGroups).map(([player, chars]) => html`
          <div class="char-group"><div class="char-group-inner"><div class="char-group-label">${player}</div><div class="char-group-chips">${chars.map(c => renderChip(c, false))}</div></div></div>
        `)}
      </div>
    </div>
  `;
}

// ── Root tab component ───────────────────────────────────────────────────────
export function WowTab({ me }) {
  const [characters, setCharacters] = useState([]);
  const [activeChar, setActiveChar] = useState(-1); // -1 = Overview/Roster
  const [subTab, setSubTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [dataTick, setDataTick] = useState(0); // Forces re-render when background data loads
  const [resetStr, setResetStr] = useState('—');
  const [tokenPrice, setTokenPrice] = useState('Fetching...');

  const charCacheRef = useRef({});
  const affixCacheRef = useRef(null);
  const bnetTokenRef = useRef(null);
  const collectionsRef = useRef({});

  const loadCharacters = () => {
    req('/api/wow/characters')
      .then(res => res.ok ? res.json() : [])
      .then(data => { setCharacters(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    injectWowAssets();
    loadCharacters();
  }, []);

  useEffect(() => {
    if (characters.length === 0) return;
    let mounted = true;
    const loadData = async () => {
      if (!affixCacheRef.current) {
        try {
          const res = await fetch(`${RIO}/mythic-plus/affixes?region=us&locale=en`);
          if (res.ok) affixCacheRef.current = await res.json();
        } catch(e) {}
      }
      
      let didUpdate = false;
      const fields = 'gear,guild,mythic_plus_scores_by_season:current,mythic_plus_recent_runs,mythic_plus_best_runs,mythic_plus_weekly_highest_level_runs,raid_progression';
      
      // Load Blizzard access token for background character data fetching
      let bnetToken = bnetTokenRef.current;
      if (!bnetToken) {
        try {
          const tokenRes = await req('/api/wow/bnet-token', { method: 'POST' });
          if (tokenRes.ok) {
            bnetToken = (await tokenRes.json()).access_token;
            bnetTokenRef.current = bnetToken;
            req(`/api/wow/token-price?access_token=${bnetToken}`).then(r => r.ok && r.json()).then(d => {
              if (d?.price) setTokenPrice(`${Math.floor(d.price / 10000).toLocaleString()}g`);
            });
          }
        } catch(e) {}
      }

      await Promise.all(characters.map(async (c) => {
        const cacheKey = `${c.region}-${c.realm}-${c.name}`;
        try {
          if (!charCacheRef.current[cacheKey] || !charCacheRef.current[cacheKey]._bnet) {
            const res = await req(`/api/wow/profile?region=${c.region||'us'}&realm=${encodeURIComponent(c.realm)}&name=${encodeURIComponent(c.name)}`);
            if (res.ok) {
              const data = await res.json();
              charCacheRef.current[cacheKey] = data.raiderIo || {};
              charCacheRef.current[cacheKey]._bnet = data;
              
              if (data.media?.assets) {
                const avatar = data.media.assets.find(a => a.key === 'avatar');
                if (avatar?.value) c.thumbnail = avatar.value;
              } else if (data.raiderIo?.thumbnail_url) {
                c.thumbnail = data.raiderIo.thumbnail_url;
              }
              didUpdate = true;
            }
          }
        } catch(e) {}
      }));
      if (mounted && didUpdate) setDataTick(t => t + 1);
    };
    loadData();
    return () => mounted = false;
  }, [characters]);

  useEffect(() => {
    // Re-scan for wowhead tooltips after renders
    if (window.$WowheadPower) {
      setTimeout(() => window.$WowheadPower.refreshLinks(), 100);
    }
  });

  useEffect(() => {
    const getNextReset = () => {
      const now = new Date();
      let diff = (2 - now.getUTCDay() + 7) % 7;
      if (diff === 0 && now.getUTCHours() >= 15) diff = 7;
      const r = new Date(now); r.setUTCDate(now.getUTCDate() + diff); r.setUTCHours(15,0,0,0);
      return r;
    };
    const tick = () => {
      const tot = Math.floor((getNextReset() - Date.now())/1000);
      const pad = n => String(n).padStart(2,'0');
      setResetStr(`${pad(Math.floor(tot/86400))}d ${pad(Math.floor((tot%86400)/3600))}h ${pad(Math.floor((tot%3600)/60))}m ${pad(tot%60)}s`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const tabs = [
    { id: 'overview', icon: '🌐', label: 'Overview' },
    { id: 'world',    icon: '🌍', label: 'World' },
    { id: 'pve',      icon: '⚔️', label: 'PVE' },
    { id: 'pvp',      icon: '🏆', label: 'PVP' },
    { id: 'account',  icon: '👤', label: 'My Account' },
  ];

  return html`
    <div class="wow-wrap scroll">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--wow-surface);border-bottom:1px solid var(--wow-border);">
        <div style="font-family:var(--wow-display);font-size:16px;font-weight:700;color:var(--wow-accent);letter-spacing:2px;">GamezNET <span style="color:var(--wow-border2)">/</span> <span style="color:var(--wow-gold);display:inline-flex;align-items:center;gap:6px;"><img src="/WoW_icon.svg" style="height:16px;" alt="WoW"/></span></div>
        <div style="display:flex;align-items:center;gap:12px;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:7px;height:7px;border-radius:50%;background:var(--wow-gold);box-shadow:0 0 6px var(--wow-gold);"></div>
            <span style="color:var(--wow-gold);font-weight:600;">🪙 ${tokenPrice}</span>
          </div>
        </div>
      </div>
      <div class="reset-banner">
        <div class="reset-label">⟳ weekly reset</div>
        <div class="reset-time">${resetStr}</div>
        <div class="reset-divider">|</div>
        <div class="reset-label">tue 15:00 utc · na</div>
      </div>
      <div class="wow-nav-tabs">
        ${tabs.map(t => html`
          <div class="wow-nav-tab ${subTab === t.id ? `active tab-${t.id}`:''}" onClick=${() => {
            setSubTab(t.id);
            if (t.id === 'overview') setActiveChar(-1);
          }}>
            <span class="tab-icon">${t.icon}</span> ${t.label}
          </div>
        `)}
      </div>
      <${WowCharBar} characters=${characters} activeChar=${activeChar} subTab=${subTab} onSelect=${(idx) => { setActiveChar(idx); if (idx === -1) setSubTab('overview'); else if (subTab === 'overview') setSubTab('world'); }} charCacheRef=${charCacheRef} dataTick=${dataTick} />
      ${loading ? html`<div style="padding: 20px; color: var(--wow-muted);">Loading roster...</div>` : html`
        ${subTab === 'overview' && html`<${WowOverview} characters=${characters} charCacheRef=${charCacheRef} affixCacheRef=${affixCacheRef} onSelectChar=${setActiveChar} onSubTab=${setSubTab} dataTick=${dataTick} />`}
        ${subTab === 'world'    && html`<${WowWorld}    characters=${characters} activeChar=${activeChar} charCacheRef=${charCacheRef} bnetTokenRef=${bnetTokenRef} collectionsRef=${collectionsRef} dataTick=${dataTick} />`}
        ${subTab === 'pve'      && html`<${WowPVE}      character=${characters[activeChar]} charCacheRef=${charCacheRef} dataTick=${dataTick} />`}
        ${subTab === 'pvp'      && html`<${WowPVP}      character=${characters[activeChar]} charCacheRef=${charCacheRef} dataTick=${dataTick} />`}
        ${subTab === 'account' && html`<${WowAccount} me=${me} characters=${characters} onRefresh=${loadCharacters} />`}
      `}
    </div>
  `;
}