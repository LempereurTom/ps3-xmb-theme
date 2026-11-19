/*
 * PS3 layer over Glass Dusk — the Steam desktop window and Big Picture.
 *
 * Glass Dusk draws a dark "ground", the blurred art of the open game over it and smoked glass
 * on top. This script swaps the ground for the PS3 background (colour of the month, dimmed in
 * the evening) and draws the XMB wave, over the game art (default) or under it. It can also
 * hand Glass Dusk a PS3 accent colour.
 *
 * Settings arrive as custom properties from ps3/*.css (Millennium "Conditions"):
 *   --ps3-mode: off            Glass Dusk alone
 *   --ps3-choice: <colour>     a fixed PS3 colour (default: the month's, "Original")
 *   --ps3-wave: still | off    a still wave, or none (default: animated — see PERFORMANCE)
 *   --ps3-wave-under: 1        the wave goes under the game art instead of over it
 *   --ps3-accent: on           accent = PS3 colour (sets Glass Dusk's accent lock)
 *   --ps3-night: off           no evening dimming
 *   --ps3-glass: own           keep the Colors tab's glass tint instead of the PS3 one
 *
 * PERFORMANCE — the desktop library's glass is a backdrop-filter blur, and anything moving
 * behind it makes the browser blur every pane again. The wave always stays BEHIND Steam (on
 * top it crossed the game art). On the desktop it is never redrawn while it moves: two layers
 * are painted once, a little wider than the window, and drift and sway by CSS transform (the
 * GPU moves them, smooth at the screen's rate, nothing on the main thread, nothing uploaded).
 * Two layers at different speeds give back the PS3's rolling motion. The glass blur is lighter
 * meanwhile (14 px instead of 30). In Big Picture (no backdrop blur) the wave is drawn live at
 * 30 fps. Everything stops while the window is hidden or unfocused (you are playing) and under
 * Glass Dusk's still. «Vague: fixe» draws it once, at full blur.
 * Settings are read once a minute, never per frame (getComputedStyle forces a style pass).
 */
(() => {
  if (window.__ps3GlassDusk) return;
  window.__ps3GlassDusk = true;

  const root = document.documentElement;

  const MONTHS = ['silver', 'gold', 'lime', 'pink', 'green', 'purple', 'teal', 'sky', 'blue', 'violet', 'brown', 'red'];
  // [dark, mid, light, accent, accent-2] — accents are the PS3 colour lifted to read on smoked glass.
  const COLOURS = {
    silver: ['#3b3f45', '#8a9096', '#d9dde0', '#b9c3cc', '#dfe6ec'], gold: ['#4a3a06', '#a68b1d', '#f0dc7a', '#e0b93a', '#f2d46b'],
    lime: ['#2a4708', '#71a823', '#c9ec7c', '#94cf3a', '#c4e86a'], pink: ['#5c1840', '#c25596', '#f6b7d8', '#e46fae', '#f29ac7'],
    green: ['#08391a', '#23843f', '#86d690', '#3fb35f', '#7fd68a'], purple: ['#311144', '#7a3ca6', '#c99ae6', '#a35fd6', '#c58ae8'],
    teal: ['#06393f', '#16909a', '#7fe0e0', '#25b8c2', '#6fdcd8'], sky: ['#0f3d66', '#3d8fd0', '#a6dcf7', '#5aaee8', '#8fd0f5'],
    blue: ['#05173f', '#1b4ca8', '#6b9ae6', '#3f7ae0', '#6fa0f0'], violet: ['#1d0d42', '#56309a', '#a68ade', '#7d55d0', '#a487e6'],
    brown: ['#2d1806', '#7a4a1f', '#c49564', '#c8803f', '#e0a96c'], red: ['#3f0306', '#a3161c', '#ee6a5e', '#e0403a', '#f0766a'],
    black: ['#000000', '#111317', '#3a3e45', '#9aa3ad', '#c8ced5'],
  };

  const nightLevel = date => {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 7 && h < 18) return 0;
    if (h >= 18 && h < 21) return (h - 18) / 3;
    if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
    return 1;
  };
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // The settings, read in one style pass and cached (see PERFORMANCE).
  const settings = { on: true, wave: 'live', under: false };
  // Big Picture: Glass Dusk's art layer is #gd-bpm-bg inside #GamepadUI_Full_Root.
  let bpm = false;
  const host = () => (bpm ? document.getElementById('GamepadUI_Full_Root') : document.body);
  const artId = () => (bpm ? 'gd-bpm-bg' : 'gd-art');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Glass Dusk removes its inline accent while the accent is locked, so the PS3 accent is a
  // stylesheet rule (html:root outranks css/root.css's :root) and never fights js/dusk.js.
  const accentSheet = document.createElement('style');
  accentSheet.id = 'ps3-accent';
  let painted = '';

  function readSettings() {
    const style = getComputedStyle(root);
    const prop = name => style.getPropertyValue(name).trim();
    settings.on = prop('--ps3-mode') !== 'off';
    settings.wave = ['still', 'off'].includes(prop('--ps3-wave')) ? prop('--ps3-wave') : 'live';
    settings.under = prop('--ps3-wave-under') === '1';
    const motionOff = prop('--gd-motion') === 'off' || reduceMotion.matches;
    if (settings.wave === 'live' && motionOff) settings.wave = 'still';
    root.classList.toggle('ps3-on', settings.on);
    root.classList.toggle('ps3-glass', prop('--ps3-glass') !== 'own');
    root.classList.toggle('ps3-wave-off', !settings.on || settings.wave === 'off');
    root.classList.toggle('ps3-wave-live', settings.on && settings.wave === 'live');
    root.classList.toggle('ps3-drift', !bpm && settings.on && settings.wave === 'live');
    if (!settings.on) { accentSheet.textContent = ''; return; }

    const now = new Date();
    const choice = prop('--ps3-choice');
    const name = COLOURS[choice] ? choice : MONTHS[now.getMonth()];
    const [dark, mid, light, accent, accent2] = COLOURS[name];
    const night = prop('--ps3-night') === 'off' ? '0' : nightLevel(now).toFixed(2);
    // Only touch the root when something changed: each write restyles the whole window.
    const key = [name, night, prop('--ps3-accent')].join('|');
    if (key === painted) return;
    painted = key;
    root.style.setProperty('--ps3-dark', dark);
    root.style.setProperty('--ps3-mid', mid);
    root.style.setProperty('--ps3-light', light);
    root.style.setProperty('--ps3-night', night);
    accentSheet.textContent = prop('--ps3-accent') === 'on'
      ? `html:root { --gd-accent: ${accent}; --gd-accent-2: ${accent2}; --gd-accent-ink: ${luminance(accent) > 0.62 ? '#10131a' : '#ffffff'}; }`
      : '';
  }

  // ───────── the XMB wave (same maths as the Big Picture plugin) ─────────
  const STRANDS = 16;
  const canvas = document.createElement('canvas');
  canvas.id = 'ps3-wave';
  // Desktop only: a second layer of the wave, painted at another moment of its motion, drifting
  // at another speed (see PERFORMANCE).
  const canvas2 = document.createElement('canvas');
  canvas2.id = 'ps3-wave-2';
  const night = document.createElement('div');
  night.id = 'ps3-night';
  // Big Picture has no body::before to repaint: the PS3 colour is a layer of its own.
  const ground = document.createElement('div');
  ground.id = 'ps3-ground';

  // One pre-rendered sparkle, stamped with drawImage: no gradient objects per frame.
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  {
    const s = sprite.getContext('2d');
    const g = s.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, '#fff'); g.addColorStop(0.3, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = g; s.fillRect(0, 0, 32, 32);
  }
  const sparks = Array.from({ length: 20 }, (_, i) => ({
    x: (i * 0.618) % 1, r: 0.6 + ((i * 7) % 5) * 0.25, speed: 0.004 + ((i * 13) % 7) * 0.0012, phase: i * 1.7, drift: ((i * 5) % 11) / 10,
  }));

  const ribbonY = (x, w, h, t, i) => {
    const u = x / w, k = i / (STRANDS - 1);
    return h * (0.6 + 0.05 * Math.sin(u * 2.2 + t * 0.07))
      + Math.sin(u * 3.1 + t * 0.21 + k * 1.6) * h * (0.035 + 0.05 * k)
      + Math.sin(u * 5.3 - t * 0.13 + k * 0.9) * h * 0.022
      + (k - 0.5) * h * 0.11 * (0.65 + 0.35 * Math.sin(u * 2.5 - t * 0.17));
  };

  // Gradients and point buffers depend only on the canvas size: built once per resize.
  function painter(target) {
    const ctx = target.getContext('2d', { alpha: true, desynchronized: true });
    let sheet = null, fade = null, rows = [];
    return {
      resize(w, h) {
        if (w === target.width && h === target.height && sheet) return false;
        target.width = w; target.height = h;
        sheet = ctx.createLinearGradient(0, h * 0.45, 0, h * 0.8);
        sheet.addColorStop(0, 'rgba(255,255,255,0.15)'); sheet.addColorStop(1, 'rgba(255,255,255,0)');
        fade = ctx.createLinearGradient(0, 0, w, 0);
        fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(0.18, '#fff'); fade.addColorStop(0.82, '#fff'); fade.addColorStop(1, 'rgba(255,255,255,0)');
        const points = Math.ceil(w / Math.max(6, Math.round(w / 160))) + 3;
        rows = Array.from({ length: STRANDS }, () => new Float32Array(points));
        return true;
      },
      draw(t, sparkles = true) {
        const w = target.width, h = target.height;
        if (!w || !h || !sheet) return;
        ctx.clearRect(0, 0, w, h);
        const step = Math.max(6, Math.round(w / 160));
        const n = rows[0].length;
        for (let i = 0; i < STRANDS; i++) for (let j = 0; j < n; j++) rows[i][j] = ribbonY(-step + j * step, w, h, t, i);
        ctx.fillStyle = sheet;
        ctx.beginPath();
        for (let j = 0; j < n; j++) { const x = -step + j * step; j ? ctx.lineTo(x, rows[0][j]) : ctx.moveTo(x, rows[0][j]); }
        for (let j = n - 1; j >= 0; j--) ctx.lineTo(-step + j * step, rows[STRANDS - 1][j]);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = fade; ctx.lineWidth = Math.max(1, w / 1100);
        for (let i = 0; i < STRANDS; i++) {
          ctx.globalAlpha = 0.16 + 0.5 * Math.pow(Math.sin(Math.PI * i / (STRANDS - 1)), 2);
          ctx.beginPath();
          for (let j = 0; j < n; j++) { const x = -step + j * step; j ? ctx.lineTo(x, rows[i][j]) : ctx.moveTo(x, rows[i][j]); }
          ctx.stroke();
        }
        if (sparkles) for (const s of sparks) {
          const x = ((s.x + t * s.speed) % 1.1 - 0.05) * w;
          const y = ribbonY(x, w, h, t, Math.round(s.drift * (STRANDS - 1))) + Math.sin(t * 0.5 + s.phase) * h * 0.03;
          const r = s.r * (w / 960) * 3;
          ctx.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.sin(t * 0.9 + s.phase));
          ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;
      },
    };
  }
  const front = painter(canvas);
  const back = painter(canvas2);
  const drifting = () => !bpm && settings.on && settings.wave === 'live';

  let t = 37, last = 0, frame = 0, resizeTimer = 0;
  // Full resolution (it was half, and looked pixelated on a big screen), at most 2560 px wide.
  // Drifting layers are 40 % wider than the window, so their sway never shows an edge.
  const resize = () => {
    const ratio = Math.min(2, devicePixelRatio || 1, 2560 / Math.max(1, innerWidth));
    const wide = drifting() ? 1.4 : 1;
    const w = Math.max(320, Math.round(innerWidth * ratio * wide));
    const h = Math.max(200, Math.round(innerHeight * ratio));
    front.resize(w, h);
    front.draw(t);
    if (drifting()) { back.resize(w, h); back.draw(t + 23, false); }
  };
  // Live list: .length costs nothing per frame. The XMB (ps3/xmb.js or Decky's) covers the
  // Big Picture home with a wave of its own, so this one rests while it shows.
  const xmbRoots = document.getElementsByClassName('xmb-root');
  // The live redraw is for Big Picture only: on the desktop the layers drift by CSS.
  const running = () => bpm && settings.on && settings.wave === 'live' && !document.hidden && document.hasFocus() &&
    !root.classList.contains('gd-still') && !xmbRoots.length;
  function loop(time) {
    frame = 0;
    if (!running()) return;               // stopped; resumed by focus/visibility events
    frame = requestAnimationFrame(loop);
    if (time - last < (bpm ? 33 : 50)) return;   // 30 fps in Big Picture, 20 under the desktop glass
    t += Math.min(0.1, (time - (last || time)) / 1000) * 1.4;
    last = time;
    front.draw(t);
  }
  // Desktop: the CSS drift stops while Steam is hidden or unfocused (html.ps3-paused).
  const wake = () => {
    root.classList.toggle('ps3-paused', document.hidden || !document.hasFocus());
    if (!frame && running()) { last = 0; frame = requestAnimationFrame(loop); }
  };

  // Keep our layers beside Glass Dusk's art layer: the wave right after #gd-art (over the art),
  // or right before it with «Vague: sous l'art du jeu». Only reorders when needed.
  function mount() {
    const parent = host();
    if (!parent) return;
    if (!accentSheet.isConnected && document.head) document.head.appendChild(accentSheet);
    const found = document.getElementById(artId());
    const art = found && found.parentNode === parent ? found : null;
    // The wanted order of the layers, from the first child down; nothing moves when it is
    // already right, so the MutationObserver that calls mount() settles after one pass.
    const below = drifting() ? [canvas2, canvas] : [canvas];
    if (!drifting() && canvas2.parentNode) canvas2.remove();
    const layers = !art ? [...below, night] : settings.under ? [...below, art, night] : [art, ...below, night];
    const order = bpm ? [ground, ...layers] : layers;
    const inPlace = order.every((node, i) => node.parentNode === parent && (i === 0 ? parent.firstChild === node || (!bpm && art) : order[i - 1].nextSibling === node));
    if (inPlace) return;
    // Rebuild the sequence: the first layer where it must be, each next one right after.
    const first = order[0];
    if (bpm || !art) parent.insertBefore(first, parent.firstChild);
    else if (first !== art) parent.insertBefore(first, art);
    for (let i = 1; i < order.length; i++) parent.insertBefore(order[i], order[i - 1].nextSibling);
  }

  // Second way in for the XMB (ps3/xmb.js), besides the «XMB en Big Picture» condition: this
  // script is a ".*" patch, the kind Millennium is known to run in Big Picture (Glass Dusk's
  // is one). Its address comes from ps3/ps3-bpm.css, where a relative url() resolves to the
  // theme folder whatever Millennium serves it from. xmb.js runs once per window either way.
  let xmbAsked = false;
  function injectXmb() {
    if (xmbAsked || window.__ps3XmbStandalone) return;
    if (getComputedStyle(root).getPropertyValue('--ps3-xmb').trim() === 'off') return;
    const probe = document.createElement('div');
    probe.id = 'ps3-xmb-locator';
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const match = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(probe).backgroundImage || '');
    probe.remove();
    if (!match) return;
    xmbAsked = true;
    // Leave the condition's copy a moment to start first.
    setTimeout(() => {
      if (window.__ps3XmbStandalone || document.getElementById('ps3-xmb-script')) return;
      const script = document.createElement('script');
      script.id = 'ps3-xmb-script';
      script.src = match[1];
      (document.head || document.documentElement).appendChild(script);
    }, 2500);
  }

  function refresh() {
    readSettings();
    mount();
    resize();
    wake();
  }

  // Menus, settings, friends and other client windows: no wave, only the PS3 accent so they
  // wear the same colour as the main window. Web pages (store, community) keep Glass Dusk's own.
  function accentOnly() {
    if (root.classList.contains('MillenniumWindow_SteamBrowser')) return;
    const apply = () => {
      readSettings();
      if (!accentSheet.isConnected && document.head) document.head.appendChild(accentSheet);
    };
    apply();
    setInterval(apply, 5 * 60 * 1000);
  }

  // Steam can create the Big Picture window long before it is opened, and build its content
  // only then. So the check goes on for as long as the window lives (one class test and one
  // getElementById a second: nothing), instead of giving up after a few seconds.
  let tries = 0, started = false, accentStarted = false;
  function start() {
    if (started) return;
    const body = document.body;
    if (!body) { setTimeout(start, 200); return; }
    if (root.classList.contains('MillenniumWindow_SteamBrowser')) return;   // store & community pages
    bpm = /GamepadUIPopupWindowBody/.test(body.className) || /Big Picture/.test(document.title || '');
    if (bpm) root.classList.add('ps3-bpm');
    // Popup menus (the tray menu, the top bar's menus) and toasts carry DesktopUI too, but they are
    // sized to their menu: the wave's layers, unstyled there, pushed the tray menu 400 px down and
    // cut off its last items (Quit…). They only take the accent.
    const popup = /ContextMenuPopupBody|DesktopToastContainer/.test(body.className) || root.classList.contains('ContextMenuPopup');
    if (popup || !(body.classList.contains('DesktopUI') || (bpm && host()))) {
      // Menus and dialogs wear the PS3 accent meanwhile; they never become a main window.
      if (++tries === 10 && !accentStarted) { accentStarted = true; accentOnly(); }
      setTimeout(start, tries < 25 ? 400 : 1000);
      return;
    }
    started = true;
    refresh();
    setInterval(refresh, 60 * 1000);
    // dusk.js mounts its art layer itself: follow it, and in Big Picture look again every second
    // in case Steam rebuilt its root.
    new MutationObserver(mount).observe(host(), { childList: true });
    if (bpm) { setInterval(mount, 1000); injectXmb(); }
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
    addEventListener('focus', wake);
    addEventListener('blur', wake);
    if (bpm) setInterval(wake, 1000);   // resumes once the XMB gives way to another screen
    document.addEventListener('visibilitychange', wake);
    reduceMotion.addEventListener?.('change', refresh);
    // Leaving Glass Dusk's still resumes the wave.
    new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  start();
})();
