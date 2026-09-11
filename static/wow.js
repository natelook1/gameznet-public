import { h } from './vendor/preact.mjs';
import { useState, useEffect, useRef, useCallback } from './vendor/hooks.mjs';
import htm from './vendor/htm.mjs';
const html = htm.bind(h);

// Host configuration. Mobile/CF-Pages are served from a different origin than
// the backend, so they need the absolute URL. The desktop client proxies /api/
// through its local Flask server (which picks VPN-direct vs public per
// connection state), so it MUST use a relative base and MUST supply its own
// token - it stores it under a different localStorage key than mobile does.
const HOST = (typeof window !== 'undefined' && window.GZN_WOW_HOST) || {};

const API = HOST.apiBase != null ? HOST.apiBase : 'https://gameznet.looknet.ca';
const RIO = 'https://raider.io/api/v1';

// Blizzard's official class colours, keyed the way the addon sends them
// (uppercase, no spaces). Used for names, card edges and spec accents so a
// character reads as itself at a glance instead of as a row of gold text.
const CLASS_COLOR = {
  DEATHKNIGHT: '#C41E3A', DEMONHUNTER: '#A330C9', DRUID:   '#FF7C0A',
  EVOKER:      '#33937F', HUNTER:      '#AAD372', MAGE:    '#3FC7EB',
  MONK:        '#00FF98', PALADIN:     '#F48CBA', PRIEST:  '#FFFFFF',
  ROGUE:       '#FFF468', SHAMAN:      '#0070DD', WARLOCK: '#8788EE',
  WARRIOR:     '#C69B6D',
};

// Zamimg class icons. All 13 classes follow classicon_<class> exactly - verified
// against the CDN - so this derives the name instead of hand-mapping it, and a
// new class would work without a code change.
// Shared identity strip. PVE/PVP/World render stats for the selected character
// but never name it - the char bar was the only cue, so once you scrolled the
// page was "a level 80 something". This puts the character back on its own data.
// Slot layout for the paper doll. Left column, right column, then the weapon
// row underneath - the arrangement every armory site uses, so it reads without
// a legend.
const DOLL_LEFT  = ['HEAD','NECK','SHOULDER','BACK','CHEST','WRIST'];
const DOLL_RIGHT = ['HANDS','WAIST','LEGS','FEET','FINGER_1','FINGER_2'];
const DOLL_BOTTOM = ['MAIN_HAND','OFF_HAND','TRINKET_1','TRINKET_2'];

const DOLL_NAMES = {
  HEAD:'Head', NECK:'Neck', SHOULDER:'Shoulders', BACK:'Cloak', CHEST:'Chest',
  WRIST:'Bracers', HANDS:'Gloves', WAIST:'Belt', LEGS:'Legs', FEET:'Boots',
  FINGER_1:'Ring 1', FINGER_2:'Ring 2', TRINKET_1:'Trinket 1',
  TRINKET_2:'Trinket 2', MAIN_HAND:'Weapon', OFF_HAND:'Off Hand',
};

// One gear slot. The <a data-wowhead> is what gives us a real item icon and the
// hover tooltip - Wowhead's power.js rewrites it, so no extra API calls per item.
// One gear slot. The icon anchor is deliberately empty and marked
// data-wh-icon-size: Wowhead's power.js is configured with renameLinks and
// iconizeLinks on the desktop host, so any text inside an <a data-wowhead>
// gets replaced by the item name AND an icon - which collided with the name
// this component renders itself. Keeping the anchor childless lets the tooltip
// work while we control the layout.
// Enchantable slots as of Midnight (12.0) - confirmed live 2026-09-11 against
// a real /api/wow/profile equipment payload plus Wowhead/wow-professions
// guides. Midnight added Helm/Shoulder and removed Cloak/Bracer versus the
// prior expansion, so this list is expansion-specific and will drift again -
// Legs is deliberately excluded even though "leg enhancements" still exist,
// because those are a separate Tailoring/Leatherworking mechanic (Spellthreads/
// Armor Kits) whose payload shape wasn't verified against a real item.
const ENCHANTABLE_SLOTS = new Set(['HEAD', 'SHOULDER', 'CHEST', 'FINGER_1', 'FINGER_2', 'FEET', 'MAIN_HAND', 'OFF_HAND']);

function DollSlot({ slot, item, side }) {
  const ilvl = item?.level?.value;
  const col = item ? qColor(item.quality?.type) : 'var(--wow-border2)';
  const dur = item?.durability?.value;
  // Both fields are simply absent when empty (confirmed live against a real
  // equipment payload) - no need to inspect their inner shape, just presence.
  const missingEnchant = item && ENCHANTABLE_SLOTS.has(slot) && !(item.enchantments && item.enchantments.length);
  const emptySockets = item?.sockets ? item.sockets.filter(s => !s.item).length : 0;
  if (!item) {
    return html`
      <div class="doll-slot empty ${side}">
        <span class="doll-icon empty"></span>
        <span class="doll-slot-name">${DOLL_NAMES[slot]}</span>
      </div>`;
  }
  return html`
    <div class="doll-slot ${side}">
      <span class="doll-icon" style="border-color:${col};">
        ${item.iconUrl ? html`<img src=${item.iconUrl} alt="" loading="lazy"
             onError=${e => { e.target.style.display = 'none'; }} />` : ''}
      </span>
      <span class="doll-body">
        <span class="doll-slot-name">${DOLL_NAMES[slot]}</span>
        <a class="doll-item" style="color:${col};"
           href=${`https://www.wowhead.com/item=${item.item.id}`}
           data-wowhead=${wowItemAttr(item, ilvl)}
           data-wh-icon-size="0" target="_blank" rel="noopener">${item.name}</a>
      </span>
      <span class="doll-nums">
        <i class="doll-warn ${missingEnchant ? 'on' : ''}"
           title=${missingEnchant ? `${DOLL_NAMES[slot]} has no enchant` : ''}
           aria-label=${missingEnchant ? 'missing enchant' : ''}>${missingEnchant ? '✨' : ''}</i>
        <i class="doll-warn ${emptySockets > 0 ? 'on' : ''}"
           title=${emptySockets > 0 ? `${DOLL_NAMES[slot]} has ${emptySockets} empty socket${emptySockets === 1 ? '' : 's'}` : ''}
           aria-label=${emptySockets > 0 ? `${emptySockets} empty sockets` : ''}>${emptySockets > 0 ? '💎' : ''}</i>
        <i class="doll-dur ${dur != null && dur <= 60 ? 'on' : ''}"
           style=${dur != null && dur <= 60 ? `color:${durColor(dur)};` : ''}
           title=${dur != null && dur <= 60 ? `${DOLL_NAMES[slot]} at ${dur}% durability — needs repair` : ''}
           aria-label=${dur != null && dur <= 60 ? `${dur}% durability` : ''}>${dur != null && dur <= 60 ? '⚒' : ''}</i>
        <b class="doll-ilvl">${ilvl || '—'}</b>
      </span>
    </div>
  `;
}

// Shared gear frame for PVE and PVP. The supporting content differs per tab and
// is passed in as children, so the two pages stay one layout with two bodies.
function WowGearFrame({ character, bnet, children }) {
  const equipped = bnet?.equipment?.equipped_items || [];
  const slotMap = {};
  equipped.forEach(i => { if (i.slot?.type) slotMap[i.slot.type] = i; });

  const ilvl = bnet?.profile?.equipped_item_level
            || bnet?.equipment?.character?.equipped_item_level;
  const render = (bnet?.media?.assets || []).find(a => a.key === 'main-raw')?.value;
  const col = classColor(character?.class);

  if (!equipped.length) {
    return html`
      <div class="doll-wrap">
        <div class="doll loading">
          <div class="doll-col">${DOLL_LEFT.map(k => html`<${DollSlot} slot=${k} side="l" />`)}</div>
          <div class="doll-mid">
            <div class="doll-ilvl-wrap">
              <div class="doll-ilvl-big" style="color:${col};">—</div>
              <div class="doll-ilvl-lbl">equipped ilvl</div>
            </div>
          </div>
          <div class="doll-col">${DOLL_RIGHT.map(k => html`<${DollSlot} slot=${k} side="r" />`)}</div>
        </div>
        <div class="doll-bottom">
          ${DOLL_BOTTOM.map(k => html`<${DollSlot} slot=${k} side="b" />`)}
        </div>
        <div class="doll-hint">Equipment comes from the Blizzard API and may take a moment on first open.</div>
        ${children}
      </div>`;
  }

  return html`
    <div class="doll-wrap">
      <div class="doll" style="--cc:${col};">
        <div class="doll-col">${DOLL_LEFT.map(s => html`<${DollSlot} slot=${s} item=${slotMap[s]} side="l" />`)}</div>
        <div class="doll-mid ${render ? 'has-render' : ''}" style="--cc:${col};">
          <div class="doll-bg" aria-hidden="true"></div>
          ${classIcon(character?.class) ? html`<img class="doll-emblem" src=${classIcon(character?.class)} alt=""
               aria-hidden="true" onError=${e => { e.target.style.display = 'none'; }} />` : ''}
          ${render ? html`<img class="doll-render" src=${render} alt="" loading="lazy"
                              onError=${e => { e.target.closest('.doll-mid')?.classList.remove('has-render'); e.target.style.display = 'none'; }} />` : ''}
          <div class="doll-ilvl-wrap">
            <div class="doll-ilvl-big" style="color:${col};">${ilvl ? Math.round(ilvl) : '—'}</div>
            <div class="doll-ilvl-lbl">equipped ilvl</div>
          </div>
        </div>
        <div class="doll-col">${DOLL_RIGHT.map(s => html`<${DollSlot} slot=${s} item=${slotMap[s]} side="r" />`)}</div>
      </div>
      <div class="doll-bottom">
        ${DOLL_BOTTOM.map(s => html`<${DollSlot} slot=${s} item=${slotMap[s]} side="b" />`)}
      </div>
      ${children}
    </div>
  `;
}

// World is about progression, not gear, so it gets a one-line gear summary
// rather than the full doll - enough to keep the three tabs a family.
function WowGearStrip({ character, bnet }) {
  const equipped = bnet?.equipment?.equipped_items || [];
  if (!equipped.length) return null;
  const ilvl = bnet?.profile?.equipped_item_level
            || bnet?.equipment?.character?.equipped_item_level;
  const worst = equipped.reduce((w, i) => {
    const v = i.durability?.value;
    return (v != null && (w == null || v < w)) ? v : w;
  }, null);
  return html`
    <div class="gear-strip" style="--cc:${classColor(character?.class)};">
      <span class="gear-strip-lbl">gear</span>
      <span class="gear-strip-ilvl">${ilvl ? Math.round(ilvl) : '—'}</span>
      <span class="gear-strip-sub">ilvl</span>
      ${worst != null ? html`
        <span class="gear-strip-sep">·</span>
        <span class="gear-strip-lbl">durability</span>
        <span class="gear-strip-dur" style="color:${durColor(worst)};">${worst}%</span>` : ''}
    </div>
  `;
}

function WowCharIdent({ character }) {
  if (!character) return null;
  const col = classColor(character.class);
  const icon = classIcon(character.class);
  return html`
    <div class="char-ident" style="--cc:${col};">
      ${icon ? html`<img class="char-ident-icon" src=${icon} alt="" loading="lazy"
                        onError=${e => { e.target.style.visibility = 'hidden'; }} />` : ''}
      <span class="char-ident-name" style="color:${col};">${character.display_name || character.name}</span>
      <span class="char-ident-meta">${character.spec || ''} ${character.class || ''}</span>
      <span class="char-ident-realm">${character.realm}</span>
      ${character.level ? html`<span class="char-ident-lvl">lv ${character.level}</span>` : ''}
    </div>
  `;
}

function classIcon(cls) {
  const k = String(cls || '').toLowerCase().replace(/[^a-z]/g, '');
  return k ? `https://wow.zamimg.com/images/wow/icons/medium/classicon_${k}.jpg` : null;
}

// specId -> class name, confirmed live 2026-09-11 against warcraft.wiki.gg
// (Havoc 577 cross-checked against a real captured combatant's Spec ID in
// this session). Combat log COMBATANT_INFO only reports specId, never a
// class string, so this is the only way to get a class color/icon for the
// Pulls meter rows - initial/starter spec ids (145x-1480) are omitted since
// a raiding combatant is never on one.
const SPEC_TO_CLASS = {
  250: 'Death Knight', 251: 'Death Knight', 252: 'Death Knight',
  577: 'Demon Hunter', 581: 'Demon Hunter',
  102: 'Druid', 103: 'Druid', 104: 'Druid', 105: 'Druid',
  1467: 'Evoker', 1468: 'Evoker', 1473: 'Evoker',
  253: 'Hunter', 254: 'Hunter', 255: 'Hunter',
  62: 'Mage', 63: 'Mage', 64: 'Mage',
  268: 'Monk', 269: 'Monk', 270: 'Monk',
  65: 'Paladin', 66: 'Paladin', 70: 'Paladin',
  256: 'Priest', 257: 'Priest', 258: 'Priest',
  259: 'Rogue', 260: 'Rogue', 261: 'Rogue',
  262: 'Shaman', 263: 'Shaman', 264: 'Shaman',
  265: 'Warlock', 266: 'Warlock', 267: 'Warlock',
  71: 'Warrior', 72: 'Warrior', 73: 'Warrior',
};

function classColor(cls) {
  if (!cls) return 'var(--wow-gold)';
  return CLASS_COLOR[String(cls).toUpperCase().replace(/[^A-Z]/g, '')] || 'var(--wow-gold)';
}

// Status ramps: a value is only useful if you can see at a glance whether it
// needs you. Returns a colour, not a label, so callers stay terse.
function ilvlColor(v) {
  if (v == null) return 'var(--wow-muted)';
  if (v >= 200) return 'var(--wow-green)';
  if (v >= 130) return 'var(--wow-gold)';
  return 'var(--wow-muted)';
}
function bagColor(freePct) {
  if (freePct == null) return 'var(--wow-muted)';
  if (freePct <= 10) return 'var(--wow-red)';
  if (freePct <= 25) return 'var(--wow-warn)';
  return 'var(--wow-green)';
}

// Absolute public origin, for things that cannot be relative: OAuth popups and
// EventSource. Desktop's API base is relative, so fall back to the public URL.
const PUBLIC_ORIGIN = HOST.publicOrigin || (API || 'https://gameznet.looknet.ca');

// Static assets live at the root on CF Pages but under /static on desktop.
const ASSETS = HOST.assetBase != null ? HOST.assetBase : '';

function authPair() {
  if (HOST.getAuth) return HOST.getAuth() || {};
  return {
    token:   localStorage.getItem('gzn_token'),
    session: localStorage.getItem('gzn_session')
  };
}

function req(path, opts = {}) {
  const { token, session } = authPair();
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

  // Wowhead: only inject what the host page has not already provided. The
  // desktop client sets its own richer whTooltips (iconizeLinks/renameLinks on,
  // which mobile turns off for small screens) and loads power.js in its <head>.
  // Re-injecting would redeclare whTooltips and silently downgrade desktop.
  if (typeof window.whTooltips === 'undefined') {
    const whCfg = document.createElement('script');
    whCfg.text = 'var whTooltips = {colorLinks:true, iconizeLinks:false, renameLinks:false};';
    document.head.appendChild(whCfg);
  }

  if (!document.getElementById('wowhead-widget') &&
      !document.querySelector('script[src*="wow.zamimg.com/widgets/power.js"]')) {
    const whScript = document.createElement('script');
    whScript.id = 'wowhead-widget';
    whScript.src = 'https://wow.zamimg.com/widgets/power.js';
    document.head.appendChild(whScript);
  }

  // Inject Scoped CSS
  const style = document.createElement('style');
  style.id = 'wow-styles';
  style.textContent = `
    .wow-wrap {
      --wow-bg: #07090f;
      --wow-surface: #0f1623;
      --wow-surface2:   #1a1e2a;
      --wow-border: #162030;
      --wow-border2: #1e3048;
      --wow-accent: #f0b429;
      --wow-frost:      #00c8ff;
      --wow-accent-dim: rgba(240,180,41,0.14);
      --wow-gold:       #f0b429;
      --wow-gold-dim:   rgba(240,180,41,0.15);
      --wow-green:      #22c55e;
      --wow-green-dim:  rgba(34,197,94,0.12);
      --wow-red:        #ef4444;
      --wow-red-dim:    rgba(239,68,68,0.12);
      --wow-purple:     #a855f7;
      --wow-text: #c0d4e8;
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
    /* Every tab must stay visible and clickable - never silently pushed off
       the right edge (confirmed live 2026-09-11: a 12th tab pushed the
       host-appended Addon tab past the viewport with no visible scroll
       affordance, on a plain overflow-x:auto strip). Three hard tiers by
       viewport width, each showing exactly one of tab-label/tab-label-short/
       icon-only - NOT flex-shrink + text-overflow:ellipsis, which was tried
       first and landed every tab in an unreadable 3-letter zone
       ("OVERVI...", "GRO...") at nearly every width in between the full and
       icon-only tiers (confirmed live via screenshot). tab-label-short is a
       hand-picked abbreviation per tab (see the 'short' field on 'tabs'
       below), not a CSS truncation, so it reads correctly at every width
       that tier applies to. Below ~600px even icon-only tabs can't all fit
       at a usable tap size, so that's the point horizontal scroll takes
       over instead of shrinking further. */
    .wow-wrap .wow-nav-tabs {
      background: var(--wow-surface);
      border-bottom: 1px solid var(--wow-border);
      display: flex;
      align-items: center;
      padding: 0 20px;
      position: sticky;
      top: 82px;
      z-index: 185;
      min-height: 40px;
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
      justify-content: center;
      gap: 7px;
      user-select: none;
      white-space: nowrap;
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
    }
    /* Tier 1 (default, wide): full label. */
    .wow-wrap .wow-nav-tab .tab-label-short { display: none; }
    /* Tier 2 (mid width): swap to the fixed short abbreviation - no
       ellipsis, no free shrinking. */
    @media (max-width: 1150px) and (min-width: 821px) {
      .wow-wrap .wow-nav-tab { padding: 12px 10px; }
      .wow-wrap .wow-nav-tab .tab-label { display: none; }
      .wow-wrap .wow-nav-tab .tab-label-short { display: inline; }
    }
    /* Tier 3 (narrow desktop): icon only. Native title tooltip (set on the
       tab itself) keeps it discoverable. */
    @media (max-width: 820px) and (min-width: 601px) {
      .wow-wrap .wow-nav-tab { padding: 12px 10px; }
      .wow-wrap .wow-nav-tab .tab-label,
      .wow-wrap .wow-nav-tab .tab-label-short { display: none; }
    }
    /* Tier 4 (mobile): even icon-only can't fit 12 tabs at a tappable size -
       fall back to the horizontal-scroll strip instead of shrinking icons
       past a usable tap target. */
    @media (max-width: 600px) {
      .wow-wrap .wow-nav-tabs {
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }
      .wow-wrap .wow-nav-tabs::-webkit-scrollbar { display: none; }
      .wow-wrap .wow-nav-tab {
        flex: 0 0 auto;
      }
      .wow-wrap .wow-nav-tab .tab-label,
      .wow-wrap .wow-nav-tab .tab-label-short { display: none; }
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
    .wow-wrap .char-list-name { flex: 1; font-family: var(--wow-display); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Two action buttons plus a long character name overflow a narrow phone;
       let the buttons drop to their own line instead of crushing the name. */
    @media (max-width: 420px) {
      .wow-wrap .char-list-row { flex-wrap: wrap; }
      .wow-wrap .char-list-row > button { margin-left: auto; }
      .wow-wrap .char-list-row > button ~ button { margin-left: 0; }
    }
    .wow-wrap .char-list-realm { font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .char-list-del { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-red); cursor: pointer; padding: 2px 6px; border: 1px solid rgba(239,68,68,0.3); border-radius: 3px; }
    .wow-wrap .char-list-del:hover { background: rgba(239,68,68,0.12); }
    .wow-wrap .empty { text-align: center; padding: 24px; color: var(--wow-muted); font-family: var(--wow-mono); font-size: 11px; letter-spacing: 1px; }
    .wow-wrap .info-box { background: var(--wow-bg); border: 1px solid var(--wow-border); border-left: 3px solid var(--wow-accent); border-radius: 4px; padding: 10px 12px; font-size: 11px; color: var(--wow-muted); line-height: 1.7; margin-bottom: 12px; }
    .wow-wrap .info-box strong { color: var(--wow-text); }
    .wow-wrap .info-box.gold { border-left-color: var(--wow-gold); }
    
    .wow-wrap .score-display { text-align: center; padding: 14px 0 6px; }
    .wow-wrap .score-big { font-family: var(--wow-mono); font-size: 52px; font-weight: 700; color: var(--wow-accent); line-height: 1; text-shadow: 0 0 30px rgba(0,200,255,0.3); }
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
    .wow-wrap .boss-pip.killed-h { border-color: rgba(0,200,255,0.35); }
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
    .wow-wrap .diff-h { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,200,255,0.4); }
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
    .wow-wrap .wow-topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: var(--wow-surface); border-bottom: 1px solid var(--wow-border); position: sticky; top: 0; z-index: 190; min-height: 48px; box-sizing: border-box; }
    .wow-wrap .reset-banner { background: linear-gradient(90deg, var(--wow-surface) 0%, rgba(240,180,41,0.06) 50%, var(--wow-surface) 100%); border-bottom: 1px solid rgba(240,180,41,0.2); padding: 6px 20px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px 14px; position: sticky; top: 48px; z-index: 188; min-height: 34px; box-sizing: border-box; }
    .wow-wrap .reset-label   { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); text-transform: uppercase; letter-spacing: 2px; }
    .wow-wrap .reset-time    { font-family: var(--wow-mono); font-size: 15px; color: var(--wow-gold); font-weight: 700; letter-spacing: 3px; }
    .wow-wrap .reset-divider { color: var(--wow-border2); }
    .wow-wrap .wow-token-chip { display: inline-flex; align-items: center; gap: 6px; cursor: help; }
    .wow-wrap .wow-roster-count { display: inline-flex; align-items: center; gap: 6px; }
    .wow-wrap .wow-roster-count svg { width: 13px; height: 13px; opacity: 0.75; flex-shrink: 0; }
    .wow-wrap .wow-token-icon { width: 13px; height: 13px; opacity: 0.9; }
    .wow-wrap .wow-token-label { font-family: var(--wow-mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .wow-token-price { font-family: var(--wow-mono); font-size: 11px; font-weight: 600; color: var(--wow-gold); }
    .wow-wrap .wow-topbar #wow-host-controls { display: flex; align-items: center; gap: 8px; }
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
      .wow-wrap .wow-nav-tabs { padding: 0 6px; }
      /* Phones cannot fit reset + timer + token on one row, and a wrapped bar
         has no fixed height for the bars below it to stick under. Let the
         header stack scroll away on mobile and keep only the nav pinned. */
      .wow-wrap .wow-topbar { position: static; height: auto; padding: 10px 14px; }
      .wow-wrap .reset-banner { position: static; padding: 7px 12px; gap: 4px 10px; }
      .wow-wrap .reset-time { font-size: 13px; letter-spacing: 1.5px; }
      .wow-wrap .reset-label { letter-spacing: 1px; }
      .wow-wrap .wow-nav-tabs { position: sticky; top: 0; }
      .wow-wrap .char-bar { top: 40px; }
      .wow-wrap .wow-nav-tab { padding: 12px 14px; font-size: 12px; }
      .wow-wrap .wow-layout, .wow-wrap .layout-full { padding: 12px 10px; }
      .wow-wrap .card-header, .wow-wrap .card-body { padding: 10px; }
    }
    .wow-wrap .char-ident { display: flex; align-items: center; gap: 9px; padding: 8px 14px; background: var(--wow-surface); border-bottom: 1px solid var(--wow-border); border-left: 3px solid var(--cc, var(--wow-gold)); }
    .wow-wrap .char-ident-icon { width: 22px; height: 22px; border-radius: 3px; border: 1px solid var(--cc, var(--wow-border2)); flex-shrink: 0; }
    .wow-wrap .char-ident-name { font-family: var(--wow-display); font-size: 16px; font-weight: 700; letter-spacing: 0.4px; }
    .wow-wrap .char-ident-meta { font-family: var(--wow-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--wow-dim); }
    .wow-wrap .char-ident-realm { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .char-ident-lvl { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); margin-left: auto; }

    /* ── Paper doll (shared by PVE / PVP) ─────────────────────────────────── */
    .wow-wrap .doll-wrap { padding: 0 12px 14px; }
    .wow-wrap .doll { display: grid; grid-template-columns: minmax(0,290px) minmax(260px,420px) minmax(0,290px); gap: 14px; align-items: start; justify-content: center; margin: 0 auto; }
    .wow-wrap .doll-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .wow-wrap .doll-mid { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 260px; overflow: hidden; }
    /* Class-coloured ground behind the figure: a soft radial in the class
       colour with the class emblem faint on top of it. Both key off --cc, so
       every class works without a per-class asset. */
    .wow-wrap .doll-bg { position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 70% 60% at 50% 42%, rgba(255,255,255,0.07), transparent 72%);
      background: radial-gradient(ellipse 70% 60% at 50% 42%, color-mix(in srgb, var(--cc) 26%, transparent), transparent 72%); }
    .wow-wrap .doll-emblem { position: absolute; left: 50%; top: 44%; width: 62%; max-width: 230px;
      transform: translate(-50%,-50%); opacity: 0.07; pointer-events: none; filter: grayscale(1) contrast(1.2); }
    .wow-wrap .doll-render { position: absolute; left: 50%; top: 0; width: 144%; max-width: none; display: block; margin: 0; transform: translateX(-50%) translateY(-25.9%); filter: drop-shadow(0 8px 26px rgba(0,0,0,0.65)); }
    /* Overlaid on the art, with a fade behind it so the digits stay legible
       whatever the render happens to be doing at that height. */
    .wow-wrap .doll-mid.has-render .doll-ilvl-wrap { position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
      padding: 5px 20px 6px; border-radius: 8px; border: 1px solid var(--wow-border2);
      background: rgba(7,9,15,0.78); backdrop-filter: blur(4px); box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      pointer-events: none; }
    .wow-wrap .doll-ilvl-wrap { text-align: center; }
    .wow-wrap .doll-ilvl-big { font-family: var(--wow-display); font-size: 46px; font-weight: 700; line-height: 1; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
    .wow-wrap .doll-ilvl-lbl { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 2.5px; text-transform: uppercase; color: var(--wow-dim); margin-top: 3px; }

    .wow-wrap .doll-slot { display: flex; align-items: center; gap: 11px; background: var(--wow-surface); border: 1px solid var(--wow-border); border-radius: 4px; padding: 4px 8px; min-width: 0; }
    .wow-wrap .doll-slot.r { flex-direction: row-reverse; }
    .wow-wrap .doll-slot.r .doll-body { text-align: right; }
    .wow-wrap .doll-slot.r .doll-nums { margin-left: 0; margin-right: auto; }
    .wow-wrap .doll-slot.empty { opacity: 0.4; }
    .wow-wrap .doll-slot.b { gap: 13px; padding: 5px 10px; }
    .wow-wrap .doll-icon { width: 30px; height: 30px; border-radius: 3px; border: 1px solid var(--wow-border2); background: var(--wow-bg); flex-shrink: 0; display: block; overflow: hidden; }
    .wow-wrap .doll-icon img { width: 100%; height: 100%; display: block; }
    .wow-wrap .doll-icon.empty { border-style: dashed; }
    .wow-wrap .doll-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; overflow: hidden; }
    .wow-wrap .doll-slot-name { font-family: var(--wow-mono); font-size: 8px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .doll-item { font-family: var(--wow-display); font-size: 11.5px; font-weight: 600; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; display: block; }
    .wow-wrap .doll-item:hover { text-decoration: underline; }
    /* Wowhead's iconizeLinks is on globally for the other views; inside the
       doll we draw our own icon, so drop the one power.js injects rather
       than let it crowd the name. */
    .wow-wrap .doll-item .icon-added,
    .wow-wrap .doll-item ins, .wow-wrap .doll-item del,
    .wow-wrap .doll-item [class^="icon"], .wow-wrap .doll-item [class*=" icon"] { display: none !important; }
    .wow-wrap .doll-item { text-indent: 0 !important; padding-left: 0 !important; background-image: none !important; }
    /* Same power.js landmine hits the profession recipe chips: it injects
       an icon into a tight inline-flex row with no room for it, producing
       an unreadable overlap of icon and recipe name. Recipe names are exact
       already (they came straight from the Blizzard API), so there is
       nothing power.js's icon adds here - suppress it rather than fight it
       for layout space, same fix as .doll-item above. */
    .wow-wrap .recipe-link .icon-added,
    .wow-wrap .recipe-link ins, .wow-wrap .recipe-link del,
    .wow-wrap .recipe-link [class^="icon"], .wow-wrap .recipe-link [class*=" icon"] { display: none !important; }
    .wow-wrap .recipe-link { text-indent: 0 !important; padding-left: 2px !important; background-image: none !important; }
    .wow-wrap .doll-nums { display: flex; align-items: baseline; gap: 6px; flex-shrink: 0; margin-left: auto; }
    .wow-wrap .doll-ilvl { font-family: var(--wow-mono); font-size: 12px; font-weight: 700; color: var(--wow-text); min-width: 26px; text-align: right; }
    .wow-wrap .doll-dur { font-size: 11px; font-style: normal; width: 12px; text-align: center; flex-shrink: 0; cursor: help; line-height: 1; }
    .wow-wrap .doll-warn { font-size: 11px; font-style: normal; width: 12px; text-align: center; flex-shrink: 0; cursor: help; line-height: 1; }

    .wow-wrap .doll-bottom { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; margin: 10px auto 0; max-width: 1028px; }
    .wow-wrap .doll.loading { opacity: 0.45; }
    .wow-wrap .doll-hint { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); text-align: center; padding: 8px 0 0; }
    .wow-wrap .doll-none { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-muted); background: var(--wow-surface); border: 1px solid var(--wow-border); border-radius: 5px; padding: 14px; line-height: 1.6; }

    /* World keeps a one-line gear summary instead of the full doll. */
    .wow-wrap .gear-strip { display: flex; align-items: baseline; gap: 7px; padding: 7px 14px; background: var(--wow-surface); border-bottom: 1px solid var(--wow-border); border-left: 3px solid var(--cc, var(--wow-gold)); }
    .wow-wrap .gear-strip-lbl { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .gear-strip-ilvl { font-family: var(--wow-display); font-size: 17px; font-weight: 700; color: var(--wow-text); }
    .wow-wrap .gear-strip-sub { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); }
    .wow-wrap .gear-strip-dur { font-family: var(--wow-mono); font-size: 12px; font-weight: 600; }
    .wow-wrap .gear-strip-sep { color: var(--wow-border2); }

    /* Phones: one column, render on top. A 3-column doll at 390px gives each
       slot ~110px, which truncates every item name to nothing. */
    @media (max-width: 768px) {
      .wow-wrap .doll-wrap { padding: 0 8px 12px; }
      .wow-wrap .doll { grid-template-columns: 1fr; gap: 4px; }
      .wow-wrap .doll-mid { order: -1; margin-bottom: 8px; height: 240px; padding-bottom: 0; }
      .wow-wrap .doll-render { width: 132%; transform: translateX(-50%) translateY(-24%); }
      .wow-wrap .doll-slot { gap: 10px; padding: 5px 8px; }
      .wow-wrap .doll-slot.b { gap: 10px; }
      .wow-wrap .doll-ilvl-big { font-size: 34px; }
      .wow-wrap .doll-mid.has-render .doll-ilvl-wrap { padding: 5px 16px 6px; bottom: 2px; }
      .wow-wrap .doll-slot.r { flex-direction: row; }
      .wow-wrap .doll-slot.r .doll-body { text-align: left; }
      .wow-wrap .doll-bottom { grid-template-columns: 1fr; margin-top: 4px; }
    }

    .wow-wrap .chardetail { max-width: 1100px; margin: 0 auto; }

    /* ── Character overview ───────────────────────────────────────────────── */
    .wow-wrap .ov-ident { display: flex; align-items: center; gap: 11px; margin: 12px 12px 0; padding: 10px 13px; background: var(--wow-surface); border: 1px solid var(--wow-border); border-left: 3px solid var(--cc, var(--wow-gold)); border-radius: 6px; }
    .wow-wrap .ov-ident-icon { width: 34px; height: 34px; border-radius: 4px; border: 1px solid var(--cc, var(--wow-border2)); flex-shrink: 0; }
    .wow-wrap .ov-ident-body { min-width: 0; }
    .wow-wrap .ov-ident-name { font-family: var(--wow-display); font-size: 18px; font-weight: 700; letter-spacing: 0.4px; line-height: 1.2; }
    .wow-wrap .ov-ident-meta { font-family: var(--wow-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--wow-muted); margin-top: 2px; }
    .wow-wrap .ov-guild { margin-left: auto; font-family: var(--wow-display); font-size: 12px; color: var(--wow-dim); white-space: nowrap; }
    .wow-wrap .ov-login { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); white-space: nowrap; }
    .wow-wrap .ov-guild + .ov-login { margin-left: 10px; }
    .wow-wrap .ov-login:first-of-type { margin-left: auto; }

    .wow-wrap .ov-title { font-family: var(--wow-display); font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-gold); margin-bottom: 9px; }
    .wow-wrap .ov-hint { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); margin-top: 9px; line-height: 1.6; }
    .wow-wrap .ov-hint b { color: var(--wow-green); }

    .wow-wrap .ov-coll { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
    .wow-wrap .ov-coll-item { display: flex; flex-direction: column; gap: 2px; }
    .wow-wrap .ov-coll-item b { font-family: var(--wow-display); font-size: 20px; font-weight: 700; color: var(--wow-text); line-height: 1; }
    .wow-wrap .ov-coll-item i { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); font-style: normal; }

    .wow-wrap .ov-curr { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px 14px; }
    .wow-wrap .ov-curr-item { display: flex; align-items: center; gap: 7px; min-width: 0; cursor: help; }
    .wow-wrap .ov-curr-item img { width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0; }
    .wow-wrap .ov-curr-amt { font-family: var(--wow-mono); font-size: 12px; font-weight: 700; color: var(--wow-text); flex-shrink: 0; }
    .wow-wrap .ov-curr-name { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Collections carry their own colour so the card is not four identical
       numbers, and the two that lead somewhere say so. */
    .wow-wrap .ov-coll-item.ach b   { color: var(--wow-gold); }
    .wow-wrap .ov-coll-item.mounts b { color: var(--wow-accent); }
    .wow-wrap .ov-coll-item.pets b  { color: var(--wow-green); }
    .wow-wrap .ov-coll-item.house b { color: var(--wow-purple, #a855f7); }
    .wow-wrap .ov-coll-item.link { cursor: pointer; border-radius: 4px; margin: -4px -6px; padding: 4px 6px; transition: background 0.12s; }
    .wow-wrap .ov-coll-item.link:hover { background: var(--wow-surface2); }

    .wow-wrap .ov-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 12px; }
    .wow-wrap .ov-link { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: var(--wow-surface); border: 1px solid var(--wow-border); border-left: 3px solid var(--wow-border2); border-radius: 5px; cursor: pointer; font-family: var(--wow-display); font-size: 13px; font-weight: 600; color: var(--wow-text); transition: border-color 0.12s, background 0.12s; }
    .wow-wrap .ov-link:hover { background: var(--wow-surface2); }
    .wow-wrap .ov-link b { font-size: 15px; font-weight: 400; }
    .wow-wrap .ov-link i { font-family: var(--wow-mono); font-size: 9px; font-style: normal; color: var(--wow-muted); margin-left: auto; text-align: right; }
    .wow-wrap .ov-link.pve:hover   { border-left-color: var(--wow-accent); }
    .wow-wrap .ov-link.pvp:hover   { border-left-color: var(--wow-purple, #a855f7); }
    .wow-wrap .ov-link.world:hover { border-left-color: var(--wow-green); }
    .wow-wrap .ov-link.professions:hover { border-left-color: var(--wow-warn, #f59e0b); }
    .wow-wrap .ov-link.keys:hover  { border-left-color: var(--wow-gold); }

    .wow-wrap .ov-prof { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
    .wow-wrap .ov-prof-name { flex: 0 1 150px; font-family: var(--wow-mono); font-size: 11px; color: var(--wow-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .ov-prof-bar { flex: 1; max-width: 220px; height: 5px; border-radius: 3px; background: var(--wow-bg); border: 1px solid var(--wow-border); overflow: hidden; }
    .wow-wrap .ov-prof-fill { display: block; height: 100%; background: var(--wow-accent); }
    .wow-wrap .ov-prof-rank { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-accent); min-width: 62px; text-align: right; }

    @media (max-width: 768px) {
      .wow-wrap .ov-guild, .wow-wrap .ov-login { display: none; }
      .wow-wrap .ov-prof-name { flex-basis: 100px; }
    }

    /* ── Group ────────────────────────────────────────────────────────────── */
    .wow-wrap .group { padding: 10px 12px 16px; max-width: 1100px; margin: 0 auto; }
    .wow-wrap .group-bar { display: flex; align-items: center; gap: 8px; padding: 2px 2px 10px; font-family: var(--wow-mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .group-stat b { font-family: var(--wow-display); font-size: 13px; font-weight: 700; color: var(--wow-text); margin-right: 3px; }
    .wow-wrap .group-stat.gold b { color: var(--wow-gold); }
    .wow-wrap .group-sep { color: var(--wow-border2); }
    .wow-wrap .group-reload { margin-left: auto; font-size: 13px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
    .wow-wrap .group-reload:hover { color: var(--wow-accent); background: var(--wow-surface2); }
    .wow-wrap .group-rank { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-dim); background: var(--wow-surface); border: 1px solid var(--wow-border); border-left: 3px solid var(--wow-gold); border-radius: 5px; padding: 8px 11px; margin-bottom: 10px; line-height: 1.7; }
    .wow-wrap .group-rank b { color: var(--wow-gold); font-family: var(--wow-display); font-size: 12px; }
    .wow-wrap .group-rank i { display: block; color: var(--wow-muted); font-style: normal; font-size: 9px; margin-top: 2px; }

    .wow-wrap .g-owner { margin-bottom: 12px; }
    .wow-wrap .g-owner-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 6px; }
    .wow-wrap .g-owner-name { font-family: var(--wow-display); font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-dim); }
    .wow-wrap .g-owner-name.mine { color: var(--wow-gold); }
    .wow-wrap .g-owner-count { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); }
    .wow-wrap .g-owner-house { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); padding: 0 2px 6px; }
    .wow-wrap .g-owner-house b { color: var(--wow-gold); font-weight: 600; }
    .wow-wrap .g-rows { display: flex; flex-direction: column; gap: 5px; }

    .wow-wrap .g-row { background: var(--wow-surface); border: 1px solid var(--wow-border); border-left: 3px solid var(--cc, var(--wow-gold)); border-radius: 5px; padding: 7px 11px; }
    .wow-wrap .g-row-unsynced { border-left-color: var(--wow-border2); opacity: 0.75; }
    .wow-wrap .g-row-top { display: flex; align-items: center; gap: 9px; }
    .wow-wrap .g-icon { width: 18px; height: 18px; border-radius: 3px; flex-shrink: 0; }
    .wow-wrap .g-name { font-family: var(--wow-display); font-size: 14px; font-weight: 700; white-space: nowrap; }
    .wow-wrap .g-spec { font-family: var(--wow-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--wow-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .g-gap { flex: 1; }
    .wow-wrap .g-tag { font-family: var(--wow-mono); font-size: 10px; padding: 1px 7px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
    .wow-wrap .g-tag.key { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(240,180,41,0.3); }
    .wow-wrap .g-tag.lock { background: var(--wow-surface2); color: var(--wow-muted); border: 1px solid var(--wow-border2); }

    .wow-wrap .g-row-stats { display: flex; flex-wrap: wrap; gap: 5px 16px; margin-top: 6px; padding-left: 27px; }
    .wow-wrap .g-stat { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; }
    .wow-wrap .g-stat i { font-family: var(--wow-mono); font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); font-style: normal; }
    .wow-wrap .g-stat b { font-family: var(--wow-mono); font-size: 11px; font-weight: 600; color: var(--wow-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .g-stat b.gold { color: var(--wow-gold); }

    .wow-wrap .group-card { background: var(--wow-surface); border: 1px solid var(--wow-border); border-radius: 6px; padding: 11px 13px; }
    .wow-wrap .group-title { font-family: var(--wow-display); font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-gold); margin-bottom: 9px; }
    .wow-wrap .g-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 2px 16px; }
    .wow-wrap .g-item { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
    .wow-wrap .g-item a { flex: 1; min-width: 0; font-family: var(--wow-mono); font-size: 10px; color: var(--wow-dim); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .g-item a:hover { color: var(--wow-accent); }
    .wow-wrap .g-item-total { font-family: var(--wow-display); font-size: 12px; font-weight: 700; color: var(--wow-text); }
    .wow-wrap .g-item-holders { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); }

    @media (max-width: 768px) {
      .wow-wrap .group { padding: 8px 8px 14px; }
      .wow-wrap .g-spec { display: none; }
      .wow-wrap .g-row-stats { padding-left: 0; gap: 4px 12px; }
    }

    /* ── Keys & Lockouts ──────────────────────────────────────────────────── */
    .wow-wrap .keys { padding: 10px 12px 16px; max-width: 1100px; margin: 0 auto; }
    .wow-wrap .keys-bar { display: flex; align-items: center; gap: 8px; padding: 2px 2px 10px; font-family: var(--wow-mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .keys-stat b { font-family: var(--wow-display); font-size: 13px; font-weight: 700; color: var(--wow-text); margin-right: 3px; }
    .wow-wrap .keys-sep { color: var(--wow-border2); }
    .wow-wrap .keys-reload { margin-left: auto; font-size: 13px; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
    .wow-wrap .keys-reload:hover { color: var(--wow-accent); background: var(--wow-surface2); }

    .wow-wrap .keys-card { background: var(--wow-surface); border: 1px solid var(--wow-border); border-radius: 6px; padding: 11px 13px; margin-bottom: 10px; }
    .wow-wrap .keys-title { font-family: var(--wow-display); font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-gold); margin-bottom: 9px; }
    .wow-wrap .keys-none { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-muted); }
    .wow-wrap .keys-rows { display: flex; flex-direction: column; gap: 5px; }

    .wow-wrap .k-who { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .wow-wrap .k-icon { width: 17px; height: 17px; border-radius: 3px; flex-shrink: 0; }
    .wow-wrap .k-name { font-family: var(--wow-display); font-size: 13px; font-weight: 700; white-space: nowrap; }
    .wow-wrap .k-owner { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); text-transform: uppercase; letter-spacing: 0.5px; }

    .wow-wrap .k-row { display: flex; align-items: center; gap: 10px; background: var(--wow-surface2); border-left: 3px solid var(--cc, var(--wow-gold)); border-radius: 4px; padding: 7px 10px; }
    .wow-wrap .k-dungeon { flex: 1; min-width: 0; font-family: var(--wow-mono); font-size: 10px; color: var(--wow-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .k-level { font-family: var(--wow-display); font-size: 17px; font-weight: 700; color: var(--wow-muted); flex-shrink: 0; }
    .wow-wrap .k-level.mid { color: var(--wow-accent); }
    .wow-wrap .k-level.high { color: var(--wow-gold); text-shadow: 0 0 10px rgba(240,180,41,0.35); }

    .wow-wrap .k-vault, .wow-wrap .k-lock { background: var(--wow-surface2); border-left: 3px solid var(--cc, var(--wow-gold)); border-radius: 4px; padding: 7px 10px; }
    .wow-wrap .k-vault-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .wow-wrap .k-ready { margin-left: auto; font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .k-ready.on { color: var(--wow-green); }
    .wow-wrap .k-weekly-keys { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-accent); }

    .wow-wrap .k-slots { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .wow-wrap .k-group { display: inline-flex; align-items: center; gap: 4px; }
    .wow-wrap .k-group-lbl { font-family: var(--wow-mono); font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); margin-right: 1px; }
    .wow-wrap .k-pip { font-family: var(--wow-mono); font-size: 9px; min-width: 30px; text-align: center; padding: 2px 5px; border-radius: 3px; background: var(--wow-bg); border: 1px solid var(--wow-border); color: var(--wow-muted); cursor: help; }
    .wow-wrap .k-pip.part { border-color: var(--wow-border2); color: var(--wow-dim); }
    .wow-wrap .k-pip.done { background: var(--wow-green-dim); border-color: rgba(34,197,94,0.35); color: var(--wow-green); font-weight: 700; }

    .wow-wrap .k-lo { display: flex; align-items: center; gap: 8px; padding: 3px 0 3px 24px; }
    .wow-wrap .k-lo-name { flex: 0 1 auto; max-width: 260px; min-width: 0; font-family: var(--wow-mono); font-size: 10px; color: var(--wow-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wow-wrap .k-lo-spacer { flex: 1; }
    .wow-wrap .k-lo-name i { color: var(--wow-muted); font-style: normal; }
    .wow-wrap .k-lo-bar { width: 54px; height: 4px; border-radius: 2px; background: var(--wow-bg); border: 1px solid var(--wow-border); overflow: hidden; flex-shrink: 0; }
    .wow-wrap .k-lo-fill { display: block; height: 100%; background: var(--cc, var(--wow-accent)); }
    .wow-wrap .k-lo-count { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-text); min-width: 30px; text-align: right; }
    .wow-wrap .k-lo-reset { font-family: var(--wow-mono); font-size: 9px; color: var(--wow-muted); min-width: 46px; text-align: right; }
    .wow-wrap .k-lo.done .k-lo-fill { background: var(--wow-green); }
    .wow-wrap .k-lo.done .k-lo-count { color: var(--wow-green); }
    .wow-wrap .k-lo.done .k-lo-name { color: var(--wow-muted); }

    @media (max-width: 768px) {
      .wow-wrap .keys { padding: 8px 8px 14px; }
      .wow-wrap .k-dungeon { display: none; }
      .wow-wrap .k-lo { padding-left: 8px; }
      .wow-wrap .k-lo-bar { display: none; }
    }

    /* ── Hub ─────────────────────────────────────────────────────────────── */
    .wow-wrap .hub { padding: 10px 12px 16px; max-width: 1100px; margin: 0 auto; }
    .wow-wrap .hub-bar { display: flex; align-items: center; gap: 10px; padding: 2px 2px 10px; }
    .wow-wrap .hub-count { font-family: var(--wow-mono); font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); }
    .wow-wrap .hub-pill { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
    .wow-wrap .hub-pill.ok   { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.3); }
    .wow-wrap .hub-pill.warn { background: var(--wow-gold-dim);  color: var(--wow-gold);  border: 1px solid rgba(240,180,41,0.35); }
    .wow-wrap .hub-reload { margin-left: auto; font-size: 13px; color: var(--wow-muted); cursor: pointer; padding: 4px 6px; border-radius: 4px; }
    .wow-wrap .hub-reload:hover { color: var(--wow-accent); background: var(--wow-surface2); }

    .wow-wrap .hub-totals { display: grid; grid-template-columns: repeat(auto-fit,minmax(84px,1fr)); gap: 1px; background: var(--wow-border); border: 1px solid var(--wow-border); border-radius: 6px; overflow: hidden; margin-bottom: 12px; }
    .wow-wrap .hub-total { background: var(--wow-surface); padding: 9px 12px; display: flex; flex-direction: column; gap: 2px; }
    .wow-wrap .hub-total i { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--wow-muted); font-style: normal; }
    .wow-wrap .hub-total b { font-family: var(--wow-display); font-size: 19px; font-weight: 700; color: var(--wow-text); line-height: 1.1; }
    .wow-wrap .hub-total b.gold { color: var(--wow-gold); }
    .wow-wrap .hub-total b.on   { color: var(--wow-accent); }
    .wow-wrap .hub-total b.off  { color: var(--wow-muted); }

    .wow-wrap .hub-alerts { display: flex; flex-direction: column; gap: 1px; margin-bottom: 12px; border-radius: 6px; overflow: hidden; }
    .wow-wrap .hub-alert { display: flex; align-items: center; gap: 9px; padding: 8px 12px; background: var(--wow-surface); border-left: 3px solid var(--cc, var(--wow-gold)); cursor: pointer; }
    .wow-wrap .hub-alert:hover { background: var(--wow-surface2); }
    .wow-wrap .hub-alert-icon { font-size: 13px; flex-shrink: 0; }
    .wow-wrap .hub-alert-text { font-family: var(--wow-mono); font-size: 11px; color: var(--wow-text); }

    .wow-wrap .hub-rows { display: flex; flex-direction: column; gap: 6px; }
    .wow-wrap .hub-row { background: var(--wow-surface); border: 1px solid var(--wow-border); border-left: 3px solid var(--cc, var(--wow-gold)); border-radius: 5px; padding: 8px 12px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
    .wow-wrap .hub-row:hover { background: var(--wow-surface2); border-color: var(--wow-border2); border-left-color: var(--cc, var(--wow-gold)); }
    .wow-wrap .hub-row-top { display: flex; align-items: baseline; gap: 8px; }
    .wow-wrap .hub-icon { width: 20px; height: 20px; border-radius: 3px; border: 1px solid var(--cc, var(--wow-border2)); flex-shrink: 0; align-self: center; }
    .wow-wrap .hub-name { font-family: var(--wow-display); font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .wow-wrap .hub-spec { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .wow-wrap .hub-realm { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .hub-lvl { font-family: var(--wow-mono); font-size: 10px; color: var(--wow-muted); }
    .wow-wrap .hub-lvl::before { content: 'lv '; opacity: 0.6; }
    .wow-wrap .hub-gap { flex: 1; }
    .wow-wrap .hub-tag { font-family: var(--wow-mono); font-size: 10px; padding: 1px 7px; border-radius: 3px; white-space: nowrap; }
    .wow-wrap .hub-tag.key   { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(240,180,41,0.3); }
    .wow-wrap .hub-tag.vault { background: var(--wow-green-dim);  color: var(--wow-green);  border: 1px solid rgba(34,197,94,0.3); }
    .wow-wrap .hub-tag.lock  { background: var(--wow-surface2);   color: var(--wow-muted);  border: 1px solid var(--wow-border2); }
    .wow-wrap .hub-chev { font-family: var(--wow-mono); font-size: 15px; color: var(--wow-border2); margin-left: 2px; }
    .wow-wrap .hub-row:hover .hub-chev { color: var(--wow-accent); }

    .wow-wrap .hub-row-stats { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 7px; }
    .wow-wrap .hub-stat { display: inline-flex; align-items: baseline; gap: 5px; }
    .wow-wrap .hub-stat i { font-family: var(--wow-mono); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--wow-muted); font-style: normal; }
    .wow-wrap .hub-stat b { font-family: var(--wow-mono); font-size: 12px; font-weight: 600; color: var(--wow-text); }
    .wow-wrap .hub-stat b.gold { color: var(--wow-gold); }

    @media (max-width: 768px) {
      .wow-wrap .hub { padding: 8px 8px 14px; }
      .wow-wrap .hub-row-stats { gap: 5px 12px; }
      .wow-wrap .hub-realm { display: none; }
    }

    .wow-wrap .dungeon-list { display: flex; flex-direction: column; gap: 5px; }
    .wow-wrap .dungeon-row { display: flex; align-items: center; gap: 10px; background: var(--wow-surface2); border: 1px solid var(--wow-border); border-radius: 4px; padding: 8px 12px; }
    .wow-wrap .dungeon-icon { font-size: 16px; flex-shrink: 0; }
    .wow-wrap .dungeon-name { flex: 1; font-family: var(--wow-display); font-size: 13px; font-weight: 600; }
    .wow-wrap .dungeon-status { font-family: var(--wow-mono); font-size: 10px; padding: 2px 6px; border-radius: 3px; }
    .wow-wrap .ds-unlocked { background: var(--wow-green-dim); color: var(--wow-green); border: 1px solid rgba(34,197,94,0.3); }
    .wow-wrap .ds-locked   { background: var(--wow-surface); color: var(--wow-muted); border: 1px solid var(--wow-border); }
    .wow-wrap .ds-current  { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,200,255,0.3); }
    
    .wow-wrap .char-bar { background: var(--wow-surface2); border-bottom: 1px solid var(--wow-border); padding: 0 20px; display: flex; align-items: stretch; position: sticky; top: 122px; z-index: 180; overflow: hidden; }
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
    .wow-wrap .char-chip.active { border-color: var(--wow-accent); color: var(--wow-text); background: var(--wow-accent-dim); box-shadow: 0 0 8px rgba(0,200,255,0.1); }
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
    @keyframes ptr-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
    .wow-ptr { display:flex; align-items:center; justify-content:center; overflow:hidden; transition:height 0.15s ease, opacity 0.15s ease; }
    .wow-ptr-icon { font-size:18px; color:var(--wow-muted); transition:transform 0.15s; }
    .wow-ptr-icon.ready { color:var(--wow-accent); }
    .wow-ptr-icon.spinning { animation:ptr-spin 0.8s linear infinite; color:var(--wow-accent); }
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
    .wow-wrap .cs-score { background: var(--wow-accent-dim); color: var(--wow-accent); border: 1px solid rgba(0,200,255,0.3); }
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
function WowOverview({ characters, charCacheRef, affixCacheRef, onSelectChar, onSubTab, dataTick, addon }) {
  // Addon rows are keyed "Name-Realm"; roster rows carry name + realm separately.
  const addonBy = {};
  for (const ac of (addon?.characters || [])) {
    if (ac.name && ac.realm) addonBy[`${ac.name}-${ac.realm}`.toLowerCase()] = ac;
  }
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
      for (let i = raids.length - 1; i >= 0; i--) {
        const data = raids[i][1];
        if (data.mythic_bosses_killed > 0) return `${data.mythic_bosses_killed}/${data.total_bosses}M`;
        if (data.heroic_bosses_killed > 0) return `${data.heroic_bosses_killed}/${data.total_bosses}H`;
        if (data.normal_bosses_killed > 0) return `${data.normal_bosses_killed}/${data.total_bosses}N`;
      }
      return '—';
    };
    const raid = raidSummary(rio?.raid_progression);
    const ad = addonBy[`${c.display_name}-${c.realm}`.toLowerCase()];
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
              ${ad?.gold != null ? html`<span class="cs cs-gold" style="color:var(--wow-gold);">${goldStr(ad.gold)} g</span>` : ''}
              ${ad?.keystone?.level ? html`<span class="cs cs-key" style="color:var(--wow-accent);">🗝 +${ad.keystone.level}</span>` : ''}
            </div>
          </div>
          <div class="main-nav-btn">
            <div class="nav-btn pve" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('pve'); }}>⚔ PVE</div>
            <div class="nav-btn pvp" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('pvp'); }}>🏆 PVP</div>
            <div class="nav-btn lvl" onClick=${e => { e.stopPropagation(); onSelectChar(i); onSubTab('world'); }}>🌍 COLL</div>
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
    { name: 'The War Within — Azj-Kahet',         min: 76, max: 80, done: lvl >= 80 },
  ];
}

function getDungeonUnlocks(lvl) {
  const status = (min) => lvl >= min ? (lvl === min ? 'ds-current' : 'ds-unlocked') : 'ds-locked';
  const label  = (min) => lvl >= min ? (lvl === min ? 'IN PROGRESS' : 'UNLOCKED') : 'LOCKED';
  return [
    { name: 'Normal Dungeons',  icon: '🗡️', status: status(10),  label: label(10)  },
    { name: 'Heroic Dungeons',  icon: '⚔️',  status: status(70),  label: label(70)  },
    { name: 'Mythic Dungeons',  icon: '💀',  status: status(70),  label: label(70)  },
    { name: 'Delves',           icon: '⛏️',  status: status(70),  label: label(70)  },
    { name: 'Mythic+ (Season)', icon: '🔑',  status: status(90),  label: label(90)  },
    { name: 'LFR Raid',         icon: '🏰',  status: status(90),  label: label(90)  },
    { name: 'Normal Raid',      icon: '🏰',  status: status(90),  label: label(90)  },
    { name: 'Heroic Raid',      icon: '🏰',  status: status(90),  label: label(90)  },
    { name: 'Mythic Raid',      icon: '👑',  status: status(90),  label: label(90)  },
  ];
}

// Professions + the materials calculator - split out of WowWorld (2026-09-11)
// once Collections grew to 9 cards; this one is a self-contained subsystem
// (its own recipe-detail fetch, its own expand/search state) and deserved a
// tab of its own rather than another card in an already-thick list.
function WowProfessions({ characters, activeChar, charCacheRef, dataTick, addon }) {
  const [expandedProf, setExpandedProf] = useState(null); // profession name string
  const [profRecipeSearch, setProfRecipeSearch] = useState('');
  const [recipeDetails, setRecipeDetails] = useState({}); // recipeID -> {iconUrl, productQuality, reagents}
  const [expandedRecipe, setExpandedRecipe] = useState(null); // recipeID or null

  // Fetches icon/reagents/quality for whichever profession is expanded, from
  // the shared wow_recipe_details/wow_recipe_icons cache (see server.js) -
  // not scoped to the search filter, since search is a client-side filter
  // over the same known-recipe set and re-fetching per keystroke would be
  // wasteful. Reads charCacheRef directly rather than the `c`/`bnet` derived
  // below because those come after this component's one early return
  // (no active character), and hooks can't sit after a conditional return.
  useEffect(() => {
    if (!expandedProf) return;
    const ch = characters[activeChar];
    if (!ch) return;
    const cacheKey = `${ch.region}-${ch.realm}-${ch.name}`;
    const bnetProfs = charCacheRef.current[cacheKey]?._bnet?.professions;
    const allProfs = [...(bnetProfs?.primaries || []), ...(bnetProfs?.secondaries || [])];
    const profData = allProfs.find(p => p.profession?.name === expandedProf);
    const ids = (profData?.tiers || []).flatMap(t => (t.known_recipes || []).map(r => r.id))
      .filter(id => Number.isInteger(id) && !(id in recipeDetails));
    if (!ids.length) return;
    req('/api/wow/recipes/details', { method: 'POST', body: JSON.stringify({ recipeIds: ids }) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.recipes) setRecipeDetails(prev => ({ ...prev, ...data.recipes }));
      })
      .catch(() => {});
  }, [expandedProf, activeChar]);

  const character = characters[activeChar];
  if (!character) return null;

  const cacheKey = `${character.region}-${character.realm}-${character.name}`;
  const c = charCacheRef.current[cacheKey] || {};
  const bnet = c._bnet || {};

  const addonChar = (addon?.characters || [])
    .find(ac => `${ac.name}-${ac.realm}`.toLowerCase() === `${character.name}-${character.realm}`.toLowerCase())
    || null;
  // Knowledge points and spec-tab state live only in the addon feed
  // (Blizzard's public Profile API has no Knowledge/spec-tree field at
  // all), keyed by the real per-tier skillLine id, not the parent
  // profession id bnet.professions uses.
  const addonProfSpecs = addonChar?.professionSpecs || [];

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
        const expandedProfClean = expandedProf ? expandedProf.replace(/^(Khaz Algar |Dragon Isles |Shadowlands |Kul Tiran |Zandalari )/i, '') : '';
        const expandedSpecs = expandedProf ? addonProfSpecs.filter(s => s.name && s.name.includes(expandedProfClean)) : [];

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

              // addonProfSpecs entries are named per-tier ("Midnight Mining",
              // "Khaz Algar Mining"...), not the base profession name bnet
              // uses - match on substring, then sum unspent Knowledge across
              // every tier this profession has, since a player can carry
              // unspent points in more than one tier's tree at once (e.g.
              // fully spent this tier, 7 sitting idle in the previous one).
              const specEntries = addonProfSpecs.filter(s => s.name && s.name.includes(cleanName));
              const knowledgeUnspent = specEntries.reduce((n, s) => n + (s.knowledgeAvailable || 0), 0);

              return html`
                <div style="background:var(--wow-surface2);border:1px solid ${isExpanded ? 'var(--wow-gold)' : 'var(--wow-border)'};border-radius:4px;padding:10px;cursor:${recipeCount > 0 ? 'pointer' : 'default'};"
                     onClick=${() => recipeCount > 0 && (isExpanded ? setExpandedProf(null) : (setExpandedProf(profName), setProfRecipeSearch('')))}>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <div style="width:24px;height:24px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:14px;">${icon}</div>
                    <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;" title="${profName}">${cleanName}</div>
                    ${knowledgeUnspent > 0 ? html`<span title="${knowledgeUnspent} unspent Knowledge point${knowledgeUnspent===1?'':'s'}" style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-bg);background:var(--wow-gold);border-radius:3px;padding:1px 5px;font-weight:700;">📖 ${knowledgeUnspent}</span>` : ''}
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
              ${expandedSpecs.length > 0 && html`
                <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--wow-border2);">
                  ${expandedSpecs.map(s => html`
                    <div style="margin-bottom:8px;">
                      <div style="display:flex;align-items:center;justify-content:space-between;font-family:var(--wow-mono);font-size:11px;margin-bottom:4px;">
                        <span style="color:var(--wow-text);">${s.name}</span>
                        <span style="color:${s.knowledgeAvailable > 0 ? 'var(--wow-gold)' : 'var(--wow-muted)'};">📖 ${s.knowledgeAvailable || 0} unspent</span>
                      </div>
                      <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${(s.tabs || []).map(t => {
                          // ProfessionsSpecTabState: 0 Locked, 1 Unlocked, 2 Unlockable
                          const label = t.state === 1 ? 'Unlocked' : t.state === 2 ? 'Unlockable' : 'Locked';
                          const color = t.state === 1 ? 'var(--wow-green)' : t.state === 2 ? 'var(--wow-gold)' : 'var(--wow-muted)';
                          return html`<span style="font-family:var(--wow-mono);font-size:10px;color:${color};border:1px solid ${color};border-radius:3px;padding:2px 6px;" title="${label}">${t.name || ('Tab ' + t.tabTreeID)}</span>`;
                        })}
                      </div>
                    </div>`)}
                </div>`}
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
                    <div style="display:flex;flex-direction:column;gap:4px;">
                      ${recipes.map(r => {
                        const det = recipeDetails[r.id];
                        const isRecipeExpanded = expandedRecipe === r.id;
                        const reagents = det?.reagents || [];
                        // Owned count comes from the addon's own bag+bank scan
                        // (addonChar.bags/bank), not bnet - materials aren't
                        // gear, there's no Web API for "what's in my bags".
                        const ownedById = new Map();
                        for (const it of [...(addonChar?.bags || []), ...(addonChar?.bank || [])]) {
                          if (it?.id != null) ownedById.set(it.id, (ownedById.get(it.id) || 0) + (it.count || 0));
                        }
                        return html`
                        <div style="background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;">
                          <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:${reagents.length ? 'pointer' : 'default'};"
                               onClick=${e => { e.stopPropagation(); if (reagents.length) setExpandedRecipe(isRecipeExpanded ? null : r.id); }}>
                            ${det?.iconUrl
                              ? html`<img src=${det.iconUrl} style="width:18px;height:18px;border-radius:2px;border:1px solid var(--wow-border2);flex-shrink:0;" />`
                              : html`<div style="width:18px;height:18px;border-radius:2px;border:1px solid var(--wow-border2);flex-shrink:0;"></div>`}
                            ${det?.outputItemID
                              ? html`<a href="https://www.wowhead.com/item=${det.outputItemID}" target="_blank" rel="noopener" class="recipe-link"
                                       style="font-size:11px;font-family:var(--wow-mono);color:var(--wow-text);text-decoration:none;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                                       onMouseover=${e => e.target.style.color='var(--wow-gold)'}
                                       onMouseout=${e => e.target.style.color='var(--wow-text)'}
                                       onClick=${e => e.stopPropagation()}>
                                      ${r.name}
                                    </a>`
                              : html`<span class="recipe-link" style="font-size:11px;font-family:var(--wow-mono);color:var(--wow-text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</span>`}
                            ${det?.productQuality != null && html`<span title="Recipe-reported crafting quality" style="font-size:9px;font-family:var(--wow-mono);color:var(--wow-gold);border:1px solid var(--wow-gold);border-radius:2px;padding:0 3px;flex-shrink:0;">Q${det.productQuality}</span>`}
                            ${reagents.length > 0 && html`<span style="font-size:10px;color:var(--wow-muted);">${isRecipeExpanded ? '▲' : '▼'}</span>`}
                          </div>
                          ${isRecipeExpanded && reagents.length > 0 && html`
                            <div style="padding:6px 8px 8px 8px;border-top:1px solid var(--wow-border2);display:flex;flex-direction:column;gap:4px;">
                              ${reagents.map(rg => {
                                // A slot can offer several interchangeable item
                                // choices (e.g. quality tiers of the same
                                // material) - any one satisfying the quantity
                                // is enough, so show whichever choice the
                                // player is best-stocked on, defaulting to the
                                // first (Blizzard's own default pick) if none
                                // are owned at all.
                                const choices = rg.choices || [];
                                let best = choices[0];
                                let bestOwned = best ? (ownedById.get(best.itemID) || 0) : 0;
                                for (const ch of choices) {
                                  const o = ownedById.get(ch.itemID) || 0;
                                  if (o > bestOwned) { best = ch; bestOwned = o; }
                                }
                                if (!best) return '';
                                const have = bestOwned >= rg.quantity;
                                const altCount = choices.length - 1;
                                // unitPrice is raw copper (Blizzard convention, same /10000
                                // as the token price chip) and null for non-commodity
                                // reagents (soulbound/unique materials are never AH-tradeable).
                                // history is 30 days of daily min prices, oldest first - a
                                // 7-day-ago comparison is a light-touch "trending up/down"
                                // signal, not a real chart.
                                const priceGold = best.unitPrice != null ? Math.floor(best.unitPrice / 10000) : null;
                                const hist = best.history || [];
                                const weekAgo = hist.length >= 8 ? hist[hist.length - 8] : hist[0];
                                const trend = (priceGold != null && weekAgo && best.unitPrice !== weekAgo.minPrice)
                                  ? (best.unitPrice > weekAgo.minPrice ? 'up' : 'down') : null;
                                return html`
                                  <div style="display:flex;align-items:center;gap:6px;font-family:var(--wow-mono);font-size:11px;">
                                    ${best.iconUrl
                                      ? html`<img src=${best.iconUrl} style="width:16px;height:16px;border-radius:2px;border:1px solid var(--wow-border2);flex-shrink:0;" />`
                                      : html`<div style="width:16px;height:16px;border-radius:2px;border:1px solid var(--wow-border2);flex-shrink:0;"></div>`}
                                    <a href="https://www.wowhead.com/item=${best.itemID}" target="_blank" rel="noopener" class="recipe-link"
                                       style="color:${have ? 'var(--wow-text)' : 'var(--wow-muted)'};text-decoration:none;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                                       onClick=${e => e.stopPropagation()}>${best.name || ('Item #' + best.itemID)}</a>
                                    ${priceGold != null && html`
                                      <span title="Lowest current AH price${trend ? (trend === 'up' ? ' — up from a week ago' : ' — down from a week ago') : ''}"
                                            style="font-size:9px;color:var(--wow-gold);flex-shrink:0;white-space:nowrap;">
                                        ${goldStr(priceGold)} g${trend === 'up' ? html`<span style="color:var(--wow-red);"> ▲</span>` : trend === 'down' ? html`<span style="color:var(--wow-green);"> ▼</span>` : ''}
                                      </span>`}
                                    ${altCount > 0 && html`<span title="${altCount} other quality tier${altCount === 1 ? '' : 's'} also accepted" style="font-size:9px;color:var(--wow-muted);flex-shrink:0;">+${altCount}</span>`}
                                    <span style="color:${have ? 'var(--wow-green)' : 'var(--wow-red)'};font-weight:600;flex-shrink:0;">${bestOwned} / ${rg.quantity}</span>
                                  </div>`;
                              })}
                            </div>`}
                        </div>`;
                      })}
                    </div>
                  </div>`)}
            </div>
          ` : ''}`;
      }
      return html`<div class="empty" style="padding:10px;">No professions learned.</div>`;
    }
    return html`<div class="empty" style="padding:16px;">Profession data unavailable.</div>`;
  };

  return html`
    <${WowCharIdent} character=${character} />
    <div class="layout-full">
      <div class="wow-card">
        <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Professions</div></div>
        <div class="card-body">${renderProfessions()}</div>
      </div>
    </div>
  `;
}

// Renders a 30-day min-price history as a plain inline SVG polyline - no
// charting library is loaded anywhere in this codebase (static/wow.js has
// no build step and is served raw), and 30 points is a trivial polyline per
// the AH tab plan doc. history is oldest-first, one row per UTC day,
// min_price in copper.
function WowAHSparkline({ history }) {
  if (!history || history.length < 2) return html`<div style="color:var(--wow-muted);font-size:11px;">Not enough history yet.</div>`;
  const W = 280, H = 60, PAD = 4;
  const prices = history.map(h => h.minPrice);
  const min = Math.min(...prices), max = Math.max(...prices);
  const span = max - min || 1;
  const points = history.map((h, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (h.minPrice - min) / span) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = prices[prices.length - 1], first = prices[0];
  const lineColor = last > first ? 'var(--wow-red)' : last < first ? 'var(--wow-green)' : 'var(--wow-gold)';
  return html`
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block;">
      <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
    <div style="display:flex;justify-content:space-between;font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);margin-top:2px;">
      <span>${history[0].date}</span>
      <span>${goldStr(Math.floor(min / 10000))}g &ndash; ${goldStr(Math.floor(max / 10000))}g</span>
      <span>${history[history.length - 1].date}</span>
    </div>`;
}

// Auction House tab: search any commodity by name, see its full 30-day
// history. Deliberately NOT a client-side filter over a pre-fetched list
// (wow_commodity_names is ~10,123 rows once warm - shipping that whole
// index to the browser up front was the plan doc's original idea, dropped
// once search/item's id-range paging turned out not to help here either;
// a small SQL LIKE query per keystroke is far cheaper). Debounced since
// this hits the server per query, unlike every other search box in this
// file (all client-side filters over already-loaded data).
function WowAH({ tokenPrice, tokenTrend }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null); // itemId or null
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [movers, setMovers] = useState(null); // null = not loaded yet
  const [crafts, setCrafts] = useState(null);
  // Browse mode (2026-09-11) - a folder-tree style alternative to name
  // search, matching the real in-game AH's category sidebar. Separate mode
  // rather than merged into search since browsing has its own navigation
  // stack (category -> subcategory -> item list -> item detail) that
  // doesn't map onto a single query string.
  const [mode, setMode] = useState('search'); // 'search' | 'browse'
  const [categories, setCategories] = useState(null); // null = not loaded yet
  const [browseCategory, setBrowseCategory] = useState(null); // {category, subcategory|null} or null
  const [browseItems, setBrowseItems] = useState(null);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  // Recently viewed - deliberately component state, not localStorage: this
  // is a lightweight "don't lose your place" convenience for the current
  // session, not something that needs to survive a reload or sync across
  // devices (nothing else in this file uses localStorage for feature data,
  // only auth tokens - see authPair()).
  const [recentlyViewed, setRecentlyViewed] = useState([]); // [{itemId, name, iconUrl, unitPrice}]
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      req(`/api/wow/ah/search?q=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(data => setResults(data.results || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Landing content - fetched once on mount, not gated behind a search.
  // Both endpoints already apply WOW_JUNK_PRICE_CEILING server-side (see
  // server.js) to exclude troll-priced listings (confirmed live 2026-09-11:
  // players list items near the game's actual price cap to hide them from
  // AH browse, which without this filter turned a classic Thorium Shield
  // Spike into an apparent 50,000g item and inflated "profit" numbers into
  // the millions).
  useEffect(() => {
    req('/api/wow/ah/movers').then(r => r.ok ? r.json() : null).then(d => setMovers(d?.movers || [])).catch(() => setMovers([]));
    req('/api/wow/ah/crafts').then(r => r.ok ? r.json() : null).then(d => setCrafts(d?.crafts || [])).catch(() => setCrafts([]));
  }, []);

  // Category list fetched once on first switch to Browse mode, not on
  // mount - most sessions probably never open Browse, so this avoids an
  // extra request most page loads don't need.
  useEffect(() => {
    if (mode === 'browse' && categories === null) {
      req('/api/wow/ah/categories').then(r => r.ok ? r.json() : null).then(d => setCategories(d?.categories || [])).catch(() => setCategories([]));
    }
  }, [mode]);

  const openCategory = (category, subcategory, offset) => {
    setBrowseCategory({ category, subcategory: subcategory || null });
    setBrowseOffset(offset || 0);
    setBrowseLoading(true);
    setBrowseItems(null);
    const params = new URLSearchParams({ category, offset: String(offset || 0) });
    if (subcategory) params.set('subcategory', subcategory);
    req(`/api/wow/ah/browse?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setBrowseItems(d?.items || []); setBrowseTotal(d?.total || 0); })
      .catch(() => { setBrowseItems([]); setBrowseTotal(0); })
      .finally(() => setBrowseLoading(false));
  };

  const openItem = (itemId, hint) => {
    setSelected(itemId);
    setDetail(null);
    setDetailLoading(true);
    req(`/api/wow/ah/item/${itemId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setDetail(data);
        if (data) {
          setRecentlyViewed(prev => [
            { itemId, name: data.name || hint?.name, iconUrl: data.iconUrl || hint?.iconUrl, unitPrice: data.unitPrice },
            ...prev.filter(r => r.itemId !== itemId),
          ].slice(0, 8));
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  };

  // Same 7-day trend convention as the reagent prices / WoW Token chip
  // elsewhere in this file - not a real chart signal, just a light-touch cue.
  const trendFor = (unitPrice, history) => {
    if (unitPrice == null || !history?.length) return null;
    const hist = history;
    const weekAgo = hist.length >= 8 ? hist[hist.length - 8] : hist[0];
    if (!weekAgo || unitPrice === weekAgo.minPrice) return null;
    return unitPrice > weekAgo.minPrice ? 'up' : 'down';
  };

  const showLanding = mode === 'search' && selected == null && query.trim().length < 2;
  const itemRow = (r, onClick) => {
    const priceGold = r.unitPrice != null ? Math.floor(r.unitPrice / 10000) : null;
    return html`
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;cursor:pointer;"
           onClick=${onClick}>
        ${r.iconUrl
          ? html`<img src=${r.iconUrl} style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;" />`
          : html`<div style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;"></div>`}
        <span style="flex:1;font-family:var(--wow-mono);font-size:12px;color:var(--wow-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name || ('Item #' + r.itemId)}</span>
        <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);flex-shrink:0;">${priceGold != null ? goldStr(priceGold) + ' g' : '—'}</span>
      </div>`;
  };

  return html`
    <div class="layout-full">
      <div class="wow-card">
        <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Auction House</div></div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <div style="display:flex;gap:4px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:4px;padding:2px;">
              <div style="padding:5px 12px;border-radius:3px;cursor:pointer;font-family:var(--wow-mono);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;${mode === 'search' ? 'background:var(--wow-surface2);color:var(--wow-text);' : 'color:var(--wow-muted);'}"
                   onClick=${() => setMode('search')}>Search</div>
              <div style="padding:5px 12px;border-radius:3px;cursor:pointer;font-family:var(--wow-mono);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;${mode === 'browse' ? 'background:var(--wow-surface2);color:var(--wow-text);' : 'color:var(--wow-muted);'}"
                   onClick=${() => { setMode('browse'); setSelected(null); }}>Browse</div>
            </div>
            ${mode === 'search' ? html`<input type="text" placeholder="Search any item..." class="admin-input" style="flex:1;max-width:400px;"
                   value=${query} onInput=${e => { setQuery(e.target.value); setSelected(null); }} />` : ''}
            <div class="wow-token-chip" style="margin-left:auto;" title="WoW Token — current buy price on the US region auction house.">
              <img src="${ASSETS}/wow-token.svg" class="wow-token-icon" alt="" onerror=${e => { e.target.style.display = 'none'; }} />
              <span class="wow-token-label">token</span>
              <span class="wow-token-price">${tokenPrice}${tokenTrend === 'up' ? html`<span style="color:var(--wow-red);"> ▲</span>` : tokenTrend === 'down' ? html`<span style="color:var(--wow-green);"> ▼</span>` : ''}</span>
            </div>
          </div>

          ${showLanding ? html`
            ${recentlyViewed.length > 0 ? html`
              <div style="margin-bottom:14px;">
                <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:6px;">RECENTLY VIEWED</div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                  ${recentlyViewed.map(r => itemRow(r, () => openItem(r.itemId, r)))}
                </div>
              </div>` : ''}

            <div style="margin-bottom:14px;">
              <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:6px;">BIGGEST MOVERS</div>
              ${movers === null ? html`<div style="color:var(--wow-muted);font-size:12px;">Loading...</div>` : ''}
              ${movers && movers.length === 0 ? html`<div class="empty" style="padding:10px;">Still building price history — check back in a few days.</div>` : ''}
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${(movers || []).map(m => {
                  const priceGold = m.currentPrice != null ? Math.floor(m.currentPrice / 10000) : null;
                  const pct = Math.round(m.pctChange * 100);
                  const up = m.pctChange > 0;
                  return html`
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;cursor:pointer;"
                         onClick=${() => openItem(m.itemId, m)}>
                      ${m.iconUrl
                        ? html`<img src=${m.iconUrl} style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;" />`
                        : html`<div style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;"></div>`}
                      <span style="flex:1;font-family:var(--wow-mono);font-size:12px;color:var(--wow-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name || ('Item #' + m.itemId)}</span>
                      <span style="font-family:var(--wow-mono);font-size:11px;color:${up ? 'var(--wow-red)' : 'var(--wow-green)'};flex-shrink:0;">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>
                      <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);flex-shrink:0;width:60px;text-align:right;">${priceGold != null ? goldStr(priceGold) + ' g' : '—'}</span>
                    </div>`;
                })}
              </div>
            </div>

            <div>
              <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:6px;" title="Crafted item's AH price minus reagent costs, cheapest quality tier per slot. Only shown for recipes this server has captured details for via the addon.">CRAFTING PROFIT (COMMODITY CRAFTS)</div>
              ${crafts === null ? html`<div style="color:var(--wow-muted);font-size:12px;">Loading...</div>` : ''}
              ${crafts && crafts.length === 0 ? html`<div class="empty" style="padding:10px;">No craftable-commodity data yet.</div>` : ''}
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${(crafts || []).slice(0, 10).map(c => {
                  const profitGold = Math.floor(c.profit / 10000);
                  const profitable = c.profit > 0;
                  return html`
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;cursor:pointer;"
                         onClick=${() => openItem(c.outputItemId, { name: c.outputName, iconUrl: c.iconUrl })}>
                      ${c.iconUrl
                        ? html`<img src=${c.iconUrl} style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;" />`
                        : html`<div style="width:24px;height:24px;border-radius:3px;border:1px solid var(--wow-border2);flex-shrink:0;"></div>`}
                      <span style="flex:1;font-family:var(--wow-mono);font-size:12px;color:var(--wow-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.outputName || ('Item #' + c.outputItemId)}</span>
                      <span style="font-family:var(--wow-mono);font-size:11px;color:${profitable ? 'var(--wow-green)' : 'var(--wow-red)'};flex-shrink:0;">${profitable ? '+' : ''}${goldStr(profitGold)} g</span>
                    </div>`;
                })}
              </div>
            </div>
          ` : ''}

          ${mode === 'search' && selected == null && query.trim().length >= 2 ? html`
            ${searching ? html`<div style="color:var(--wow-muted);font-size:12px;">Searching...</div>` : ''}
            ${!searching && results.length === 0 ? html`<div class="empty" style="padding:10px;">No commodities matched.</div>` : ''}
            <div style="display:flex;flex-direction:column;gap:4px;">
              ${results.map(r => itemRow(r, () => openItem(r.itemId, r)))}
            </div>
          ` : ''}

          ${mode === 'browse' && selected == null ? html`
            ${browseCategory == null ? html`
              ${categories === null ? html`<div style="color:var(--wow-muted);font-size:12px;">Loading categories...</div>` : ''}
              ${categories && categories.length === 0 ? html`<div class="empty" style="padding:10px;">Category data still building — check back in a day.</div>` : ''}
              <div style="display:flex;flex-direction:column;gap:10px;">
                ${(categories || []).map(c => html`
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;cursor:pointer;font-family:var(--wow-display);font-weight:600;"
                         onClick=${() => openCategory(c.category)}>
                      <span style="flex:1;">${c.category}</span>
                      <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">${c.count}</span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding-left:8px;">
                      ${c.subcategories.map(s => html`
                        <div style="padding:3px 8px;background:var(--wow-bg);border:1px solid var(--wow-border2);border-radius:3px;cursor:pointer;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);"
                             onClick=${() => openCategory(c.category, s.subcategory)}>${s.subcategory} <span style="opacity:0.6;">${s.count}</span></div>
                      `)}
                    </div>
                  </div>
                `)}
              </div>
            ` : html`
              <div style="cursor:pointer;color:var(--wow-muted);font-family:var(--wow-mono);font-size:11px;margin-bottom:10px;" onClick=${() => { setBrowseCategory(null); setBrowseItems(null); }}>&larr; all categories</div>
              <div style="font-family:var(--wow-display);font-weight:600;margin-bottom:8px;">${browseCategory.category}${browseCategory.subcategory ? ' / ' + browseCategory.subcategory : ''}</div>
              ${browseLoading ? html`<div style="color:var(--wow-muted);font-size:12px;">Loading...</div>` : ''}
              ${!browseLoading && browseItems && browseItems.length === 0 ? html`<div class="empty" style="padding:10px;">No items found.</div>` : ''}
              <div style="display:flex;flex-direction:column;gap:4px;">
                ${(browseItems || []).map(r => itemRow(r, () => openItem(r.itemId, r)))}
              </div>
              ${browseTotal > 50 ? html`
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">
                  <span onClick=${() => browseOffset > 0 && openCategory(browseCategory.category, browseCategory.subcategory, Math.max(0, browseOffset - 50))}
                        style="cursor:${browseOffset > 0 ? 'pointer' : 'default'};opacity:${browseOffset > 0 ? 1 : 0.4};">&larr; prev</span>
                  <span>${browseOffset + 1}-${Math.min(browseOffset + 50, browseTotal)} of ${browseTotal}</span>
                  <span onClick=${() => browseOffset + 50 < browseTotal && openCategory(browseCategory.category, browseCategory.subcategory, browseOffset + 50)}
                        style="cursor:${browseOffset + 50 < browseTotal ? 'pointer' : 'default'};opacity:${browseOffset + 50 < browseTotal ? 1 : 0.4};">next &rarr;</span>
                </div>
              ` : ''}
            `}
          ` : ''}

          ${selected != null ? html`
            <div style="cursor:pointer;color:var(--wow-muted);font-family:var(--wow-mono);font-size:11px;margin-bottom:10px;" onClick=${() => setSelected(null)}>&larr; ${mode === 'browse' ? 'back to browse' : (query.trim().length >= 2 ? 'back to search' : 'back')}</div>
            ${detailLoading ? html`<div style="color:var(--wow-muted);font-size:12px;">Loading...</div>` : ''}
            ${!detailLoading && !detail ? html`<div class="empty" style="padding:10px;">Item not found.</div>` : ''}
            ${!detailLoading && detail ? (() => {
              const priceGold = detail.unitPrice != null ? Math.floor(detail.unitPrice / 10000) : null;
              const trend = trendFor(detail.unitPrice, detail.history);
              return html`
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                  ${detail.iconUrl
                    ? html`<img src=${detail.iconUrl} style="width:40px;height:40px;border-radius:4px;border:1px solid var(--wow-border2);" />`
                    : html`<div style="width:40px;height:40px;border-radius:4px;border:1px solid var(--wow-border2);"></div>`}
                  <div style="flex:1;">
                    <a href="https://www.wowhead.com/item=${detail.itemId}" target="_blank" rel="noopener" class="recipe-link"
                       style="font-family:var(--wow-display);font-size:15px;color:var(--wow-text);text-decoration:none;">${detail.name || ('Item #' + detail.itemId)}</a>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-family:var(--wow-mono);font-size:16px;color:var(--wow-gold);">
                      ${priceGold != null ? goldStr(priceGold) + ' g' : '—'}${trend === 'up' ? html`<span style="color:var(--wow-red);"> ▲</span>` : trend === 'down' ? html`<span style="color:var(--wow-green);"> ▼</span>` : ''}
                    </div>
                    ${detail.quantity != null ? html`<div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${detail.quantity.toLocaleString()} available</div>` : ''}
                  </div>
                </div>
                ${detail.advice ? (() => {
                  const p = detail.advice.percentile;
                  // Buying advice: percentile of the current price within
                  // the stored range for this item (0% = cheapest seen,
                  // 100% = priciest seen) - see server.js for why percentile
                  // was picked over a plain average, and why it's withheld
                  // (advice is null, this block never renders) until
                  // WOW_AH_ADVICE_MIN_DAYS days of real history exist.
                  const good = p <= 33, bad = p >= 67;
                  const label = good ? 'Good time to buy' : bad ? 'Poor time to buy' : 'Average price';
                  const color = good ? 'var(--wow-green)' : bad ? 'var(--wow-red)' : 'var(--wow-gold)';
                  return html`
                    <div style="display:flex;align-items:center;gap:8px;background:var(--wow-surface2);border:1px solid ${color};border-radius:4px;padding:8px 10px;margin-bottom:12px;">
                      <span style="font-family:var(--wow-display);font-weight:600;color:${color};flex:1;">${label}</span>
                      <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);" title="Current price's position within the ${detail.advice.daysOfHistory}-day range on file (${goldStr(Math.floor(detail.advice.lowPrice/10000))}g – ${goldStr(Math.floor(detail.advice.highPrice/10000))}g)">${p}th percentile · ${detail.advice.daysOfHistory}d history</span>
                    </div>`;
                })() : ''}
                <div style="background:var(--wow-surface2);border:1px solid var(--wow-border2);border-radius:4px;padding:10px;">
                  <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:6px;">30-DAY PRICE HISTORY</div>
                  <${WowAHSparkline} history=${detail.history} />
                </div>`;
            })() : ''}
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function WowWorld({ characters, activeChar, charCacheRef, bnetTokenRef, collectionsRef, decorCatalogRef, petCatalogRef, mountSpellIdsRef, dataTick, addon }) {
  const [colView, setColView] = useState(null); // 'mounts' | 'pets' | null
  const [colSearch, setColSearch] = useState('');
  const [colCompareIdx, setColCompareIdx] = useState(-1);
  const [loadingCol, setLoadingCol] = useState(false);
  const [colError, setColError] = useState(false);
  const [decorFilter, setDecorFilter] = useState('all'); // category name or 'all'
  const [decorSearch, setDecorSearch] = useState('');
  const [decorShowMissing, setDecorShowMissing] = useState(false);
  const [, forceDecorTick] = useState(0); // re-render once the lazy catalogue fetch below lands
  const [, forcePetTick] = useState(0); // re-render once the lazy pet catalogue fetch lands
  const [, forceMountTick] = useState(0); // re-render once the lazy mount spell-id fetch lands

  const character = characters[activeChar];
  if (!character) return null;

  const cacheKey = `${character.region}-${character.realm}-${character.name}`;
  const c = charCacheRef.current[cacheKey] || {};
  const bnet = c._bnet || {};

  // The addon roster is keyed "Name-Realm" and is the only source for an owned
  // house (no Web API exposes one), so pair it with the Blizzard cache here.
  const addonChar = (addon?.characters || [])
    .find(ac => `${ac.name}-${ac.realm}`.toLowerCase() === `${character.name}-${character.realm}`.toLowerCase())
    || null;
  const addonHousing = addonChar?.housing || null;

  const lvl = bnet?.profile?.level || c.level || 90;
  const maxLvl = 90;
  const isMax = lvl >= maxLvl;
  const pct = isMax ? 100 : Math.round((lvl / maxLvl) * 100);

  const openCollection = async (type) => {
    setColView(type);
    setColSearch('');
    setColCompareIdx(-1);

    // Pet npc-id catalogue, fetched once and shared across the whole WoW
    // tab (mirrors decorCatalogRef) - only pets need this, mounts have no
    // equivalent server-side fix (see the wow_mount_spell_ids comment).
    if (type === 'pets' && petCatalogRef && petCatalogRef.current === null) {
      petCatalogRef.current = 'loading';
      req('/api/wow/pet/catalog')
        .then(res => res.ok ? res.json() : null)
        .then(d => {
          const map = new Map();
          for (const row of (d?.pets || [])) map.set(row.id, row);
          petCatalogRef.current = map;
          forcePetTick(t => t + 1);
        })
        .catch(() => { petCatalogRef.current = new Map(); forcePetTick(t => t + 1); });
    }

    // Whatever mount spellIDs someone's addon has already captured -
    // account-agnostic, shared across the tab. No bulk source exists for
    // this (see wow_mount_spell_ids), so it is only ever partial coverage,
    // same nature as housing/decor before enough people have synced.
    if (type === 'mounts' && mountSpellIdsRef && mountSpellIdsRef.current === null) {
      mountSpellIdsRef.current = 'loading';
      req('/api/wow/mount/spell-ids')
        .then(res => res.ok ? res.json() : null)
        .then(d => {
          const map = new Map();
          for (const row of (d?.mounts || [])) map.set(row.mountId, row.spellId);
          mountSpellIdsRef.current = map;
          forceMountTick(t => t + 1);
        })
        .catch(() => { mountSpellIdsRef.current = new Map(); forceMountTick(t => t + 1); });
    }

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
          boxStyle = 'background:var(--wow-surface2);border:1px solid rgba(0,200,255,0.4);';
          badgeHtml = html`<div style="font-family:var(--wow-mono);font-size:9px;background:rgba(0,200,255,0.1);color:var(--wow-accent);padding:2px 6px;border-radius:3px;">Both Have</div>`;
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

      // item.id here is Blizzard's Game Data id (mount.id / pet species.id),
      // NOT the id Wowhead's own pages use - confirmed live 2026-09-10 that
      // linking with it directly 404s. Resolve the real Wowhead id from the
      // matching catalogue/lookup; render plain (unlinked) text rather than
      // a link that is guaranteed to 404 when no mapping is available yet -
      // mounts in particular are only ever as complete as what someone's
      // addon has actually captured (no bulk source exists for them at all).
      let whHref = null, whType = null, whId = null;
      if (colView === 'mounts') {
        const spellId = mountSpellIdsRef?.current instanceof Map ? mountSpellIdsRef.current.get(item.id) : null;
        if (spellId) { whType = 'spell'; whId = spellId; whHref = `https://www.wowhead.com/spell=${spellId}`; }
      } else {
        const petRow = petCatalogRef?.current instanceof Map ? petCatalogRef.current.get(item.id) : null;
        if (petRow?.npcId) { whType = 'npc'; whId = petRow.npcId; whHref = `https://www.wowhead.com/npc=${petRow.npcId}`; }
      }

      gridItems.push(html`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:4px;transition:all 0.15s;${boxStyle}">
          <div style="font-family:var(--wow-display);font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%;">
            ${whHref
              ? html`<a href="${whHref}" target="_blank" style="${textStyle}text-decoration:none;" data-wowhead="${whType}=${whId}">${item.name}</a>`
              : html`<span style="${textStyle}">${item.name}</span>`}
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

  // Player Estate. Two independent sources, either of which can be absent:
  //   - bnet.decor  : /collections/decor, the character's collected decor.
  //   - addonHousing: C_Housing capture (owned houses, neighborhood, favor).
  // The house record itself has no Web API - /profile/.../house/{id} exists
  // but was withdrawn by Blizzard after privacy concerns (still 404s as of
  // 2026-09, confirmed live against several id's) - so an owned house only
  // ever appears once the addon has run.
  //
  // decorCatalogRef holds the ~2,138-row static reference catalogue
  // (id/name/icon/category), shared across every character via the ref
  // threaded down from WowTab. Fetched once, lazily, the first time this
  // card actually renders - not on every WoW-tab open - since most sessions
  // never look at housing.
  if (decorCatalogRef && decorCatalogRef.current === null) {
    decorCatalogRef.current = 'loading';
    req('/api/wow/decor/catalog')
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        const map = new Map();
        for (const row of (d?.decor || [])) map.set(row.id, row);
        decorCatalogRef.current = map;
        forceDecorTick(t => t + 1);
      })
      .catch(() => { decorCatalogRef.current = new Map(); forceDecorTick(t => t + 1); });
  }

  const renderHousing = () => {
    const collected = bnet?.decor?.decor_collected || [];
    // An older client may still send houses as a Lua map ({}), not an array.
    const rawHouses = addonHousing?.houses;
    const houses = (Array.isArray(rawHouses) ? rawHouses
      : rawHouses && typeof rawHouses === 'object' ? Object.values(rawHouses)
      : []).filter(Boolean);
    const hasAnything = collected.length > 0 || houses.length > 0;

    if (!hasAnything) {
      const noAccess = addonHousing && addonHousing.hasAccess === false;
      return html`
        <div class="empty" style="padding:16px;gap:8px;">
          <div style="font-size:28px;">🏕️</div>
          <div style="font-size:13px;color:var(--wow-muted);text-align:center;line-height:1.5;">
            ${noAccess
              ? html`This account does not have housing access yet.`
              : html`No estate data yet.<br/><span style="font-size:11px;">Collect decor or claim a plot, then log out to sync.</span>`}
          </div>
        </div>`;
    }

    const totalDecor = collected.reduce((n, d) => n + (d.quantity || 1), 0);

    // Catalogue may still be loading (string 'loading') or unavailable
    // (empty Map on fetch failure) - the card degrades to the name-only list
    // rather than blocking on it, same principle as the rest of the tab.
    const catalog = decorCatalogRef?.current instanceof Map ? decorCatalogRef.current : null;
    const catalogReady = catalog != null && catalog.size > 0;

    // Join each collected decor row against the catalogue for icon/category.
    // decor.id -> catalogue key, verified 100% join rate live (2026-09-09)
    // against three real collections (341, 184, 53 unique items).
    const joined = collected.map(d => {
      const meta = catalog?.get(d.decor?.id);
      return {
        id: d.decor?.id,
        name: meta?.name || d.decor?.name || 'Unknown',
        quantity: d.quantity || 1,
        iconUrl: meta?.iconUrl || null,
        category: meta?.category || 'Other',
        itemId: meta?.itemId || null,
      };
    });

    const categories = catalogReady
      ? [...new Set(joined.map(j => j.category))].sort()
      : [];

    const q = decorSearch.trim().toLowerCase();
    const ownedIds = new Set(joined.map(j => j.id));
    const missing = catalogReady && decorShowMissing
      ? [...catalog.values()].filter(c => !ownedIds.has(c.id))
      : [];

    const visibleOwned = joined
      .filter(j => decorFilter === 'all' || j.category === decorFilter)
      .filter(j => !q || j.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const visibleMissing = missing
      .filter(c => decorFilter === 'all' || c.category === decorFilter)
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Clicking a tile opens the decor's Wowhead item page in a new tab,
    // where Wowhead's own "View in 3D" button already exists and works
    // (confirmed live 2026-09-10 on a real decor item) - GamezNET renders
    // nothing 3D itself, just links to where it already works.
    //
    // This is deliberately NOT a real <a href="wowhead.com/..."> - two
    // earlier attempts at that both broke the icon grid on the desktop host
    // in production (2026-09-10, both reported by Nate with screenshots),
    // and tracing power.js's actual source (a public gist of an older
    // version - no official docs cover this) explains why the SECOND fix
    // (data-wowhead removed, still a real href) didn't help either: power.js
    // does not gate on the data-wowhead attribute at all. It iterates
    // document.links (every <a>/<area> with an href, full stop) and
    // regex-matches the HREF itself against wowhead.com/item=<id> etc. -
    // any link whose href matches gets iconizeLinks/renameLinks treatment
    // whether or not data-wowhead is present. DollSlot's link survives this
    // because it wraps real name TEXT that power.js's injected
    // padding-left+background-image icon and text-replacement land on
    // harmlessly; this tile has no text node, only a full-size <img>, so the
    // same injection visually collided both times. Fix: use a <div> with a
    // click handler that opens the URL via window.open() instead of a real
    // href - power.js's document.links scan never sees it, because a div
    // with onClick is not in that collection at all. Costs nothing: the
    // goal was always the click-through, not a native middle-click/open-in-
    // new-tab context menu on the tile itself.
    const tile = (name, iconUrl, quantity, owned, itemId) => html`
      <div title=${name + (quantity > 1 ? ` ×${quantity}` : '')}
           onClick=${itemId ? () => window.open(`https://www.wowhead.com/item=${itemId}`, '_blank', 'noopener') : null}
           style="position:relative;width:40px;height:40px;border-radius:4px;flex-shrink:0;
                  background:var(--wow-bg);border:1px solid ${owned ? 'var(--wow-border)' : 'var(--wow-border2)'};
                  opacity:${owned ? 1 : 0.35};overflow:hidden;${itemId ? 'cursor:pointer;' : ''}">
        ${iconUrl ? html`<img src=${iconUrl} alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;"
             onError=${e => { e.target.style.display = 'none'; }} />`
          : html`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;">🪑</div>`}
        ${quantity > 1 && html`
          <span style="position:absolute;bottom:0;right:0;font-family:var(--wow-mono);font-size:9px;color:#fff;
                        background:rgba(0,0,0,0.75);padding:0 3px;border-radius:2px 0 0 0;line-height:1.4;">×${quantity}</span>`}
      </div>`;

    // Access flags is a bitfield (Enum.HouseSettingFlags). Bit meanings below
    // are taken from the wiki's flag list, unverified against a live account
    // with non-default settings - and a "5 audiences x house-or-plot" bitfield
    // reads as multi-select (e.g. Guild AND Friends both allowed at once),
    // not a single narrowest-wins choice, so every set bit is shown rather
    // than picking one. House and plot access share the same five audiences,
    // just at different bit offsets - one table drives both halves.
    const ACCESS_AUDIENCES = [
      ['Anyone', 0x1, 0x20], ['Neighbors', 0x2, 0x40],
      ['Guild', 0x4, 0x80], ['Friends', 0x8, 0x100], ['Party', 0x10, 0x200],
    ];
    const describeAccess = (flags, plotBit) => {
      if (flags == null) return null;
      const hits = ACCESS_AUDIENCES.filter(([, houseBit, pBit]) => (flags & (plotBit ? pBit : houseBit)) !== 0);
      return hits.length ? hits.map(h => h[0]).join('+') : 'Private';
    };

    return html`
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${houses.map(h => html`
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:8px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;">
                ${h.houseName || 'Unnamed House'}
              </span>
              ${h.plotID != null && html`<span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">Plot ${h.plotID}</span>`}
            </div>
            ${h.neighborhoodName && html`
              <div style="font-size:11px;color:var(--wow-muted);margin-top:2px;">${h.neighborhoodName}</div>`}
            ${(addonHousing?.exteriorTypeName || addonHousing?.accessFlags != null || addonHousing?.refundAmount != null) && html`
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">
                ${addonHousing.exteriorTypeName && html`<span>🏠 ${addonHousing.exteriorTypeName}</span>`}
                ${addonHousing.accessFlags != null && html`<span>🚪 ${describeAccess(addonHousing.accessFlags, false)} · 🪧 ${describeAccess(addonHousing.accessFlags, true)}</span>`}
                ${/* Currency unit (copper vs. a plain gold-style integer) is
                     unconfirmed for this API - Blizzard's own docs don't say,
                     and it's not worth guessing wrong on a money figure. Shown
                     unlabeled rather than mislabeled; fix once verified in-game. */''}
                ${addonHousing.refundAmount != null && addonHousing.refundAmount > 0 && html`<span>↩ ${addonHousing.refundAmount.toLocaleString()} refund</span>`}
              </div>`}
          </div>`)}

        ${addonHousing?.favor != null && addonHousing?.favorMax > 0 && html`
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:8px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;">House Favor</span>
              <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);">
                ${addonHousing.favor.toLocaleString()} / ${addonHousing.favorMax.toLocaleString()}
              </span>
            </div>
            <div style="height:4px;background:var(--wow-bg);border-radius:2px;overflow:hidden;">
              <div style="height:100%;background:var(--wow-gold);width:${Math.min(100, Math.round((addonHousing.favor / addonHousing.favorMax) * 100))}%"></div>
            </div>
          </div>`}

        ${addonHousing?.decorStoredTotal != null && addonHousing?.decorStorageMax > 0 && html`
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:8px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;">Decor Storage</span>
              <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);">
                ${addonHousing.decorStoredTotal.toLocaleString()} / ${addonHousing.decorStorageMax.toLocaleString()}
                ${addonHousing.decorStoredExempt > 0 ? html` <span style="color:var(--wow-muted);">(${addonHousing.decorStoredExempt} exempt)</span>` : ''}
              </span>
            </div>
            <div style="height:4px;background:var(--wow-bg);border-radius:2px;overflow:hidden;">
              <div style="height:100%;background:var(--wow-gold);width:${Math.min(100, Math.round((addonHousing.decorStoredTotal / addonHousing.decorStorageMax) * 100))}%"></div>
            </div>
          </div>`}

        ${collected.length > 0 && html`
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:8px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
              <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;">Decor Collected</span>
              <span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-gold);">
                ${collected.length.toLocaleString()} unique${totalDecor !== collected.length ? ` · ${totalDecor.toLocaleString()} total` : ''}
                ${catalogReady ? html` · ${Math.round(100 * collected.length / catalog.size)}% of ${catalog.size.toLocaleString()}` : ''}
              </span>
            </div>

            ${catalogReady && html`
              <div style="height:4px;background:var(--wow-bg);border-radius:2px;overflow:hidden;margin-top:6px;">
                <div style="height:100%;background:var(--wow-gold);width:${Math.min(100, Math.round(100 * collected.length / catalog.size))}%"></div>
              </div>`}

            ${!catalogReady && decorCatalogRef?.current === 'loading' && html`
              <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-top:6px;">Loading decor catalogue…</div>`}

            ${catalogReady && html`
              <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;">
                ${['all', ...categories].map(cat => html`
                  <div onClick=${() => setDecorFilter(cat)}
                       style="font-family:var(--wow-mono);font-size:10px;padding:3px 8px;border-radius:3px;cursor:pointer;text-transform:capitalize;
                              background:${decorFilter === cat ? 'var(--wow-gold-dim)' : 'var(--wow-surface2)'};
                              color:${decorFilter === cat ? 'var(--wow-gold)' : 'var(--wow-muted)'};">
                    ${cat === 'all' ? 'All' : cat}
                  </div>`)}
                <div onClick=${() => setDecorShowMissing(!decorShowMissing)}
                     style="font-family:var(--wow-mono);font-size:10px;padding:3px 8px;border-radius:3px;cursor:pointer;margin-left:auto;
                            background:${decorShowMissing ? 'var(--wow-gold-dim)' : 'var(--wow-surface2)'};
                            color:${decorShowMissing ? 'var(--wow-gold)' : 'var(--wow-muted)'};">
                  ${decorShowMissing ? '✓ showing missing' : 'show missing'}
                </div>
              </div>
              <input type="text" value=${decorSearch} placeholder="Filter decor…"
                     onInput=${e => setDecorSearch(e.target.value)}
                     style="width:100%;box-sizing:border-box;background:var(--wow-bg);border:1px solid var(--wow-border2);
                            color:var(--wow-text);font-family:var(--wow-mono);font-size:11px;padding:5px 7px;border-radius:3px;margin-top:6px;" />`}

            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;max-height:260px;overflow-y:auto;">
              ${catalogReady
                ? [
                    ...visibleOwned.map(j => tile(j.name, j.iconUrl, j.quantity, true, j.itemId)),
                    ...visibleMissing.map(c => tile(c.name, c.iconUrl, 1, false, c.itemId)),
                  ]
                : collected.slice(0, 12).map(d => html`
                    <span style="font-size:11px;color:var(--wow-muted);background:var(--wow-bg);border:1px solid var(--wow-border);border-radius:3px;padding:2px 6px;"
                          title="${d.decor?.name || ''}${(d.quantity || 1) > 1 ? ` ×${d.quantity}` : ''}">
                      ${d.decor?.name || 'Unknown'}${(d.quantity || 1) > 1 ? html` ×${d.quantity}` : ''}
                    </span>`)}
              ${!catalogReady && decorCatalogRef?.current !== 'loading' && collected.length > 12 && html`
                <span style="font-size:11px;color:var(--wow-muted);padding:2px 6px;">+${collected.length - 12} more</span>`}
            </div>
            ${catalogReady && (visibleOwned.length + visibleMissing.length) === 0 && html`
              <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);padding:8px 0 0;">Nothing matches that filter.</div>`}
          </div>`}
      </div>`;
  };

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

  const renderReputations = () => {
    if (!(bnet && bnet.reputations)) return html`<div class="empty">Reputation data unavailable.</div>`;
    const reps = bnet.reputations.reputations || [];
    const twwNames = ['Council of Dornogal', 'The Assembly of the Deeps', 'Hallowfall Arathi', 'The Severed Threads'];
    // Renown factions have their own card above (tiered standing, no plain
    // "Friendly/Honored/.../Exalted" bar) - everything else lands here.
    const plain = reps
      .filter(r => r.faction?.name && !twwNames.includes(r.faction.name) && r.standing?.max)
      .sort((a, b) => (b.standing?.value || 0) / (b.standing?.max || 1) - (a.standing?.value || 0) / (a.standing?.max || 1));
    if (plain.length === 0) return html`<div class="empty">No reputation data found yet.</div>`;
    return html`
      <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;">
        ${plain.map(r => {
          const name = r.faction.name;
          const standingName = r.standing?.name || '';
          const val = r.standing?.value || 0;
          const max = r.standing?.max || 1;
          const repPct = Math.min(100, Math.round((val / max) * 100));
          return html`
          <div style="background:var(--wow-surface2);border:1px solid var(--wow-border);border-radius:4px;padding:6px 10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-family:var(--wow-display);font-size:12px;font-weight:600;">${name}</span>
              <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${standingName}</span>
            </div>
            <div style="height:4px;background:var(--wow-bg);border-radius:2px;overflow:hidden;">
              <div style="height:100%;background:var(--wow-accent);width:${repPct}%"></div>
            </div>
          </div>`;
        })}
      </div>`;
  };

  const renderSpec = () => {
    const specData = bnet.specializations;
    const activeSpecName = specData?.active_specialization?.name;
    const heroTalent = specData?.active_hero_talent?.hero_talent_tree?.name;
    if (!activeSpecName) return html`<div class="empty">Specialization data unavailable.</div>`;
    const specSpecs = specData.specializations || [];
    const activeSpecObj = specSpecs.find(s => s.specialization?.id === specData.active_specialization?.id) || specSpecs[0];
    const glyphs = activeSpecObj?.glyphs?.map(g => g.glyph?.name).filter(Boolean) || [];
    const specColorMap = { 'Blood':'var(--wow-red)','Frost':'var(--wow-frost)','Unholy':'var(--wow-green)','Havoc':'var(--wow-danger)','Vengeance':'#a335ee','Balance':'var(--wow-gold)','Feral':'var(--wow-warn)','Guardian':'var(--wow-warn)','Restoration':'var(--wow-green)','Beast Mastery':'var(--wow-warn)','Marksmanship':'var(--wow-frost)','Survival':'var(--wow-green)','Arcane':'var(--wow-frost)','Fire':'var(--wow-danger)','Brewmaster':'var(--wow-warn)','Mistweaver':'var(--wow-green)','Windwalker':'var(--wow-red)','Retribution':'var(--wow-gold)','Shadow':'#a335ee','Assassination':'var(--wow-danger)','Outlaw':'var(--wow-warn)','Subtlety':'#a335ee','Elemental':'var(--wow-frost)','Enhancement':'var(--wow-warn)','Affliction':'#a335ee','Demonology':'var(--wow-danger)','Destruction':'var(--wow-danger)','Arms':'var(--wow-danger)','Fury':'var(--wow-danger)','Devastation':'var(--wow-danger)','Preservation':'var(--wow-green)','Augmentation':'var(--wow-warn)' };
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
    <${WowCharIdent} character=${character} />
    <${WowGearStrip} character=${character} bnet=${bnet} />
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
          <div class="card-header"><div class="card-title"><div class="dot dot-green"></div> Reputations</div></div>
          <div class="card-body">${renderReputations()}</div>
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
                  <a href=${item ? `https://www.wowhead.com/item=${item.item.id}` : null} data-wowhead=${item ? wowItemAttr(item, i_ilvl) : null} target="_blank" style="color:${item ? qColor : 'var(--wow-border2)'};text-decoration:none;">${item?.name ?? 'Empty'}</a>
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
    <${WowCharIdent} character=${character} />
    <${WowGearFrame} character=${character} bnet=${bnet}>
    <div class="wow-layout">
      <div class="col-main">
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
    </${WowGearFrame}>
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
                <a href="https://www.wowhead.com/item=${item.item.id}" data-wowhead="${wowItemAttr(item, ilvl)}" target="_blank" style="color:${qColors[q]||'#fff'};text-decoration:none;">${item.name}</a>
              </div>
              <div style="font-family:var(--wow-mono);font-size:12px;font-weight:700;color:var(--wow-purple);flex-shrink:0;">${ilvl}</div>
            </div>
          `;
        })}
      </div>
    `;
  };

  return html`
    <${WowCharIdent} character=${character} />
    <${WowGearFrame} character=${character} bnet=${bnet}>
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
    </${WowGearFrame}>
  `;
}

function WowAccount({ me, characters, onRefresh, privacy, onPrivacyChange }) {
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
          } else if (charsRes.status === 401) {
            // The server already tried to refresh silently, so a 401 here means
            // the link really is dead. Say so instead of rendering an empty
            // character list with no explanation.
            setBnetChars([]);
            setBnetStatus(st => ({ ...(st || {}), linked: false, needsReauth: true }));
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

  const doSetMain = async (id) => {
    setBusy(id + '-main');
    try {
      await req('/api/wow/characters/main', { method: 'POST', body: JSON.stringify({ id }) });
      if (onRefresh) onRefresh();
    } catch(e) {}
    setBusy(null);
  };

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

    const popupUrl = `${PUBLIC_ORIGIN}/auth/battlenet?name=${encodeURIComponent(me.name)}`;
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
          ${bnetStatus?.linked
            ? html`<span class="wow-badge badge-free">LINKED</span>`
            : bnetStatus?.needsReauth
              ? html`<span class="wow-badge badge-dim" style="border-color:var(--wow-red);color:var(--wow-red);">RECONNECT</span>`
              : html`<span class="wow-badge badge-dim">NOT LINKED</span>`}
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
                    <button
                      class="wow-btn btn-ghost"
                      title=${c.is_main ? 'Your main' : 'Make this your main'}
                      disabled=${!!c.is_main || busy === c.id + '-main'}
                      onClick=${() => doSetMain(c.id)}
                      style="font-family:var(--wow-mono);font-size:10px;padding:3px 8px;flex-shrink:0;cursor:${c.is_main ? 'default' : 'pointer'};background:${c.is_main ? 'var(--wow-gold-dim)' : 'transparent'};border-color:${c.is_main ? 'rgba(240,180,41,0.4)' : 'var(--wow-border2)'};color:${c.is_main ? 'var(--wow-gold)' : 'var(--wow-muted)'};opacity:1;">
                      ★ ${c.is_main ? 'Main' : busy === c.id + '-main' ? '...' : 'Set Main'}
                    </button>
                    <button class="wow-btn btn-ghost" style="font-size:10px;padding:3px 8px;border-color:var(--wow-red);color:var(--wow-red);flex-shrink:0;" disabled=${busy === c.id + '-remove'} onClick=${() => doRemoveChar(c.id)}>Remove</button>
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
              <div class="picker-filter ${pickerFilter === 'active' ? 'active' : ''}" onClick=${() => setPickerFilter('active')} style="font-family:var(--wow-mono);font-size:10px;padding:4px 10px;border-radius:3px;border:1px solid ${pickerFilter === 'active' ? 'rgba(0,200,255,0.4)' : 'var(--wow-border2)'};color:${pickerFilter === 'active' ? 'var(--wow-accent)' : 'var(--wow-muted)'};cursor:pointer;letter-spacing:1px;background:${pickerFilter === 'active' ? 'var(--wow-accent-dim)' : 'transparent'};">Max Level</div>
              <div class="picker-filter ${pickerFilter === 'all' ? 'active' : ''}" onClick=${() => setPickerFilter('all')} style="font-family:var(--wow-mono);font-size:10px;padding:4px 10px;border-radius:3px;border:1px solid ${pickerFilter === 'all' ? 'rgba(0,200,255,0.4)' : 'var(--wow-border2)'};color:${pickerFilter === 'all' ? 'var(--wow-accent)' : 'var(--wow-muted)'};cursor:pointer;letter-spacing:1px;background:${pickerFilter === 'all' ? 'var(--wow-accent-dim)' : 'transparent'};">All</div>
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

// Wowhead's default entry for an item is its BASE version. Upgradeable gear
// shares one item ID across upgrade tiers and armor types, so without context
// the tooltip shows a different ilvl, quality and sometimes a different item
// name than the one equipped. bonus_list pins it to the player's variant.
function wowItemAttr(item, ilvl) {
  if (!item?.item?.id) return null;
  const parts = [`item=${item.item.id}`];
  if (ilvl) parts.push(`ilvl=${ilvl}`);
  const bonus = item.bonus_list;
  if (Array.isArray(bonus) && bonus.length) parts.push(`bonus=${bonus.join(':')}`);
  return parts.join('&');
}

// ── Addon data (gold, bags, keystones, lockouts, vault) ──────────────────────

function goldStr(g) {
  if (g == null) return '—';
  if (g >= 1000000) return (g / 1000000).toFixed(2) + 'M';
  if (g >= 1000) return (g / 1000).toFixed(1) + 'k';
  return String(g);
}

function playedStr(sec) {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function resetInStr(epoch) {
  if (!epoch) return '';
  const left = epoch * 1000 - Date.now();
  if (left <= 0) return 'expired';
  // Round up: a lockout with 4h59m left is "5h", not "4h" - truncating reads as
  // an hour more slack than the player actually has.
  const totalH = Math.ceil(left / 3600000);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function agoStr(epoch) {
  if (!epoch) return '—';
  const ago = Date.now() - epoch * 1000;
  if (ago < 60000) return 'just now';
  const mins = Math.floor(ago / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Vault slot types, per C_WeeklyRewards. 1 = raid, 3 = M+, 6 = world/delves.
const VAULT_TYPE = { 1: 'Raid', 3: 'Mythic+', 5: 'PvP', 6: 'World' };

// Blizzard's DifficultyID enum - confirmed live 2026-09-11 against
// warcraft.wiki.gg (current as of Patch 12.0.1), not the docs-thin WoW API
// itself. Only the ids this addon's combat log capture can realistically
// report (dungeons, raids, delves, follower content) - unmapped ids fall
// back to the bare number rather than guessing at a label.
const WOW_DIFFICULTY = {
  1:  { name: 'Normal',    color: 'var(--wow-muted)', icon: '⚔️' },
  2:  { name: 'Heroic',    color: 'var(--wow-accent)', icon: '⚔️' },
  8:  { name: 'Mythic Keystone', color: 'var(--wow-gold)', icon: '🗝️' },
  23: { name: 'Mythic',    color: 'var(--wow-red)', icon: '⚔️' },
  24: { name: 'Timewalking', color: 'var(--wow-accent)', icon: '⚔️' },
  205: { name: 'Follower Dungeon', color: 'var(--wow-muted)', icon: '⚔️' },
  14: { name: 'Normal Raid',  color: 'var(--wow-muted)', icon: '🏰' },
  15: { name: 'Heroic Raid',  color: 'var(--wow-accent)', icon: '🏰' },
  16: { name: 'Mythic Raid',  color: 'var(--wow-red)', icon: '🏰' },
  17: { name: 'Looking For Raid', color: 'var(--wow-muted)', icon: '🏰' },
  33: { name: 'Timewalking Raid', color: 'var(--wow-accent)', icon: '🏰' },
  220: { name: 'Story Raid',  color: 'var(--wow-muted)', icon: '🏰' },
  38: { name: 'Normal Delve', color: 'var(--wow-green)', icon: '🕳️' },
  39: { name: 'Heroic Delve', color: 'var(--wow-accent)', icon: '🕳️' },
  40: { name: 'Mythic Delve', color: 'var(--wow-red)', icon: '🕳️' },
  208: { name: 'Delve',    color: 'var(--wow-green)', icon: '🕳️' },
  172: { name: 'World Boss', color: 'var(--wow-gold)', icon: '👑' },
};

// ── Hub: your own characters at a glance (second-screen view) ────────────────

function durColor(pct) {
  if (pct == null) return 'var(--wow-muted)';
  if (pct <= 20) return 'var(--wow-red)';
  if (pct <= 50) return 'var(--wow-gold)';
  return 'var(--wow-green)';
}

function cdStr(sec) {
  if (!sec) return '';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Quality colours match WoW's item tiers so the grid reads at a glance.
// Container icons, from WoW's own art rather than emoji.
const WOW_BAG_ICON = {
  bags: 'inv_misc_bag_08',
  bank: 'achievement_guildperk_bountifulbags',
  reagentBank: 'inv_enchant_dustarcane',
  accountBank: 'inv_misc_bag_10_blue',
};

const Q_COLOR = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80', '#00ccff'];

const Q_NAME_INDEX = {
  POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4,
  LEGENDARY: 5, ARTIFACT: 6, HEIRLOOM: 7,
};

function qColor(q) {
  if (q == null) return 'var(--wow-text)';
  const i = typeof q === 'string' ? Q_NAME_INDEX[q.toUpperCase()] : q;
  return (i != null && Q_COLOR[i]) ? Q_COLOR[i] : 'var(--wow-text)';
}

// Inventory browser for one character. Owner-only by construction: the backend
// returns bags/bank/reagentBank/accountBank only when `mine` (or the bags tier
// is public), so there is nothing to hide here.
function WowInventory({ character, onClose }) {
  const [src, setSrc] = useState('bags');
  const [search, setSearch] = useState('');

  const c = character;
  const SOURCES = [
    { id: 'bags',        label: 'Bags',    icon: WOW_BAG_ICON.bags,        items: c.bags || [] },
    { id: 'bank',        label: 'Bank',    icon: WOW_BAG_ICON.bank,        items: c.bank || [] },
    { id: 'reagentBank', label: 'Reagent', icon: WOW_BAG_ICON.reagentBank, items: c.reagentBank || [] },
    { id: 'accountBank', label: 'Warband', icon: WOW_BAG_ICON.accountBank, items: c.accountBank || [] },
  ];

  const active = SOURCES.find(s => s.id === src) || SOURCES[0];
  const q = search.trim().toLowerCase();
  const items = (active.items || [])
    .filter(it => !q || (it.name || '').toLowerCase().includes(q))
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || (a.name || '').localeCompare(b.name || ''));

  return html`
    <div class="wow-card" style="margin:12px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-gold);">${c.name}</div>
        <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${c.realm}</div>
        <div style="margin-left:auto;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);cursor:pointer;padding:4px 8px;"
             onClick=${onClose}>✕ close</div>
      </div>

      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
        ${SOURCES.map(s => html`
          <div onClick=${() => setSrc(s.id)}
               style="font-family:var(--wow-mono);font-size:10px;padding:4px 9px;border-radius:3px;cursor:pointer;
                      background:${src === s.id ? 'var(--wow-gold-dim)' : 'var(--wow-surface2)'};
                      color:${src === s.id ? 'var(--wow-gold)' : 'var(--wow-muted)'};">
            <img src="https://wow.zamimg.com/images/wow/icons/small/${s.icon}.jpg"
                 onError=${e => { e.target.style.display = 'none'; }}
                 style="width:14px;height:14px;border-radius:2px;vertical-align:-2px;margin-right:4px;" />${s.label} <span style="opacity:0.6;">${(s.items || []).length}</span>
          </div>
        `)}
      </div>

      <input type="text" value=${search} placeholder="Filter items…"
             onInput=${e => setSearch(e.target.value)}
             style="width:100%;box-sizing:border-box;background:var(--wow-bg);border:1px solid var(--wow-border2);
                    color:var(--wow-text);font-family:var(--wow-mono);font-size:11px;padding:6px 8px;border-radius:3px;margin-bottom:8px;" />

      ${items.length === 0
        ? html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);padding:8px 0;">
            ${q ? 'Nothing matches that filter.' : `${active.label} is empty.`}
          </div>`
        : html`<div style="max-height:340px;overflow-y:auto;">
            ${items.map(it => html`
              <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--wow-border2);">
                ${it.icon ? html`<img src="https://wow.zamimg.com/images/wow/icons/small/${it.icon}.jpg"
                     onError=${e => { e.target.style.visibility = 'hidden'; }}
                     style="width:18px;height:18px;border-radius:2px;flex-shrink:0;" />`
                  : html`<div style="width:18px;height:18px;flex-shrink:0;"></div>`}
                <a href="https://www.wowhead.com/item=${it.id}" target="_blank" rel="noopener"
                   data-wowhead="item=${it.id}"
                   style="flex:1;min-width:0;font-family:var(--wow-mono);font-size:11px;text-decoration:none;
                          color:${qColor(it.quality)};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${it.name || ('item ' + it.id)}
                </a>
                ${it.count > 1 ? html`<span style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">×${it.count}</span>` : ''}
              </div>
            `)}
          </div>`}

      <div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);margin-top:8px;">
        ${items.length} of ${(active.items || []).length} stack${(active.items || []).length === 1 ? '' : 's'}
        ${active.id === 'bags' && c.bagFree != null ? ` · ${c.bagFree} free slot${c.bagFree === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  `;
}

// Full character detail: addon-sourced data merged with the Blizzard/RIO cache
// the WoW tab already loads. Reached by clicking a card in the Hub.
function WowCharDetail({ character, rio, onBack, onOpen }) {
  const [pane, setPane] = useState('overview');
  const c = character;
  const bnet = rio?._bnet || {};
  const equipped = bnet.equipment?.equipped_items || [];

  const d = c.durability;
  const bagPct = (c.bagFree != null && c.bagSlots) ? Math.round((1 - c.bagFree / c.bagSlots) * 100) : null;
  const vaultReady = (c.vault || []).filter(v => v.progress >= v.threshold).length;
  const score = rio?.mythic_plus_scores_by_season?.[0]?.scores?.all;

  const PANES = [
    { id: 'overview',  label: 'Overview' },
    { id: 'gear',      label: 'Equipment' },
    { id: 'inventory', label: 'Inventory' },
  ];

  const stat = (label, value, color) => html`
    <div>
      <div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);">${label}</div>
      <div style="font-family:var(--wow-display);font-size:15px;color:${color || 'var(--wow-text)'};">${value}</div>
    </div>`;

  // Identity and collections come from the Blizzard payload already fetched for
  // the gear frame, so none of this costs an extra request.
  const bp = bnet.profile || {};
  const mountCount = (bnet.mounts?.mounts || []).length;
  const petCount = (bnet.pets?.pets || []).length;
  const achPoints = bp.achievement_points;
  const avgIlvl = bp.average_item_level;
  const eqIlvl = bp.equipped_item_level || (c.ilvl ? Math.round(c.ilvl) : null);
  // A gap between average and equipped means an upgrade is sitting in the bags.
  const bagUpgrade = (avgIlvl && eqIlvl && avgIlvl > eqIlvl) ? avgIlvl - eqIlvl : 0;
  const lastLogin = bp.last_login_timestamp
    ? agoStr(Math.floor(bp.last_login_timestamp / 1000)) : null;
  // Only what the character actually holds, most first: the full currency list
  // is long and mostly zeroes.
  const currencies = (c.currencies || [])
    .filter(x => (x.quantity || 0) > 0)
    .sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
    .slice(0, 6);

  const renderOverview = () => html`
    <div class="ov-ident" style="--cc:${classColor(c.class)};">
      ${classIcon(c.class) ? html`<img class="ov-ident-icon" src=${classIcon(c.class)} alt=""
           onError=${e => { e.target.style.visibility = 'hidden'; }} />` : ''}
      <div class="ov-ident-body">
        <div class="ov-ident-name" style="color:${classColor(c.class)};">${c.name}</div>
        <div class="ov-ident-meta">
          ${[bp.race?.name, bp.faction?.name, c.spec, c.class].filter(Boolean).join(' · ')}
        </div>
      </div>
      ${c.guild ? html`<div class="ov-guild">${'<' + c.guild + '>'}</div>` : ''}
      ${lastLogin ? html`<div class="ov-login">seen ${lastLogin}</div>` : ''}
    </div>

    <div class="wow-card" style="margin:12px;">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:10px;">
        ${stat('GOLD', goldStr(c.gold), 'var(--wow-gold)')}
        ${stat('ILVL', eqIlvl ?? '—', ilvlColor(eqIlvl))}
        ${score ? stat('M+ SCORE', Math.round(score), 'var(--wow-accent)') : ''}
        ${d?.worstPct != null ? stat('DURABILITY', d.worstPct + '%', durColor(d.worstPct)) : ''}
        ${bagPct != null ? stat('BAGS', bagPct + '%', c.bagFree <= 4 ? 'var(--wow-red)' : null) : ''}
        ${stat('PLAYED', playedStr(c.played), 'var(--wow-dim)')}
        ${vaultReady > 0 ? stat('VAULT', vaultReady + ' ready', 'var(--wow-gold)') : ''}
        ${c.keystone?.level ? stat('KEYSTONE', '+' + c.keystone.level, 'var(--wow-accent)') : ''}
      </div>
      ${bagUpgrade ? html`
        <div class="ov-hint">Average item level is ${avgIlvl} — an upgrade worth
          <b>+${bagUpgrade}</b> is sitting in your bags.</div>` : ''}
      ${c.keystone?.name ? html`
        <div class="ov-hint">Holding: ${c.keystone.name}</div>` : ''}
    </div>

    ${(achPoints || mountCount || petCount) ? html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Collections</div>
        <div class="ov-coll">
          ${achPoints ? html`<div class="ov-coll-item ach"><b>${achPoints.toLocaleString()}</b><i>achievement points</i></div>` : ''}
          ${mountCount ? html`<div class="ov-coll-item mounts link" onClick=${() => onOpen && onOpen('world', 'mounts')}>
            <b>${mountCount}</b><i>mounts →</i></div>` : ''}
          ${petCount ? html`<div class="ov-coll-item pets link" onClick=${() => onOpen && onOpen('world', 'pets')}>
            <b>${petCount}</b><i>pets →</i></div>` : ''}
          ${c.housing?.hasAccess ? html`<div class="ov-coll-item house"><b>${c.housing.maxLevel ?? '—'}</b><i>house level</i></div>` : ''}
        </div>
      </div>` : ''}

    ${currencies.length > 0 && html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Currencies</div>
        <div class="ov-curr">
          ${currencies.map(x => html`
            <div class="ov-curr-item" title=${x.max ? `${x.quantity} of ${x.max}` : String(x.quantity)}>
              ${x.icon ? html`<img src=${`https://render.worldofwarcraft.com/us/icons/56/${x.icon}.jpg`} alt=""
                   onError=${e => { e.target.style.display = 'none'; }} />` : ''}
              <span class="ov-curr-amt">${(x.quantity || 0).toLocaleString()}</span>
              <span class="ov-curr-name">${x.name}</span>
            </div>`)}
        </div>
      </div>
    `}

    ${onOpen ? html`
      <div class="ov-links">
        <div class="ov-link pve" onClick=${() => onOpen('pve')}><b>⚔</b> PVE<i>gear, raids, M+</i></div>
        <div class="ov-link pvp" onClick=${() => onOpen('pvp')}><b>🏆</b> PVP<i>rating, conquest</i></div>
        <div class="ov-link world" onClick=${() => onOpen('world')}><b>🌍</b> Collections<i>mounts, pets, decor</i></div>
        <div class="ov-link professions" onClick=${() => onOpen('professions')}><b>🛠</b> Professions<i>recipes, materials</i></div>
        <div class="ov-link keys" onClick=${() => onOpen('keys')}><b>🗝</b> Progress<i>vault, keystones, lockouts</i></div>
      </div>` : ''}

    ${(c.professions || []).length > 0 && html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Professions</div>
        ${(c.professions || []).map(p => {
          const pct = (p.rank != null && p.maxRank) ? Math.round(p.rank / p.maxRank * 100) : 0;
          return html`
            <div class="ov-prof">
              <span class="ov-prof-name">${p.name}</span>
              <span class="ov-prof-bar"><span class="ov-prof-fill" style="width:${pct}%;"></span></span>
              <span class="ov-prof-rank">${p.rank ?? '?'}${p.maxRank ? ' / ' + p.maxRank : ''}</span>
            </div>`;
        })}
      </div>
    `}

    ${(c.cooldowns || []).length > 0 && html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Cooldowns</div>
        ${(c.cooldowns || []).map(cd => html`
          <div style="display:flex;align-items:center;gap:10px;padding:3px 0;">
            <span style="flex:1;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${cd.name || ('spell ' + cd.id)}</span>
            <span style="font-family:var(--wow-mono);font-size:10px;color:${cd.remaining > 0 ? 'var(--wow-muted)' : 'var(--wow-green)'};">${cd.remaining > 0 ? cdStr(cd.remaining) : 'ready'}</span>
          </div>
        `)}
      </div>
    `}

    ${(c.vault || []).length > 0 && html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Great Vault</div>
        ${Object.entries((c.vault || []).reduce((acc, v) => { (acc[v.type] = acc[v.type] || []).push(v); return acc; }, {})).map(([type, slots]) => html`
          <div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
            <span style="width:64px;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${VAULT_TYPE[type] || 'Other'}</span>
            ${[...slots].sort((a, b) => a.index - b.index).map(sl => html`
              <span class="k-pip ${sl.progress >= sl.threshold ? 'done' : sl.progress ? 'part' : ''}">
                ${sl.progress >= sl.threshold ? (sl.level || '✓') : `${sl.progress}/${sl.threshold}`}</span>
            `)}
          </div>
        `)}
      </div>
    `}

    ${(c.lockouts || []).length > 0 && html`
      <div class="wow-card" style="margin:12px;">
        <div class="ov-title">Raid Lockouts</div>
        ${(c.lockouts || []).map(lo => html`
          <div style="display:flex;align-items:center;gap:10px;padding:3px 0;">
            <span style="flex:1;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lo.name}${lo.difficultyName ? ` (${lo.difficultyName})` : ''}</span>
            <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-accent);">${lo.defeated ?? 0}/${lo.bosses ?? '?'}</span>
            <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${resetInStr(lo.resetsAt)}</span>
          </div>
        `)}
      </div>
    `}
  `;

  // Equipment comes from the Blizzard API; durability per slot comes from the
  // addon. Neither source has both, so they are matched on slot index.
  const durBySlot = {};
  for (const e of (c.equipped || [])) {
    if (e.slot != null) durBySlot[e.slot] = e;
  }

  // Same paper doll the PVE/PVP tabs use, so equipment reads identically
  // wherever you look at it. The ternary chain that used to translate quality
  // strings here is gone - qColor handles both forms now.
  const renderGear = () => html`<${WowGearFrame} character=${character} bnet=${bnet} />`;

  return html`
    <div class="chardetail">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px 0;">
        <div onClick=${onBack}
             style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-accent);cursor:pointer;padding:4px 8px;
                    background:var(--wow-surface2);border-radius:3px;">‹ back</div>
        <div style="font-family:var(--wow-display);font-size:15px;color:var(--wow-gold);">${c.name}</div>
        <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">
          ${c.realm} · ${c.spec || ''} ${c.class || ''} · ${c.level || '?'}
        </div>
      </div>

      <div style="display:flex;gap:6px;padding:10px 12px 0;">
        ${PANES.map(p => html`
          <div onClick=${() => setPane(p.id)}
               style="font-family:var(--wow-display);font-size:11px;letter-spacing:1px;padding:5px 12px;border-radius:4px;cursor:pointer;
                      background:${pane === p.id ? 'var(--wow-gold-dim)' : 'var(--wow-surface2)'};
                      color:${pane === p.id ? 'var(--wow-gold)' : 'var(--wow-muted)'};">${p.label}</div>
        `)}
      </div>

      ${pane === 'overview'  && renderOverview()}
      ${pane === 'gear'      && renderGear()}
      ${pane === 'inventory' && html`<${WowInventory} character=${c} onClose=${() => setPane('overview')} />`}
    </div>
  `;
}

function WowHub({ addon, addonErr, onReload, charCacheRef, onOpen }) {
  const [detailChar, setDetailChar] = useState(null);
  if (addonErr) {
    return html`<div class="wow-card" style="margin:12px;">
      <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-red);margin-bottom:6px;">Addon data unavailable</div>
      <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">${addonErr}</div>
    </div>`;
  }
  if (!addon) {
    return html`<div style="padding:20px;color:var(--wow-muted);font-family:var(--wow-mono);font-size:12px;">Loading…</div>`;
  }

  const mine = (addon.characters || []).filter(c => c.mine);
  if (mine.length === 0) {
    return html`<div class="wow-card" style="margin:12px;">
      <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-gold);margin-bottom:8px;">Nothing synced yet</div>
      <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);line-height:1.7;">
        Install the GamezNET addon from the desktop app, then log into WoW and type
        <span style="color:var(--wow-accent);">/reload</span>.
      </div>
    </div>`;
  }

  const selected = detailChar ? mine.find(c => c.char_key === detailChar) : null;
  if (selected) {
    // The API cache is keyed region-realm-name with a url-encoded lowercase name.
    const ck = `${selected.region || 'us'}-${selected.realm}-${encodeURIComponent((selected.name || '').toLowerCase())}`.toLowerCase();
    const cache = charCacheRef?.current || {};
    const rio = cache[ck] || Object.values(cache).find(v =>
      (v?._bnet?.profile?.name || '').toLowerCase() === (selected.name || '').toLowerCase());
    return html`<${WowCharDetail} character=${selected} rio=${rio} onBack=${() => setDetailChar(null)} onOpen=${onOpen} />`;
  }

  const totalGold = mine.reduce((n, c) => n + (c.gold || 0), 0);
  const totalPlayed = mine.reduce((n, c) => n + (c.played || 0), 0);
  const keys = mine.filter(c => c.keystone?.level);
  const lockouts = mine.filter(c => (c.lockouts || []).length);

  // Things that want attention: low durability, near-full bags, ready vault slots.
  const alerts = [];
  for (const c of mine) {
    const d = c.durability;
    if (d?.worstPct != null && d.worstPct <= 25) {
      alerts.push({ kind: 'dur', char: c, text: `${c.name} gear at ${d.worstPct}%` });
    }
    if (c.bagFree != null && c.bagSlots && c.bagFree <= 4) {
      alerts.push({ kind: 'bag', char: c, text: `${c.name} bags nearly full (${c.bagFree} free)` });
    }
    const ready = (c.vault || []).filter(v => v.progress >= v.threshold).length;
    if (ready > 0) {
      alerts.push({ kind: 'vault', char: c, text: `${c.name} has ${ready} vault reward${ready > 1 ? 's' : ''} ready` });
    }
    for (const cd of (c.cooldowns || [])) {
      if (cd.remaining != null && cd.remaining <= 0) {
        alerts.push({ kind: 'cd', char: c, text: `${c.name}: ${cd.name || 'cooldown'} ready` });
      }
    }
  }

  return html`
    <div class="hub">
      <div class="hub-bar">
        <span class="hub-count">${mine.length} character${mine.length > 1 ? 's' : ''} synced</span>
        ${alerts.length > 0
          ? html`<span class="hub-pill warn">${alerts.length} need${alerts.length > 1 ? '' : 's'} attention</span>`
          : html`<span class="hub-pill ok">all clear</span>`}
        <span class="hub-reload" onClick=${onReload} title="Reload addon data">⟳</span>
      </div>

      <div class="hub-totals">
        <div class="hub-total"><i>gold</i><b class="gold">${goldStr(totalGold)}</b></div>
        <div class="hub-total"><i>played</i><b>${playedStr(totalPlayed)}</b></div>
        <div class="hub-total"><i>keys</i><b class=${keys.length ? 'on' : 'off'}>${keys.length}</b></div>
        <div class="hub-total"><i>locked</i><b class=${lockouts.length ? 'on' : 'off'}>${lockouts.length}</b></div>
      </div>

      ${alerts.length > 0 && html`
        <div class="hub-alerts">
          ${alerts.map(a => html`
            <div class="hub-alert" onClick=${() => setDetailChar(a.char.char_key)}
                 style="--cc:${classColor(a.char.class)};">
              <span class="hub-alert-icon">${a.kind === 'dur' ? '🔧' : a.kind === 'bag' ? '🎒' : a.kind === 'vault' ? '🎁' : '⏳'}</span>
              <span class="hub-alert-text">${a.text}</span>
            </div>
          `)}
        </div>
      `}

      <div class="hub-rows">
        ${mine.map(c => {
          const col = classColor(c.class);
          const d = c.durability;
          const freePct = (c.bagFree != null && c.bagSlots) ? Math.round(c.bagFree / c.bagSlots * 100) : null;
          const vaultReady = (c.vault || []).filter(v => v.progress >= v.threshold).length;
          const locked = (c.lockouts || []).length;
          return html`
            <div class="hub-row" style="--cc:${col};" onClick=${() => setDetailChar(c.char_key)}>
              <div class="hub-row-top">
                ${classIcon(c.class) ? html`<img class="hub-icon" src=${classIcon(c.class)} alt="" loading="lazy"
                     onError=${e => { e.target.style.visibility = 'hidden'; }} />` : ''}
                <span class="hub-name" style="color:${col};">${c.name}</span>
                <span class="hub-spec">${c.spec || ''} ${c.class || ''}</span>
                <span class="hub-realm">${c.realm}</span>
                <span class="hub-lvl">${c.level || '?'}</span>
                <span class="hub-gap"></span>
                ${c.keystone?.level ? html`<span class="hub-tag key" title=${c.keystone.name || ''}>🗝 +${c.keystone.level}</span>` : ''}
                ${vaultReady ? html`<span class="hub-tag vault">🎁 ${vaultReady}</span>` : ''}
                ${locked ? html`<span class="hub-tag lock">🔒 ${locked}</span>` : ''}
                <span class="hub-chev">›</span>
              </div>
              <div class="hub-row-stats">
                <span class="hub-stat"><i>ilvl</i><b style="color:${ilvlColor(c.ilvl)};">${c.ilvl ? Math.round(c.ilvl) : '—'}</b></span>
                <span class="hub-stat"><i>gold</i><b class="gold">${goldStr(c.gold)}</b></span>
                ${d?.worstPct != null ? html`<span class="hub-stat" title=${d.worstPct <= 60 ? `Worst item at ${d.worstPct}% — needs repair` : `Worst item at ${d.worstPct}%`}><i>dur</i><b style="color:${durColor(d.worstPct)};">${d.worstPct <= 60 ? '⚒ ' : ''}${d.worstPct}%</b></span>` : ''}
                ${freePct != null ? html`<span class="hub-stat"><i>bags</i><b style="color:${bagColor(freePct)};">${c.bagFree} free</b></span>` : ''}
                <span class="hub-stat"><i>played</i><b>${playedStr(c.played)}</b></span>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// Shared "no addon data" / error states for the Group/Keys/Pulls tabs. Pulls
// comes from the live combat log tail rather than addon SavedVariables, so it
// renders its own independent empty state instead of reusing this one.
function wowAddonEmptyState(addon, addonErr) {
  if (addonErr) {
    return html`<div class="wow-card" style="margin:12px;">
      <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-red);margin-bottom:6px;">Addon data unavailable</div>
      <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">${addonErr}</div>
    </div>`;
  }
  if (!addon) {
    return html`<div style="padding:20px;color:var(--wow-muted);font-family:var(--wow-mono);font-size:12px;">Loading addon data…</div>`;
  }
  if ((addon.characters || []).length === 0) {
    return html`<div class="wow-card" style="margin:12px;">
      <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-gold);margin-bottom:8px;">No addon data yet</div>
      <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);line-height:1.7;">
        Install the GamezNET addon from the desktop app, then log into WoW and type <span style="color:var(--wow-accent);">/reload</span>.<br/>
        WoW only writes addon data on logout or reload, so nothing appears until then.
      </div>
    </div>`;
  }
  return null;
}

function WowGroup({ addon, addonErr, onReload }) {
  const empty = wowAddonEmptyState(addon, addonErr);
  if (empty) return empty;

  const chars = addon.characters || [];
  const agg = addon.aggregate || {};

  // Group by owner rather than listing everyone's characters in one ilvl-sorted
  // run - the useful question here is "what does each player have", and the
  // owner was previously buried in small grey text beside every name.
  const byOwner = {};
  for (const c of chars) {
    const key = c.player_name || 'unknown';
    (byOwner[key] = byOwner[key] || []).push(c);
  }
  // Retail housing is account-wide (one house per account, not per
  // character - unverified in Blizzard's own docs, but consistent with how
  // the feature behaves in-game), so a player's synced characters should
  // report the same house. They can still disagree if only some characters
  // have logged out since the addon was updated, or since a house was
  // bought/sold - picking the most recently updated row avoids showing a
  // stale character's housing over a fresher one from the same owner.
  const ownerHousing = (list) => {
    const withHousing = list.filter(c => c.housing).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return withHousing[0]?.housing || null;
  };

  const owners = Object.entries(byOwner)
    .map(([name, list]) => ({
      name, list: [...list].sort((a, b) => (b.ilvl || 0) - (a.ilvl || 0)),
      mine: list.some(c => c.mine),
      best: Math.max(...list.map(c => c.ilvl || 0)),
      housing: ownerHousing(list),
    }))
    .sort((a, b) => (b.mine - a.mine) || (b.best - a.best));

  return html`
    <div class="group">
      <div class="group-bar">
        <span class="group-stat"><b>${owners.length}</b> player${owners.length === 1 ? '' : 's'}</span>
        <span class="group-sep">·</span>
        <span class="group-stat"><b>${chars.length}</b> character${chars.length === 1 ? '' : 's'}</span>
        <span class="group-sep">·</span>
        <span class="group-stat gold"><b>${goldStr(agg.gold?.total)}</b> combined</span>
        <span class="group-reload" onClick=${onReload} title="Reload addon data">⟳</span>
      </div>

      ${agg.gold?.myRank ? html`
        <div class="group-rank">Your ${goldStr(agg.gold.myTotal)} ranks
          <b>#${agg.gold.myRank}</b> of ${agg.gold.players}.
          <i>Others' exact gold stays hidden — only the combined total and your own rank are shared.</i>
        </div>` : ''}

      ${owners.map(o => html`
        <div class="g-owner">
          <div class="g-owner-head">
            <span class="g-owner-name ${o.mine ? 'mine' : ''}">${o.name}</span>
            <span class="g-owner-count">${o.list.length} character${o.list.length === 1 ? '' : 's'}</span>
          </div>
          ${o.housing?.houses?.[0] && html`
            <div class="g-owner-house">
              🏠 <b>${o.housing.houses[0].houseName || 'Unnamed House'}</b>
              ${o.housing.houses[0].neighborhoodName ? html` · ${o.housing.houses[0].neighborhoodName}` : ''}
              ${o.housing.houses[0].plotID != null ? html` · Plot ${o.housing.houses[0].plotID}` : ''}
            </div>`}
          <div class="g-rows">
            ${o.list.map(c => {
              // Never-synced registered characters carry almost none of the
              // usual fields (no addon has ever run for them), so they get
              // their own compact row rather than a normal one full of dashes.
              if (c.neverSynced) {
                return html`
                  <div class="g-row g-row-unsynced">
                    <div class="g-row-top">
                      <span class="g-name" style="color:var(--wow-muted);">${c.name}</span>
                      <span class="g-spec">${c.realm}</span>
                      <span class="g-gap"></span>
                      <span class="g-tag" style="opacity:0.6;">addon not synced</span>
                    </div>
                    ${c.publicDecorCount != null && html`
                      <div class="g-row-stats">
                        <span class="g-stat"><i>decor</i><b>${c.publicDecorCount.toLocaleString()}</b></span>
                      </div>`}
                  </div>`;
              }
              const profs = (c.professions || []).map(p => p.name).filter(Boolean);
              const locks = (c.lockouts || []).length;
              return html`
                <div class="g-row" style="--cc:${classColor(c.class)};">
                  <div class="g-row-top">
                    ${classIcon(c.class) ? html`<img class="g-icon" src=${classIcon(c.class)} alt=""
                         onError=${e => { e.target.style.visibility = 'hidden'; }} />` : ''}
                    <span class="g-name" style="color:${classColor(c.class)};">${c.name}</span>
                    <span class="g-spec">${c.spec || ''} ${c.class || ''}</span>
                    <span class="g-gap"></span>
                    ${c.keystone?.level ? html`<span class="g-tag key">🗝 +${c.keystone.level}</span>` : ''}
                    ${locks ? html`<span class="g-tag lock">🔒 ${locks}</span>` : ''}
                  </div>
                  <div class="g-row-stats">
                    <span class="g-stat"><i>ilvl</i><b style="color:${ilvlColor(c.ilvl)};">${c.ilvl ? Math.round(c.ilvl) : '—'}</b></span>
                    ${c.mine && c.gold != null ? html`<span class="g-stat"><i>gold</i><b class="gold">${goldStr(c.gold)}</b></span>` : ''}
                    ${c.played ? html`<span class="g-stat"><i>played</i><b>${playedStr(c.played)}</b></span>` : ''}
                    ${profs.length ? html`<span class="g-stat"><i>prof</i><b>${profs.join(' / ')}</b></span>` : ''}
                    ${c.publicDecorCount != null ? html`<span class="g-stat"><i>decor</i><b>${c.publicDecorCount.toLocaleString()}</b></span>` : ''}
                  </div>
                </div>`;
            })}
          </div>
        </div>`)}

      ${(agg.items || []).length > 0 && html`
        <div class="group-card">
          <div class="group-title">Most Held Items</div>
          <div class="g-items">
            ${(agg.items || []).slice(0, 15).map(it => html`
              <div class="g-item">
                <a href=${`https://www.wowhead.com/item=${it.id}`} data-wowhead=${`item=${it.id}`}
                   target="_blank" rel="noopener">${it.name || ('item ' + it.id)}</a>
                <span class="g-item-total">${it.total}</span>
                <span class="g-item-holders">×${it.holders}</span>
              </div>`)}
          </div>
        </div>`}
    </div>
  `;
}

function WowKeys({ addon, addonErr, onReload }) {
  const empty = wowAddonEmptyState(addon, addonErr);
  if (empty) return empty;

  const chars = addon.characters || [];
  const withKeys = [...chars.filter(c => (c.keystone || {}).level)]
                        .sort((a, b) => (b.keystone.level || 0) - (a.keystone.level || 0));
  const locked = chars.filter(c => (c.lockouts || []).length > 0);
  // Vault progress is what keys and lockouts feed into, so it belongs here.
  const vaults = chars
    .map(c => ({ c, slots: c.vault || [], ready: (c.vault || []).filter(v => v.progress >= v.threshold).length }))
    .filter(v => v.slots.length && v.slots.some(x => x.progress > 0))
    .sort((a, b) => b.ready - a.ready);
  const totalReady = vaults.reduce((n, v) => n + v.ready, 0);
  // Vault type 3 = Mythic+; each timed dungeon this week banks one vault
  // slot of progress, so the M+ activity's `progress` field IS the weekly
  // key count - no separate capture needed.
  const weeklyKeysFor = (c) => Math.max(0, ...(c.vault || []).filter(v => v.type === 3).map(v => v.progress || 0), 0);
  const totalWeeklyKeys = chars.reduce((n, c) => n + weeklyKeysFor(c), 0);

  const who = c => html`
    <span class="k-who">
      ${classIcon(c.class) ? html`<img class="k-icon" src=${classIcon(c.class)} alt=""
           onError=${e => { e.target.style.visibility = 'hidden'; }} />` : ''}
      <span class="k-name" style="color:${classColor(c.class)};">${c.name}</span>
      ${c.mine ? '' : html`<span class="k-owner">${c.player_name}</span>`}
    </span>`;

  return html`
    <div class="keys">
      <div class="keys-bar">
        <span class="keys-stat"><b>${withKeys.length}</b> key${withKeys.length === 1 ? '' : 's'}</span>
        <span class="keys-sep">·</span>
        <span class="keys-stat"><b>${totalWeeklyKeys}</b> key${totalWeeklyKeys === 1 ? '' : 's'} run this week</span>
        <span class="keys-sep">·</span>
        <span class="keys-stat"><b>${totalReady}</b> vault slot${totalReady === 1 ? '' : 's'} ready</span>
        <span class="keys-sep">·</span>
        <span class="keys-stat"><b>${locked.length}</b> locked</span>
        <span class="keys-reload" onClick=${onReload} title="Reload addon data">⟳</span>
      </div>

      <div class="keys-card">
        <div class="keys-title">Keystones</div>
        ${withKeys.length === 0
          ? html`<div class="keys-none">Nobody is holding a keystone.</div>`
          : html`<div class="keys-rows">
              ${withKeys.map(c => html`
                <div class="k-row" style="--cc:${classColor(c.class)};">
                  ${who(c)}
                  <span class="k-dungeon">${c.keystone.name || 'unknown dungeon'}</span>
                  <span class="k-level ${c.keystone.level >= 15 ? 'high' : c.keystone.level >= 10 ? 'mid' : ''}">+${c.keystone.level}</span>
                </div>`)}
            </div>`}
      </div>

      <div class="keys-card">
        <div class="keys-title">Great Vault</div>
        ${vaults.length === 0
          ? html`<div class="keys-none">No vault progress yet this week.</div>`
          : html`<div class="keys-rows">
              ${vaults.map(({ c, slots, ready }) => html`
                <div class="k-vault" style="--cc:${classColor(c.class)};">
                  <div class="k-vault-head">
                    ${who(c)}
                    ${weeklyKeysFor(c) > 0 ? html`<span class="k-weekly-keys">${weeklyKeysFor(c)} key${weeklyKeysFor(c) === 1 ? '' : 's'} this week</span>` : ''}
                    <span class="k-ready ${ready ? 'on' : ''}">${ready}/${slots.length}</span>
                  </div>
                  <div class="k-slots">
                    ${Object.entries(slots.reduce((a, v) => { (a[v.type] = a[v.type] || []).push(v); return a; }, {}))
                      .map(([type, group]) => html`
                        <div class="k-group">
                          <span class="k-group-lbl">${VAULT_TYPE[type] || 'Other'}</span>
                          ${[...group].sort((a, b) => a.index - b.index).map(v => html`
                            <span class="k-pip ${v.progress >= v.threshold ? 'done' : v.progress ? 'part' : ''}"
                                  title="${VAULT_TYPE[type] || 'Slot'} ${v.index}: ${v.progress}/${v.threshold}${v.level ? ` — item level ${v.level}` : ''}">
                              ${v.progress >= v.threshold ? (v.level || '✓') : `${v.progress}/${v.threshold}`}
                            </span>`)}
                        </div>`)}
                  </div>
                </div>`)}
            </div>`}
      </div>

      <div class="keys-card">
        <div class="keys-title">Raid Lockouts</div>
        ${locked.length === 0
          ? html`<div class="keys-none">No active lockouts.</div>`
          : html`<div class="keys-rows">
              ${locked.map(c => html`
                <div class="k-lock" style="--cc:${classColor(c.class)};">
                  <div class="k-vault-head">${who(c)}</div>
                  ${(c.lockouts || []).map(lo => {
                    const pct = lo.bosses ? Math.round((lo.defeated ?? 0) / lo.bosses * 100) : 0;
                    const done = lo.bosses && (lo.defeated ?? 0) >= lo.bosses;
                    return html`
                      <div class="k-lo ${done ? 'done' : ''}">
                        <span class="k-lo-name">${lo.name}${lo.difficultyName ? html` <i>${lo.difficultyName}</i>` : ''}</span>
                        <span class="k-lo-spacer"></span>
                        <span class="k-lo-bar"><span class="k-lo-fill" style="width:${pct}%;"></span></span>
                        <span class="k-lo-count">${lo.defeated ?? 0}/${lo.bosses ?? '?'}</span>
                        <span class="k-lo-reset">${resetInStr(lo.resetsAt)}</span>
                      </div>`;
                  })}
                </div>`)}
            </div>`}
      </div>
    </div>
  `;
}

// ── Pulls: per-pull DPS/HPS, deaths, and party loadout from the live combat
// log tail (independent of the addon's SavedVariables sync). ────────────────

function wowPullFmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function wowPullFmtDuration(ms) {
  if (!ms) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// combatant is optional - non-player sources (totems, pets, boss adds hitting
// the raid) have no COMBATANT_INFO entry and no specId, so they fall back to
// the plain per-meter color (red/green/gold) the same as before this class-
// color pass. Name overlaid directly on the bar (WarcraftLogs-style) rather
// than in a separate fixed-width column, since a 90px name column either
// truncated real names or wasted space on short ones.
function WowPullMeterRow({ row, maxTotal, color, combatant }) {
  const pct = maxTotal > 0 ? Math.max(4, Math.round((row.total / maxTotal) * 100)) : 0;
  // row.class comes from the server joining the roster by name (works for
  // every registered character in every pull, captured or not); specId only
  // exists when COMBATANT_INFO fired for this specific pull, which combat
  // log capture only ever does for instanced content on the reporting
  // player's own client.
  const cls = row.class || (combatant ? SPEC_TO_CLASS[combatant.specId] : null);
  const barColor = cls ? classColor(cls) : color;
  return html`
    <div style="display:flex;align-items:center;gap:8px;padding:2px 0;">
      <div style="flex:1;position:relative;height:18px;background:var(--wow-surface2);border-radius:3px;overflow:hidden;">
        <div style="position:absolute;inset:0;width:${pct}%;background:${barColor};opacity:0.85;"></div>
        <div style="position:relative;height:100%;display:flex;align-items:center;padding:0 8px;font-family:var(--wow-display);font-size:11px;color:var(--wow-text);text-shadow:0 1px 2px rgba(0,0,0,0.6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${row.name || row.guid}">${row.name || row.guid}</div>
      </div>
      <div style="width:60px;flex-shrink:0;text-align:right;font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);">${wowPullFmtNum(row.total)} <span style="opacity:0.7;">(${wowPullFmtNum(row.perSecond)}/s)</span></div>
    </div>`;
}

// Same enchantable-slot set as ENCHANTABLE_SLOTS (DollSlot, near the top of
// this file) but in wow_combatlog.py's own naming convention ("Finger1", no
// underscore - see _GEAR_SLOTS there), which is a different string format
// from the Blizzard Profile API's slot.type ("FINGER_1") this loadout has
// nothing to do with. Kept as a separate set rather than reusing
// ENCHANTABLE_SLOTS to avoid a silent mismatch if either format changes.
const PULL_ENCHANTABLE_SLOTS = new Set(['Head', 'Shoulder', 'Chest', 'Finger1', 'Finger2', 'Feet', 'MainHand', 'OffHand']);

function WowPullLoadout({ combatant }) {
  if (!combatant) return html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No loadout captured for this player.</div>`;
  return html`
    <div style="display:flex;flex-direction:column;gap:2px;">
      <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:4px;">
        Spec ID ${combatant.specId ?? '—'} · ${(combatant.talents || []).length} talent(s) selected
      </div>
      ${(combatant.gear || []).map(g => html`
        <div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--wow-border2);">
          <div style="width:60px;flex-shrink:0;font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);text-transform:uppercase;">${g.slot}</div>
          <a href="https://www.wowhead.com/item=${g.itemId}" target="_blank" rel="noopener" data-wowhead="item=${g.itemId}${g.gems && g.gems.length ? '&gems=' + g.gems.join(':') : ''}${g.enchants && g.enchants.length ? '&ench=' + g.enchants[0] : ''}"
             style="flex:1;min-width:0;font-family:var(--wow-mono);font-size:10px;color:var(--wow-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">item ${g.itemId}</a>
          <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-accent);">${g.ilvl ?? '—'}</div>
          ${PULL_ENCHANTABLE_SLOTS.has(g.slot) && (!g.enchants || g.enchants.length === 0) && html`<span title="No enchant" style="color:var(--wow-red);font-size:11px;">⚠</span>`}
        </div>
      `)}
      ${(combatant.gear || []).length === 0 && html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No gear captured.</div>`}
    </div>`;
}

// A collapsible section header + body, used inside an already-expanded pull
// card. Big raid pulls can carry 30+ damage-taken rows (every add hitting
// the raid gets its own row) and a full loadout per raider - collapsing
// those by default is what keeps a "Crown of the Cosmos"-sized pull from
// turning into a scroll marathon the moment you open it.
function WowPullSection({ title, icon, color, count, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const c = color || 'var(--wow-muted)';
  return html`
    <div style="margin:14px 0 0;">
      <div style="display:flex;align-items:center;gap:6px;cursor:pointer;" onClick=${() => setOpen(!open)}>
        <span style="font-family:var(--wow-mono);font-size:9px;color:${c};">${open ? '▾' : '▸'}</span>
        ${icon ? html`<span style="font-size:11px;">${icon}</span>` : ''}
        <span style="font-family:var(--wow-mono);font-size:10px;color:${c};letter-spacing:1px;">${title}${count != null ? ` (${count})` : ''}</span>
      </div>
      ${open && html`<div style="margin-top:6px;">${children}</div>`}
    </div>`;
}

function WowPullCard({ pull, expanded, onToggle }) {
  // Open-world pulls have no encounter, so Kill/Wipe and Difficulty are
  // meaningless for them - show the damage done instead, which is the only
  // thing that actually distinguishes one from another in the list.
  const isWorld = !!pull.world;
  const totalDamage = (pull.damage || []).reduce((n, d) => n + (d.total || 0), 0);
  const statusColor = isWorld ? 'var(--wow-muted)'
    : pull.success === true ? 'var(--wow-green)' : pull.success === false ? 'var(--wow-red)' : 'var(--wow-muted)';
  const statusLabel = isWorld ? (totalDamage >= 1000 ? `${Math.round(totalDamage / 1000)}k dmg` : `${totalDamage} dmg`)
    : pull.success === true ? 'Kill' : pull.success === false ? 'Wipe' : '—';
  const difficultyInfo = pull.difficulty != null ? WOW_DIFFICULTY[pull.difficulty] : null;
  const subtitle = isWorld ? ''
    : pull.keystoneLevel ? `+${pull.keystoneLevel} Keystone`
    : difficultyInfo ? difficultyInfo.name
    : (pull.difficulty != null ? `Difficulty ${pull.difficulty}` : '');
  const subtitleColor = difficultyInfo?.color || 'var(--wow-muted)';
  const maxDamage = Math.max(1, ...pull.damage.map(d => d.total));
  const maxHealing = Math.max(1, ...pull.healing.map(d => d.total));
  const maxIncoming = Math.max(1, ...(pull.incoming || []).map(d => d.total));

  const combatantsByGuid = {};
  (pull.combatants || []).forEach(c => { combatantsByGuid[c.guid] = c; });
  const loadoutRows = pull.damage.concat(pull.healing.filter(h => !pull.damage.some(d => d.guid === h.guid)));

  return html`
    <div class="wow-card" style="margin:0 12px 10px;padding:0;overflow:hidden;">
      <div style="cursor:pointer;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;" onClick=${onToggle}>
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          ${!isWorld && html`
            ${pull.iconUrl
              ? html`<img src=${pull.iconUrl} alt="" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0;border:1px solid var(--wow-border2);"
                     onError=${e => { e.target.style.display = 'none'; }} />`
              : html`<div style="width:32px;height:32px;border-radius:4px;flex-shrink:0;border:1px solid var(--wow-border2);background:var(--wow-surface2);display:flex;align-items:center;justify-content:center;font-size:15px;" title="No portrait available yet for this content">${difficultyInfo?.icon || '⚔️'}</div>`}
          `}
          <div style="min-width:0;">
            <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${pull.name || 'Unknown Encounter'}</div>
            <div style="font-family:var(--wow-mono);font-size:10px;color:${subtitleColor};">${subtitle}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-family:var(--wow-display);font-size:11px;color:${statusColor};">${statusLabel}</span>
          <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${wowPullFmtDuration(pull.durationMs)}</span>
          <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">${expanded ? '▾' : '▸'}</span>
        </div>
      </div>
      ${expanded && html`
        <div style="padding:0 12px 12px;border-top:1px solid var(--wow-border2);">
          <${WowPullSection} title="DAMAGE DONE" icon="⚔️" color="var(--wow-red)" count=${pull.damage.length} defaultOpen=${true}>
            ${pull.damage.length > 0
              ? pull.damage.map(r => html`<${WowPullMeterRow} row=${r} maxTotal=${maxDamage} color="var(--wow-red)" combatant=${combatantsByGuid[r.guid]} />`)
              : html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No data.</div>`}
          <//>

          <${WowPullSection} title="HEALING DONE" icon="✚" color="var(--wow-green)" count=${pull.healing.length} defaultOpen=${true}>
            ${pull.healing.length > 0
              ? pull.healing.map(r => html`<${WowPullMeterRow} row=${r} maxTotal=${maxHealing} color="var(--wow-green)" combatant=${combatantsByGuid[r.guid]} />`)
              : html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No data.</div>`}
          <//>

          ${(pull.incoming || []).length > 0 && html`
            <${WowPullSection} title="DAMAGE TAKEN — FROM ENEMIES" icon="🛡️" color="var(--wow-gold)" count=${pull.incoming.length} defaultOpen=${false}>
              ${pull.incoming.map(r => html`<${WowPullMeterRow} row=${r} maxTotal=${maxIncoming} color="var(--wow-gold)" combatant=${combatantsByGuid[r.guid]} />`)}
            <//>`}

          <${WowPullSection} title="DEATHS" icon="💀" color=${(pull.deaths || []).length > 0 ? 'var(--wow-red)' : 'var(--wow-muted)'} count=${(pull.deaths || []).length} defaultOpen=${false}>
            ${(pull.deaths || []).length === 0
              ? html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No deaths.</div>`
              : pull.deaths.map(d => html`
                <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--wow-border2);">
                  <span style="font-family:var(--wow-display);font-size:12px;color:var(--wow-text);width:90px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.name}</span>
                  <span style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);">
                    ${d.killingBlow ? html`killed by <span style="color:var(--wow-red);">${d.killingBlow.spell}</span> (${d.killingBlow.source})` : 'cause unknown'}
                  </span>
                </div>
              `)}
          <//>

          <${WowPullSection} title="PARTY LOADOUT" icon="🎽" color="var(--wow-accent)" count=${loadoutRows.length} defaultOpen=${false}>
            ${loadoutRows.length > 0
              ? loadoutRows.map(row => html`
                <div style="margin-bottom:12px;">
                  <div style="font-family:var(--wow-display);font-size:12px;color:var(--wow-gold);margin-bottom:4px;">${row.name || row.guid}</div>
                  <${WowPullLoadout} combatant=${combatantsByGuid[row.guid]} />
                </div>
              `)
              : html`<div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">No loadout data captured for this pull.</div>`}
          <//>

          <div style="margin-top:10px;font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);">Reported by ${(pull.reportedBy || []).join(', ')}</div>
        </div>
      `}
    </div>`;
}

function WowPulls() {
  const [pullsData, setPullsData] = useState(null);
  const [pullsErr, setPullsErr] = useState(null);
  const [expandedPull, setExpandedPull] = useState(null);
  // Local client status: is tailing on, and is WoW actually writing right now.
  // Without this the empty state can only repeat setup instructions, even to a
  // player whose logging is working fine and simply has not pulled a boss.
  const [clStatus, setClStatus] = useState(null);

  const loadPulls = () => {
    req('/api/wow/combatlog/pulls?limit=30')
      .then(res => {
        if (!res.ok) throw new Error(res.status === 401 ? 'Not authorised' : `HTTP ${res.status}`);
        return res.json();
      })
      .then(d => { setPullsData(d); setPullsErr(null); })
      .catch(e => setPullsErr(e.message));
  };

  useEffect(() => {
    loadPulls();
    const loadStatus = () => {
      // Served by the local client (app.py), not the backend.
      fetch('/api/wow/combatlog/status')
        .then(r => r.ok ? r.json() : null)
        .then(setClStatus)
        .catch(() => setClStatus(null));
    };
    loadStatus();

    // This tab is meant to sit open on a second monitor while you play, so it
    // has to refresh itself - the tailer posts a pull up to POLL_INTERVAL (10s)
    // after a fight ends, and nobody is going to alt-tab and hit the reload
    // arrow between every pull. Skip the poll while the tab is hidden so a
    // backgrounded window is not fetching all day.
    // SSE gets a new pull on screen as soon as the backend ingests it, instead
    // of waiting out this component's own interval on top of the tailer's.
    // The poll below stays as the fallback: EventSource cannot send an auth
    // header, so this only connects where the session rides a cookie, and it
    // is one more thing that can silently drop.
    let es = null;
    try {
      const tok = authPair().token;
      es = tok ? new EventSource(`${PUBLIC_ORIGIN}/api/wow/combatlog/stream?token=${encodeURIComponent(tok)}`) : null;
      if (es) es.onmessage = (m) => {
        try { if (JSON.parse(m.data)?.type === 'pull') loadPulls(); } catch {}
      };
      if (es) es.onerror = () => { try { es.close(); } catch {} es = null; };
    } catch { es = null; }

    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadPulls();
      loadStatus();
    }, 10000);

    // Coming back to the window should show current data immediately rather
    // than up to 10s of staleness.
    const onVisible = () => { if (!document.hidden) { loadPulls(); loadStatus(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(iv); if (es) { try { es.close(); } catch {} } document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  if (pullsErr) {
    return html`<div class="wow-card" style="margin:12px;">
      <div style="font-family:var(--wow-display);font-size:13px;color:var(--wow-red);margin-bottom:6px;">Pull data unavailable</div>
      <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">${pullsErr}</div>
    </div>`;
  }
  if (!pullsData) {
    return html`<div style="padding:20px;color:var(--wow-muted);font-family:var(--wow-mono);font-size:12px;">Loading pulls…</div>`;
  }

  const pulls = pullsData.pulls || [];

  return html`
    <div>
      <div style="display:flex;padding:10px 12px 0;">
        <div style="margin-left:auto;font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);cursor:pointer;padding:5px;"
             onClick=${loadPulls}>⟳</div>
      </div>
      ${pulls.length === 0
        ? html`<div class="wow-card" style="margin:12px;">
            ${clStatus && clStatus.enabled && clStatus.live
              ? html`
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                  <div class="dot dot-green"></div>
                  <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;color:var(--wow-green);">Combat logging is live</span>
                </div>
                <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);line-height:1.7;">
                  WoW is writing${clStatus.size ? html` (${(clStatus.size / 1048576).toFixed(1)} MB` : ''}${clStatus.size ? html`, last write ${clStatus.ageSeconds}s ago)` : ''}
                  and GamezNET is tailing it.
                  <br/>
                  Boss encounters and Mythic+ runs are recorded by name; ordinary combat is grouped
                  into <span style="color:var(--wow-gold);">Open World</span> pulls that close after
                  5 seconds out of combat. Very short or trivial fights are skipped.
                  <br/>
                  Pulls appear within about 10 seconds of a fight ending.
                </div>`
              : clStatus && clStatus.enabled && clStatus.found
                ? html`
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <div class="dot dot-gold"></div>
                    <span style="font-family:var(--wow-display);font-size:13px;font-weight:600;">Tailing, but WoW is not writing</span>
                  </div>
                  <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);line-height:1.7;">
                    A log file exists but has not been written to recently${clStatus.ageSeconds != null ? html` (${Math.round(clStatus.ageSeconds / 60)} min ago)` : ''}.
                    <span style="color:var(--wow-gold);">/combatlog</span> resets between sessions — re-run it in game.
                  </div>`
                : html`
                  <div style="font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);line-height:1.7;">
                    ${clStatus && !clStatus.enabled
                      ? html`Combat log tailing is <span style="color:var(--wow-gold);">off</span> in GamezNET — turn it on in the desktop app, then in game run
                          <span style="color:var(--wow-gold);">/gzn log on</span> so logging survives each session.`
                      : html`No pulls recorded yet. In the desktop app, enable combat log tailing; in game run
                          <span style="color:var(--wow-gold);">/gzn log on</span>
                          (and <span style="color:var(--wow-gold);">/console advancedCombatLogging 1</span> for full detail).
                          ${'' /* status is only readable from the desktop client, so on mobile this is all we can say */}
                          Both boss encounters and ordinary <span style="color:var(--wow-gold);">Open World</span> combat are recorded.`}
                  </div>`}
          </div>`
        : pulls.map(p => html`<${WowPullCard} pull=${p} expanded=${expandedPull === p.id} onToggle=${() => setExpandedPull(expandedPull === p.id ? null : p.id)} />`)}
    </div>
  `;
}

// Privacy controls. The backend is the enforcement point; this only edits the
// stored tier per field.
function WowPrivacy({ privacy, onChange }) {
  const [busy, setBusy] = useState(null);

  const FIELDS = [
    { id: 'gold',       label: 'Gold',            hint: 'aggregate = group total + your rank only' },
    { id: 'currencies', label: 'Currencies',      hint: 'valorstones, crests, flightstones' },
    { id: 'counts',     label: 'Bag/bank counts', hint: 'how full your bags are, not what is in them' },
    { id: 'bags',       label: 'Bag contents',    hint: 'the actual items in bags, bank and warband' },
    { id: 'played',     label: 'Played time',     hint: '/played per character · public by default' },
    { id: 'housing',    label: 'Player Estate',   hint: 'house name, plot and neighborhood · public by default, aggregate/private both hide it' },
  ];
  const TIERS = ['private', 'aggregate', 'public'];

  const set = async (field, tier) => {
    setBusy(field);
    try {
      const res = await req('/api/wow/addon/privacy', {
        method: 'POST',
        body: JSON.stringify({ field, tier })
      });
      if (res.ok) {
        const d = await res.json();
        onChange(d.privacy);
      }
    } catch (e) {}
    setBusy(null);
  };

  if (!privacy) return null;

  return html`
    <div class="wow-card" style="margin-bottom:12px;">
      <div style="font-family:var(--wow-display);font-size:12px;letter-spacing:1px;color:var(--wow-gold);margin-bottom:4px;">ADDON PRIVACY</div>
      <div style="font-family:var(--wow-mono);font-size:10px;color:var(--wow-muted);margin-bottom:10px;line-height:1.6;">
        Controls what other GamezNET players see. Enforced on the server — nobody, including the admin, sees more than this allows.
      </div>
      ${FIELDS.map(f => html`
        <div style="padding:7px 0;border-bottom:1px solid var(--wow-border2);">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-family:var(--wow-display);font-size:12px;color:var(--wow-text);">${f.label}</div>
              <div style="font-family:var(--wow-mono);font-size:9px;color:var(--wow-muted);">${f.hint}</div>
            </div>
            <div style="display:flex;gap:3px;opacity:${busy === f.id ? 0.4 : 1};">
              ${TIERS.map(t => html`
                <div onClick=${() => busy || set(f.id, t)}
                     style="font-family:var(--wow-mono);font-size:9px;padding:3px 7px;border-radius:3px;cursor:pointer;text-transform:uppercase;
                            background:${privacy[f.id] === t ? 'var(--wow-gold-dim)' : 'var(--wow-surface2)'};
                            color:${privacy[f.id] === t ? 'var(--wow-gold)' : 'var(--wow-muted)'};">
                  ${t === 'aggregate' ? 'agg' : t}
                </div>
              `)}
            </div>
          </div>
        </div>
      `)}
    </div>
  `;
}

function WowCharBar({ characters, activeChar, subTab, onSelect, charCacheRef, dataTick }) {
  if (!['world', 'professions', 'pve', 'pvp'].includes(subTab)) return null;

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
  const [subTab, setSubTab] = useState(
    (typeof window !== 'undefined' && window.GZN_WOW_ROUTE) || HOST.defaultTab || 'overview');
  const [loading, setLoading] = useState(true);
  const [dataTick, setDataTick] = useState(0); // Forces re-render when background data loads
  const [resetStr, setResetStr] = useState('—');
  const [tokenPrice, setTokenPrice] = useState('Fetching...');
  const [tokenTrend, setTokenTrend] = useState(null); // 'up' | 'down' | null
  const [addon, setAddon] = useState(null);
  const [addonErr, setAddonErr] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const charCacheRef = useRef({});
  const affixCacheRef = useRef(null);
  const bnetTokenRef = useRef(null);
  const collectionsRef = useRef({});
  // Static decor reference catalogue (~2,138 rows: id/name/icon/category),
  // shared across every character - not per-character like collectionsRef.
  // Fetched once per WoW-tab session, not per character switch.
  const decorCatalogRef = useRef(null);
  // Static pet reference catalogue (~2,179 rows: species id/name/icon/
  // Wowhead npc id) - fixes the Browse view's broken pet links, which
  // otherwise link with Blizzard's species id (wrong id space for Wowhead,
  // confirmed live 2026-09-10). Same fetch-once-per-session pattern.
  const petCatalogRef = useRef(null);
  // Whatever mount id -> spell id mappings someone's addon has captured so
  // far - not a full catalogue (no bulk source exists for mounts at all),
  // just whatever /api/wow/mount/spell-ids currently has on file.
  const mountSpellIdsRef = useRef(null);
  const scrollRef = useRef(null);
  const ptrRef = useRef({ startY: 0, active: false, busy: false });
  const pullYRef = useRef(0);

  const PTR_THRESHOLD = 65;

  const loadAddon = () => {
    req('/api/wow/addon/data')
      .then(res => {
        if (!res.ok) throw new Error(res.status === 401 ? 'Not authorised' : `HTTP ${res.status}`);
        return res.json();
      })
      .then(d => { setAddon(d); setPrivacy(d.privacy || null); setAddonErr(null); })
      .catch(e => setAddonErr(e.message));
  };

  const loadCharacters = () => {
    req('/api/wow/characters')
      .then(res => res.ok ? res.json() : [])
      .then(data => { setCharacters(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const fullRefresh = () => {
    if (ptrRef.current.busy) return;
    ptrRef.current.busy = true;
    charCacheRef.current = {};
    affixCacheRef.current = null;
    bnetTokenRef.current = null;
    setRefreshing(true);
    loadCharacters();
    loadAddon();
    setTimeout(() => { ptrRef.current.busy = false; setRefreshing(false); }, 1200);
  };

  useEffect(() => {
    injectWowAssets();
    loadCharacters();
    loadAddon();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onStart = (e) => {
      if (el.scrollTop === 0) { ptrRef.current.startY = e.touches[0].clientY; ptrRef.current.active = true; }
    };
    const onMove = (e) => {
      if (!ptrRef.current.active) return;
      if (el.scrollTop > 0) { ptrRef.current.active = false; pullYRef.current = 0; setPullY(0); return; }
      const dist = Math.max(0, Math.min(100, e.touches[0].clientY - ptrRef.current.startY));
      pullYRef.current = dist;
      setPullY(dist);
    };
    const onEnd = () => {
      if (ptrRef.current.active && pullYRef.current >= PTR_THRESHOLD) fullRefresh();
      ptrRef.current.active = false;
      pullYRef.current = 0;
      setPullY(0);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
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
              if (d?.price) {
                setTokenPrice(`${Math.floor(d.price / 10000).toLocaleString()}g`);
                // history is 30 days of daily min prices, oldest first -
                // same light-touch "trending" signal as the reagent prices.
                const hist = d.history || [];
                const weekAgo = hist.length >= 8 ? hist[hist.length - 8] : hist[0];
                if (weekAgo && d.price !== weekAgo.price) setTokenTrend(d.price > weekAgo.price ? 'up' : 'down');
              }
            });
          }
        } catch(e) {}
      }

      await Promise.all(characters.map(async (c) => {
        const cacheKey = `${c.region}-${c.realm}-${c.name}`;
        try {
          const have = charCacheRef.current[cacheKey]?._bnet;
          const usable = have && (have.equipment?.equipped_items?.length || have._noGear);
          if (!usable) {
            const res = await req(`/api/wow/profile?region=${c.region||'us'}&realm=${c.realm}&name=${c.name}`);
            if (res.ok) {
              const data = await res.json();
              // A character can genuinely have no equipment (fresh alt), so mark
              // that case rather than retrying it forever.
              if (!data.equipment?.equipped_items?.length && data.profile) data._noGear = true;
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

  // `short` is a real fixed abbreviation for the mid-width tier, not a
  // CSS ellipsis truncation - equal-width flex-shrink + text-overflow:
  // ellipsis was tried first and landed every tab in an unreadable 3-letter
  // zone ("OVERVI...", "GRO...") at nearly every width in between the
  // full-label and icon-only breakpoints, confirmed live 2026-09-11 via
  // screenshot. A hand-picked short label reads correctly at every width
  // that tier applies to, instead of depending on where the ellipsis
  // happens to land.
  const tabs = [
    { id: 'hub',      icon: '🏠', label: 'Hub',            short: 'Hub' },
    { id: 'overview', icon: '🌐', label: 'Overview',       short: 'Overview' },
    { id: 'world',    icon: '🌍', label: 'Collections',    short: 'Collect.' },
    { id: 'professions', icon: '🛠️', label: 'Professions', short: 'Prof' },
    { id: 'ah',       icon: '📈', label: 'Auction House',  short: 'AH' },
    { id: 'pve',      icon: '⚔️', label: 'PVE',            short: 'PVE' },
    { id: 'pvp',      icon: '🏆', label: 'PVP',            short: 'PVP' },
    { id: 'group',    icon: '👥', label: 'Group',          short: 'Group' },
    { id: 'keys',     icon: '🗝️', label: 'Progress',       short: 'Prog.' },
    { id: 'pulls',    icon: '⚔️', label: 'Pulls',          short: 'Pulls' },
    { id: 'account',  icon: '👤', label: 'My Account',     short: 'Account' },
    // Tabs the host adds - desktop appends Addon here; mobile adds none.
    ...(HOST.extraTabs || []),
  ];

  // Host tabs render an empty slot; the host fills it. This fires after the
  // slot is in the DOM and again on every tab change, so switching away and
  // back re-populates it.
  useEffect(() => {
    if ((HOST.extraTabs || []).some(t => t.id === subTab) && HOST.onHostTab) HOST.onHostTab(subTab);
    // Report the sub-tab so the host can keep #wow/<sub> in the URL.
    if (typeof window !== 'undefined' && window.wowRouteSubTab) window.wowRouteSubTab(subTab);
  }, [subTab]);

  // Expose the component's refresh so host chrome (the desktop REFRESH button)
  // can drive the same path pull-to-refresh uses on mobile.
  useEffect(() => {
    if (typeof window !== 'undefined') window.wowFullRefresh = fullRefresh;
    return () => { if (typeof window !== 'undefined' && window.wowFullRefresh === fullRefresh) delete window.wowFullRefresh; };
  });

  const ptrHeight = refreshing ? 44 : Math.min(44, pullY * 0.6);
  const ptrReady = pullY >= PTR_THRESHOLD;

  return html`
    <div class="wow-wrap scroll" ref=${scrollRef}>
      <div class="wow-ptr" style="height:${ptrHeight}px;opacity:${ptrHeight > 4 ? 1 : 0};">
        <div class="wow-ptr-icon ${refreshing ? 'spinning' : (ptrReady ? 'ready' : '')}"
             style="transform:rotate(${refreshing ? 'none' : `${Math.min(pullY * 2.5, 180)}deg`});">⟳</div>
      </div>
      <div class="wow-topbar">
        <div style="font-family:var(--wow-display);font-size:16px;font-weight:700;color:var(--wow-accent);letter-spacing:2px;">GamezNET <span style="color:var(--wow-border2)">/</span> <span style="color:var(--wow-gold);display:inline-flex;align-items:center;gap:6px;"><img src="${ASSETS}/WoW_icon.svg" style="height:16px;" alt="WoW"/></span></div>
        <div style="display:flex;align-items:center;gap:12px;font-family:var(--wow-mono);font-size:11px;color:var(--wow-muted);">
          <div class="wow-roster-count">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="6" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/>
              <path d="M1.6 13.4c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M11.2 4.2a2.3 2.3 0 0 1 0 4.3M12.4 13.4c0-1.9-.7-3.1-1.9-3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
            <span>${characters.length} character${characters.length === 1 ? '' : 's'}</span>
          </div>
          <div id="wow-host-controls"></div>
        </div>
      </div>
      <div class="reset-banner">
        <div class="reset-label">⟳ weekly reset</div>
        <div class="reset-time">${resetStr}</div>
        <div class="reset-divider">|</div>
        <div class="reset-label">tue 15:00 utc · na</div>
        <div class="reset-divider">|</div>
        <div class="wow-token-chip" title="WoW Token — current buy price on the US region auction house. ${tokenTrend ? (tokenTrend === 'up' ? 'Up' : 'Down') + ' from a week ago. ' : ''}Updates roughly every 20 minutes.">
          <img src="${ASSETS}/wow-token.svg" class="wow-token-icon" alt="" onerror=${e => { e.target.style.display = 'none'; }} />
          <span class="wow-token-label">token</span>
          <span class="wow-token-price">${tokenPrice}${tokenTrend === 'up' ? html`<span style="color:var(--wow-red);"> ▲</span>` : tokenTrend === 'down' ? html`<span style="color:var(--wow-green);"> ▼</span>` : ''}</span>
        </div>
      </div>
      <div class="wow-nav-tabs">
        ${tabs.map(t => html`
          <div class="wow-nav-tab ${subTab === t.id ? `active tab-${t.id}`:''}" title="${t.label}" onClick=${() => {
            setSubTab(t.id);
            if (t.id === 'overview') setActiveChar(-1);
          }}>
            <span class="tab-icon">${t.icon}</span><span class="tab-label"> ${t.label}</span><span class="tab-label-short"> ${t.short || t.label}</span>
          </div>
        `)}
      </div>
      <${WowCharBar} characters=${characters} activeChar=${activeChar} subTab=${subTab} onSelect=${(idx) => { setActiveChar(idx); if (idx === -1) setSubTab('overview'); else if (subTab === 'overview') setSubTab('world'); }} charCacheRef=${charCacheRef} dataTick=${dataTick} />
      ${loading ? html`<div style="padding: 20px; color: var(--wow-muted);">Loading roster...</div>` : html`
        ${subTab === 'hub'     && html`<${WowHub} addon=${addon} addonErr=${addonErr} onReload=${loadAddon} charCacheRef=${charCacheRef} onOpen=${(tab) => setSubTab(tab)} />`}
        ${subTab === 'overview' && html`<${WowOverview} characters=${characters} charCacheRef=${charCacheRef} affixCacheRef=${affixCacheRef} onSelectChar=${setActiveChar} onSubTab=${setSubTab} dataTick=${dataTick} addon=${addon} />`}
        ${subTab === 'world'    && html`<${WowWorld}    characters=${characters} activeChar=${activeChar} charCacheRef=${charCacheRef} bnetTokenRef=${bnetTokenRef} collectionsRef=${collectionsRef} decorCatalogRef=${decorCatalogRef} petCatalogRef=${petCatalogRef} mountSpellIdsRef=${mountSpellIdsRef} dataTick=${dataTick} addon=${addon} />`}
        ${subTab === 'professions' && html`<${WowProfessions} characters=${characters} activeChar=${activeChar} charCacheRef=${charCacheRef} dataTick=${dataTick} addon=${addon} />`}
        ${subTab === 'ah'          && html`<${WowAH} tokenPrice=${tokenPrice} tokenTrend=${tokenTrend} />`}
        ${subTab === 'pve'      && html`<${WowPVE}      character=${characters[activeChar]} charCacheRef=${charCacheRef} dataTick=${dataTick} />`}
        ${subTab === 'pvp'      && html`<${WowPVP}      character=${characters[activeChar]} charCacheRef=${charCacheRef} dataTick=${dataTick} />`}
        ${subTab === 'group'   && html`<${WowGroup} addon=${addon} addonErr=${addonErr} onReload=${loadAddon} />`}
        ${subTab === 'keys'    && html`<${WowKeys}  addon=${addon} addonErr=${addonErr} onReload=${loadAddon} />`}
        ${subTab === 'pulls'   && html`<${WowPulls} />`}
        ${subTab === 'account' && html`<${WowAccount} me=${me} characters=${characters} onRefresh=${loadCharacters} privacy=${privacy} onPrivacyChange=${setPrivacy} />`}
        ${(HOST.extraTabs || []).some(t => t.id === subTab) && html`<div id="wow-host-panel"></div>`}
      `}
    </div>
  `;
}