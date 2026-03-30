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

function charAvatar(c) {
  if (c && c.thumbnail) return c.thumbnail;
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
    }
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
    .wow-wrap .boss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
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
    .wow-wrap .pvp-stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; margin-bottom: 14px; }
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
    
    .wow-wrap .roster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
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

// ── Sub-components ───────────────────────────────────────────────────────────
function WowOverview({ characters, charCacheRef, affixCacheRef, onSelectChar, onSubTab }) {
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

    return html`
      <div class="player-card">
        <div class="player-card-bar ${barKey}"></div>
        <div class="player-main" onClick=${() => { onSelectChar(i); onSubTab('world'); }}>
          <img class="player-main-avatar" src=${charAvatar(c)} onError=${e => e.target.style.opacity='0.3'} />
          <div class="player-main-info">
            <div class="player-name-row">
              <div class="player-name">${playerName}</div>
              <div class="player-online-dot offline"></div>
            </div>
            <div class="char-name">${c.display_name} ${c.is_main ? html`<span style="font-size:12px;color:var(--wow-gold);">★</span>` : ''}</div>
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
                <img src=${charAvatar(ac)} onError=${e => e.target.style.display='none'} />
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

function WowWorld({ characters, activeChar, charCacheRef, bnetTokenRef, collectionsRef }) {
  const [colView, setColView] = useState(null); // 'mounts' | 'pets' | null
  const [colSearch, setColSearch] = useState('');
  const [colCompareIdx, setColCompareIdx] = useState(-1);
  const [loadingCol, setLoadingCol] = useState(false);
  const [colError, setColError] = useState(false);

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
        <div style="font-family:var(--wow-mono);font-size:12px;color:var(--wow-muted);letter-spacing:2px;">FETCHING MASTER BLIZZARD DATABASE...</div>
      </div>
    `;

    if (colError) return html`
      <div class="layout-full">
        <div class="empty" style="margin-top:100px;">Failed to load master database. Check your API key.</div>
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
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;max-height:calc(100vh - 240px);overflow-y:auto;padding-right:10px;">
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
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
        return html`
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            ${allProfs.slice(0, 4).map(p => {
              const profName = p.profession?.name || 'Unknown';
              let tier = p.tiers?.[0] || {};
              p.tiers?.forEach(t => { if ((t.skill_points||0) > (tier.skill_points||0)) tier = t; });
              
              const skill = tier.skill_points || 0;
              const maxSkill = tier.max_skill_points || 100;
              const profPct = maxSkill > 0 ? Math.min(100, Math.round((skill/maxSkill)*100)) : 0;
              
              const iconMap = {
                'Mining': '⛏️', 'Blacksmithing': '⚒️', 'Herbalism': '🌿', 'Alchemy': '🧪',
                'Skinning': '🔪', 'Leatherworking': '🧵', 'Tailoring': '🪡', 'Engineering': '⚙️',
                'Enchanting': '✨', 'Jewelcrafting': '💎', 'Inscription': '📜', 'Cooking': '🍲',
                'Fishing': '🎣', 'Archaeology': '🏺'
              };
              let icon = '🛠️';
              for (let key in iconMap) if (profName.includes(key)) icon = iconMap[key];

              const cleanName = profName.replace(/^(Khaz Algar |Dragon Isles |Shadowlands |Kul Tiran |Zandalari )/i, '');

              return html`
                <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:10px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <div style="width:24px;height:24px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;">${icon}</div>
                    <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${profName}">${cleanName}</div>
                  </div>
                  <div style="display:flex;align-items:center;justify-content:space-between;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);margin-bottom:4px;">
                    <span>Skill</span><span style="color:${profPct===100?'var(--wow-green)':'var(--wow-gold)'};">${skill} / ${maxSkill}</span>
                  </div>
                  <div style="height:6px;background:var(--wow-bg);border-radius:3px;overflow:hidden;"><div style="height:100%;background:${profPct===100?'var(--wow-green)':'var(--wow-gold)'};width:${profPct}%;"></div></div>
                </div>`;
            })}
          </div>`;
      }
      return html`<div class="empty" style="padding:10px;">No professions learned.</div>`;
    } 
    return html`<div class="empty" style="padding:16px;">Profession data unavailable.</div>`;
  };

  const renderHousing = () => html`
    <div class="info-box purple" style="margin-bottom:8px;">Player Estate data will be fully supported once the Blizzard Midnight API endpoints go live.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
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

function WowPVE({ character, charCacheRef }) {
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
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;">
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
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
    const raids = Object.entries(prog).slice(-2).reverse();
    if (!raids.length) return html`<div class="empty">No raid data</div>`;
    return raids.map(([key, data]) => {
      const name = key.replace(/-/g,' ').replace(/\b\w/g, l => l.toUpperCase());
      const total = data.total_bosses;
      let diff = 'n', killed = data.normal_bosses_killed, label = `${killed}/${total} Normal`, cls = 'diff-n';
      if (data.mythic_bosses_killed > 0) { diff = 'm'; killed = data.mythic_bosses_killed; label = `${killed}/${total} Mythic`; cls = 'diff-m'; }
      else if (data.heroic_bosses_killed > 0) { diff = 'h'; killed = data.heroic_bosses_killed; label = `${killed}/${total} Heroic`; cls = 'diff-h'; }
      
      return html`
        <div style="margin-bottom:14px;">
          <div class="raid-header"><div class="raid-name">${name}</div><span class="diff-pill ${cls}">${label}</span></div>
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
      </div>
      <div class="col-side">
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot"></div> Mythic+ Score</div></div><div class="card-body">${renderScore()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-accent"></div> Combat Statistics</div></div><div class="card-body">${renderStats()}</div></div>
        <div class="wow-card"><div class="card-header"><div class="card-title"><div class="dot dot-gold"></div> Great Vault Tracker</div></div><div class="card-body">${renderWeekly()}</div></div>
      </div>
    </div>
  `;
}

function WowPVP({ character, charCacheRef }) {
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
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
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
  const [bnetStatus, setBnetStatus] = useState({ configured: false });
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    req('/api/wow/bnet-status').then(r => r.ok ? r.json() : null).then(d => { if (d) setBnetStatus(d); });
  }, []);

  const myChars = characters.filter(c => c.player_name === me.name);
  const activeAltCount = myChars.filter(c => !c.is_main && c.alt_slot).length;

  const doSetMain = async (id) => {
    setBusy(id + '-main');
    await req(`/api/wow/character/${id}/set-main`, { method: 'POST' });
    setBusy(null);
    onRefresh && onRefresh();
  };
  const doSetAlt = async (id) => {
    const nextSlot = [1,2,3,4].find(s => !myChars.some(c => c.alt_slot === s));
    if (!nextSlot) return;
    setBusy(id + '-alt');
    await req(`/api/wow/character/${id}/set-alt`, { method: 'POST', body: JSON.stringify({ slot: nextSlot }) });
    setBusy(null);
    onRefresh && onRefresh();
  };
  const doClearSlot = async (id) => {
    setBusy(id + '-clear');
    await req(`/api/wow/character/${id}/clear-slot`, { method: 'POST' });
    setBusy(null);
    onRefresh && onRefresh();
  };
  const doLinkBnet = () => {
    const popup = window.open(`/auth/battlenet?name=${encodeURIComponent(me.name)}`, 'bnetauth', 'width=600,height=700');
    const handler = (e) => {
      if (e.data === 'bnet_auth_success') {
        window.removeEventListener('message', handler);
        if (popup) popup.close();
        onRefresh && onRefresh();
      }
    };
    window.addEventListener('message', handler);
  };

  return html`
    <div class="layout-full">
      <div class="wow-card" style="max-width: 700px; margin: 0 auto 16px;">
        <div class="card-header">
          <div class="card-title"><div class="dot dot-gold"></div>Battle.net Account</div>
          <span class="wow-badge ${bnetStatus.configured ? 'badge-free' : 'badge-dim'}">${bnetStatus.configured ? 'API ACTIVE' : 'NOT CONFIGURED'}</span>
        </div>
        <div class="card-body">
          <div class="info-box" style="margin-bottom:12px;">
            ${bnetStatus.configured
              ? 'Blizzard API is active. Link your account below to enable personal character data, collections, and PVP ratings.'
              : 'Blizzard API credentials are not configured. Ask an admin to set up API access to enable full character data.'}
          </div>
          <button class="wow-btn btn-accent" onclick=${doLinkBnet}>⚔️ Link Battle.net Account</button>
        </div>
      </div>

      <div class="wow-card" style="max-width: 700px; margin: 0 auto;">
        <div class="card-header">
          <div class="card-title"><div class="dot"></div>My Characters</div>
          <span style="font-size:10px;color:var(--wow-text-muted);font-family:var(--wow-mono);">1 MAIN · UP TO 4 ALTS</span>
        </div>
        <div class="card-body">
          ${myChars.length > 0 ? html`
            <div class="char-list">
              ${myChars.map(c => {
                const slotLabel = c.is_main ? '★ Main' : (c.alt_slot ? `Alt ${c.alt_slot}` : 'Inactive');
                const slotColor = c.is_main ? 'var(--wow-gold)' : (c.alt_slot ? 'var(--wow-blue)' : 'var(--wow-border)');
                const canAddAlt = !c.is_main && !c.alt_slot && activeAltCount < 4;
                return html`
                  <div class="char-list-row" key=${c.id}>
                    <img class="char-list-avatar" src=${c.thumbnail || 'https://render.worldofwarcraft.com/us/icons/56/inv_misc_questionmark.jpg'} onError=${e => e.target.style.opacity='0.3'} />
                    <div style="flex:1;min-width:0;">
                      <div class="char-list-name">${c.display_name}</div>
                      <div class="char-list-realm">${[c.spec, c.class].filter(Boolean).join(' ')} · ${c.realm}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                      <span style="font-size:9px;font-family:var(--wow-mono);padding:2px 6px;border-radius:3px;border:1px solid ${slotColor};color:${slotColor};">${slotLabel.toUpperCase()}</span>
                      ${!c.is_main && html`<button class="wow-btn btn-ghost" style="font-size:10px;padding:3px 7px;" disabled=${!!busy} onclick=${() => doSetMain(c.id)}>★</button>`}
                      ${canAddAlt && html`<button class="wow-btn btn-ghost" style="font-size:10px;padding:3px 7px;" disabled=${!!busy} onclick=${() => doSetAlt(c.id)}>+ALT</button>`}
                      ${c.alt_slot && html`<button class="wow-btn btn-ghost" style="font-size:10px;padding:3px 7px;color:var(--wow-text-muted);" disabled=${!!busy} onclick=${() => doClearSlot(c.id)}>✕</button>`}
                    </div>
                  </div>`;
              })}
            </div>
          ` : html`
            <div class="empty">No characters assigned to your account. Ask an admin to add your characters, or link your Battle.net account above.</div>
          `}
        </div>
      </div>
    </div>
  `;
}

function WowCharBar({ characters, activeChar, subTab, onSelect }) {
  if (!['world', 'pve', 'pvp'].includes(subTab)) return null;

  const mains = characters.map((c, i) => ({ ...c, globalIdx: i })).filter(c => c.is_main);
  const alts = characters.map((c, i) => ({ ...c, globalIdx: i })).filter(c => !c.is_main);
  const altGroups = {};
  
  alts.forEach(c => {
    const p = c.player_name || c.display_name;
    if (!altGroups[p]) altGroups[p] = [];
    altGroups[p].push(c);
  });

  const renderChip = (c, isMain) => html`
    <div class="char-chip ${c.globalIdx === activeChar ? 'active' : ''} ${isMain ? 'is-main' : 'is-alt'}"
         onClick=${() => onSelect(c.globalIdx)}
         title="${c.display_name} · ${c.spec || ''} ${c.class || ''} · ${c.realm}">
      <img class="chip-avatar" src=${charAvatar(c)} onError=${e => e.target.style.display='none'} />
      <div class="chip-dot offline"></div>
      ${c.display_name}
      ${isMain ? html`<span style="font-size:9px;color:var(--wow-gold);margin-left:1px;">★</span>` : ''}
    </div>
  `;

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

function WowPickerModal({ available, selections, setSelections, mainChar, setMainChar, filter, setFilter, onSave, onClose }) {
  return html`<div>Picker Modal coming soon...</div>`;
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
      
      // Attempt to load Blizzard access token for the 13x background calls
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

      const fetchBnet = async (path, region, namespace) => {
        if (!bnetToken) return null;
        const url = `https://${region}.api.blizzard.com${path}?namespace=${namespace}-${region}&locale=en_US`;
        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${bnetToken}` } });
        if (r.status === 404 || r.status === 403 || !r.ok) return null;
        return r.json();
      };

      await Promise.all(characters.map(async (c, i) => {
        const cacheKey = `${c.region}-${c.realm}-${c.name}`;
        try {
          const safeRealm = c.realm.toLowerCase().replace(/\\s+/g, '-').replace(/'/g, '');
          
          if (!charCacheRef.current[cacheKey]) {
            const res = await fetch(`${RIO}/characters/profile?region=${c.region}&realm=${safeRealm}&name=${encodeURIComponent(c.name)}&fields=${fields}`);
            if (res.ok) { const data = await res.json(); if (!data.error) { charCacheRef.current[cacheKey] = data; didUpdate = true; } }
          }

          if (bnetToken && !charCacheRef.current[cacheKey]?._bnet) {
            const base = `/profile/wow/character/${safeRealm}/${encodeURIComponent(c.name.toLowerCase())}`;
            const [profile, media, equipment, pvpSum, b2v2, b3v3, bRbg, achievements, mounts, pets, professions, reputations, statistics] = await Promise.allSettled([
              fetchBnet(`${base}`, c.region||'us', 'profile'), fetchBnet(`${base}/character-media`, c.region||'us', 'profile'), fetchBnet(`${base}/equipment`, c.region||'us', 'profile'), fetchBnet(`${base}/pvp-summary`, c.region||'us', 'profile'), fetchBnet(`${base}/pvp-bracket/2v2`, c.region||'us', 'profile'), fetchBnet(`${base}/pvp-bracket/3v3`, c.region||'us', 'profile'), fetchBnet(`${base}/pvp-bracket/rbg`, c.region||'us', 'profile'), fetchBnet(`${base}/achievements`, c.region||'us', 'profile'), fetchBnet(`${base}/collections/mounts`, c.region||'us', 'profile'), fetchBnet(`${base}/collections/pets`, c.region||'us', 'profile'), fetchBnet(`${base}/professions`, c.region||'us', 'profile'), fetchBnet(`${base}/reputations`, c.region||'us', 'profile'), fetchBnet(`${base}/statistics`, c.region||'us', 'profile')
            ]);
            if (!charCacheRef.current[cacheKey]) charCacheRef.current[cacheKey] = {};
            charCacheRef.current[cacheKey]._bnet = { profile: profile.value, media: media.value, equipment: equipment.value, pvpSum: pvpSum.value, b2v2: b2v2.value, b3v3: b3v3.value, bRbg: bRbg.value, achievements: achievements.value, mounts: mounts.value, pets: pets.value, professions: professions.value, reputations: reputations.value, statistics: statistics.value };
            
            if (media.value?.assets) {
              const avatar = media.value.assets.find(a => a.key === 'avatar');
              if (avatar && avatar.value !== c.thumbnail) c.thumbnail = avatar.value; // Runtime UI update
            }
            didUpdate = true;
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
        <div style="font-family:var(--wow-display);font-size:16px;font-weight:700;color:var(--wow-accent);letter-spacing:2px;">GamezNET <span style="color:var(--wow-border2)">/</span> <span style="color:var(--wow-gold)">⚔️ WoW</span></div>
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
      <${WowCharBar} characters=${characters} activeChar=${activeChar} subTab=${subTab} onSelect=${(idx) => { setActiveChar(idx); if (idx === -1) setSubTab('overview'); else if (subTab === 'overview') setSubTab('world'); }} />
      ${loading ? html`<div style="padding: 20px; color: var(--wow-muted);">Loading roster...</div>` : html`
        ${subTab === 'overview' && html`<${WowOverview} characters=${characters} charCacheRef=${charCacheRef} affixCacheRef=${affixCacheRef} onSelectChar=${setActiveChar} onSubTab=${setSubTab} />`}
        ${subTab === 'world'    && html`<${WowWorld}    characters=${characters} activeChar=${activeChar} charCacheRef=${charCacheRef} bnetTokenRef=${bnetTokenRef} collectionsRef=${collectionsRef} />`}
        ${subTab === 'pve'      && html`<${WowPVE}      character=${characters[activeChar]} charCacheRef=${charCacheRef} />`}
        ${subTab === 'pvp'      && html`<${WowPVP}      character=${characters[activeChar]} charCacheRef=${charCacheRef} />`}
        ${subTab === 'account' && html`<${WowAccount} me=${me} characters=${characters} onRefresh=${loadCharacters} />`}
      `}
    </div>
  `;
}