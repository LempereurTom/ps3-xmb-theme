/*
 * PS3 layer over Glass Dusk — Steam desktop client main window.
 *
 * Glass Dusk draws a dark "ground", the blurred art of the open game over it and smoked glass
 * on top. This script swaps the ground for the PS3 background (colour of the month, dimmed in
 * the evening) and draws the XMB wave, over the game art (default) or under it. It can also
 * hand Glass Dusk a PS3 accent colour.
 *
 * Settings arrive as custom properties from ps3/*.css (Millennium "Conditions"):
 *   --ps3-mode: off            Glass Dusk alone
 *   --ps3-choice: <colour>     a fixed PS3 colour (default: the month's, "Original")
 *   --ps3-wave: live | off     an animated wave, or none (default: still — see PERFORMANCE)
 *   --ps3-wave-under: 1        the wave goes under the game art instead of over it
 *   --ps3-accent: on           accent = PS3 colour (sets Glass Dusk's accent lock)
 *   --ps3-night: off           no evening dimming
 *   --ps3-glass: own           keep the Colors tab's glass tint instead of the PS3 one
 *
 * PERFORMANCE — the library's glass is a backdrop-filter blur. Anything that moves behind it
 * makes the browser blur the whole pane again, every frame. So the wave is drawn once (and again
 * only on resize or a colour change) unless «Vague: animée» is chosen, and even then it runs at
 * 15 fps, stops while the window is hidden, unfocused (you are playing) or Glass Dusk's still
 * shows. Settings are read once a minute, never per frame (getComputedStyle forces a style pass).
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
  const settings = { on: true, wave: 'still', under: false };
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
    settings.wave = ['live', 'off'].includes(prop('--ps3-wave')) ? prop('--ps3-wave') : 'still';
    settings.under = prop('--ps3-wave-under') === '1';
    const motionOff = prop('--gd-motion') === 'off' || reduceMotion.matches;
    if (settings.wave === 'live' && motionOff) settings.wave = 'still';
    root.classList.toggle('ps3-on', settings.on);
    root.classList.toggle('ps3-glass', prop('--ps3-glass') !== 'own');
    root.classList.toggle('ps3-wave-off', !settings.on || settings.wave === 'off');
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
  const night = document.createElement('div');
  night.id = 'ps3-night';
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });

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

  // Gradients depend only on the canvas size: built once per resize.
  let sheet = null, fade = null, rows = [];
  function prepare() {
    const w = canvas.width, h = canvas.height;
    sheet = ctx.createLinearGradient(0, h * 0.45, 0, h * 0.8);
    sheet.addColorStop(0, 'rgba(255,255,255,0.15)'); sheet.addColorStop(1, 'rgba(255,255,255,0)');
    fade = ctx.createLinearGradient(0, 0, w, 0);
    fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(0.18, '#fff'); fade.addColorStop(0.82, '#fff'); fade.addColorStop(1, 'rgba(255,255,255,0)');
    const points = Math.ceil(w / Math.max(4, Math.round(w / 90))) + 3;
    rows = Array.from({ length: STRANDS }, () => new Float32Array(points));
  }

  function draw(t) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h || !sheet) return;
    ctx.clearRect(0, 0, w, h);
    const step = Math.max(4, Math.round(w / 90));
    const n = rows[0].length;
    for (let i = 0; i < STRANDS; i++) for (let j = 0; j < n; j++) rows[i][j] = ribbonY(-step + j * step, w, h, t, i);
    ctx.fillStyle = sheet;
    ctx.beginPath();
    for (let j = 0; j < n; j++) { const x = -step + j * step; j ? ctx.lineTo(x, rows[0][j]) : ctx.moveTo(x, rows[0][j]); }
    for (let j = n - 1; j >= 0; j--) ctx.lineTo(-step + j * step, rows[STRANDS - 1][j]);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = fade; ctx.lineWidth = Math.max(1.5, w / 600);
    for (let i = 0; i < STRANDS; i++) {
      ctx.globalAlpha = 0.16 + 0.5 * Math.pow(Math.sin(Math.PI * i / (STRANDS - 1)), 2);
      ctx.beginPath();
      for (let j = 0; j < n; j++) { const x = -step + j * step; j ? ctx.lineTo(x, rows[i][j]) : ctx.moveTo(x, rows[i][j]); }
      ctx.stroke();
    }
    for (const s of sparks) {
      const x = ((s.x + t * s.speed) % 1.1 - 0.05) * w;
      const y = ribbonY(x, w, h, t, Math.round(s.drift * (STRANDS - 1))) + Math.sin(t * 0.5 + s.phase) * h * 0.03;
      const r = s.r * (w / 960) * 3;
      ctx.globalAlpha = 0.25 + 0.55 * Math.max(0, Math.sin(t * 0.9 + s.phase));
      ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
  }

  let t = 37, last = 0, frame = 0, resizeTimer = 0;
  const resize = () => {
    const w = Math.max(320, Math.round(innerWidth * 0.5));
    const h = Math.max(200, Math.round(innerHeight * 0.5));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; prepare(); }
    draw(t);
  };
  const running = () => settings.on && settings.wave === 'live' && !document.hidden && document.hasFocus() &&
    !root.classList.contains('gd-still');
  function loop(time) {
    frame = 0;
    if (!running()) return;               // stopped; resumed by focus/visibility events
    frame = requestAnimationFrame(loop);
    if (time - last < 66) return;         // 15 fps: smooth for a slow wave, light on the blur
    t += Math.min(0.1, (time - (last || time)) / 1000);
    last = time;
    draw(t);
  }
  const wake = () => { if (!frame && running()) { last = 0; frame = requestAnimationFrame(loop); } };

  // Keep our layers beside Glass Dusk's art layer: the wave right after #gd-art (over the art),
  // or right before it with «Vague: sous l'art du jeu». Only reorders when needed.
  function mount() {
    const body = document.body;
    if (!accentSheet.isConnected && document.head) document.head.appendChild(accentSheet);
    const found = document.getElementById('gd-art');
    const art = found && found.parentNode === body ? found : null;
    // The wanted order of the layers; nothing moves when it is already right, so the
    // MutationObserver that calls mount() settles after one pass instead of looping.
    const order = !art ? [canvas, night] : settings.under ? [canvas, art, night] : [art, canvas, night];
    const inPlace = order.every((node, i) => node.parentNode === body && (i === 0 || order[i - 1].nextSibling === node)) &&
      (art || body.firstChild === canvas);
    if (inPlace) return;
    if (!art) { body.insertBefore(canvas, body.firstChild); body.insertBefore(night, canvas.nextSibling); return; }
    if (settings.under) { body.insertBefore(canvas, art); body.insertBefore(night, art.nextSibling); }
    else { body.insertBefore(canvas, art.nextSibling); body.insertBefore(night, canvas.nextSibling); }
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

  let tries = 0;
  function start() {
    const body = document.body;
    if (!body) { setTimeout(start, 200); return; }
    // The wave is for the main window only (Glass Dusk gives it body.DesktopUI, sometimes a
    // moment after the page loads, so look again for up to ten seconds).
    if (!body.classList.contains('DesktopUI')) {
      if (++tries < 25) setTimeout(start, 400);
      else accentOnly();
      return;
    }
    refresh();
    setInterval(refresh, 60 * 1000);
    // dusk.js mounts #gd-art itself; follow it without watching the whole tree.
    new MutationObserver(mount).observe(body, { childList: true });
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
    addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    reduceMotion.addEventListener?.('change', refresh);
    // Leaving Glass Dusk's still resumes the wave.
    new MutationObserver(wake).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  start();
})();
