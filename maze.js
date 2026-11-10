// The FINAL final boss: a maze chase against rolling mini Rick heads.
// boss.js starts it after Rick has lost his head:
//   MazeFight.start(result => ...)   result is 'win', 'lose' or 'pressed'
// Eat bananas; every banana makes the snake drop a peel behind it. Heads that roll onto a peel slip and
// take damage. When every head is gone, a huge red button appears. Pressing it loses. Not pressing it wins.
(() => {
  // ---- The maze ('#' wall, '.' floor, 'H' where the heads come out, 'P' player start) ----
  const MAP = [
    '#####################',
    '#.........#.........#',
    '#.###.###.#.###.###.#',
    '#...................#',
    '#.###.#.#####.#.###.#',
    '#.....#...#...#.....#',
    '###.#.###.#.###.#.###',
    '#...#....HHH....#...#',
    '###.#.#.#####.#.#.###',
    '#.....#.......#.....#',
    '#.###.#.#####.#.###.#',
    '#...#.....P.....#...#',
    '###.#.###.#.###.#.###',
    '#.........#.........#',
    '#####################',
  ];
  const COLS = MAP[0].length, ROWS = MAP.length;

  // ---- Tunables ----
  const W = 960, H = 600;              // logical screen size; scaled to fit the window
  const PLAYER_SPEED = 6.2;            // tiles per second
  const HEAD_SPEED = 3.6, HEAD_SPEED_MAX = 5.4; // heads speed up as fewer are left
  const LIVES = 3, HEAD_COUNT = 3;
  const BANANAS_MAX = 10, PEELS_MAX = 16;
  const POCKET_MAX = 9;                // bananas you can carry to throw
  const THROW_SPEED = 13, THROW_COOLDOWN = 0.25;
  const VOICE_STUN = 2.5;              // saying "banana" stuns every head in place for this long
  const BUTTON_WAIT = 12;              // seconds of leaving the final button alone to truly win
  const VICTORY_POINTS = 500;          // the bonus for not pressing it (added to the snake score)

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up, right, down, left
  const clamp01 = t => Math.max(0, Math.min(1, t));
  const ease = t => 1 - Math.pow(1 - t, 3);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const wall = (x, y) => x < 0 || y < 0 || x >= COLS || y >= ROWS || MAP[y][x] === '#';
  const find = ch => { const out = []; MAP.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push({ x, y }); })); return out; };

  let root, cv, ctx, raf, last, done, ended, beatAt;
  let T, ox, oy;                       // tile size and maze offset on screen
  let thrown = []; // bananas flying through the corridors
  let waves = [];  // shockwaves from shouting "banana"
  let zaps = [];   // lightning bolts from the snake to each stunned head
  let voiceStunT = 0, shoutT = 0; // stun time left for heads that appear meanwhile; the big BANANA! title
  let P, heads, bananas, peels, fx, texts, phase, phaseT, bananaTimer, toSpawn, spawnTimer, dist, shake, flash, button, tempt;

  // ---- Sound (sfx.js) ----
  const sfx = name => window.SFX && SFX.play(name);
  const thud = (v = 0.5) => window.SFX && SFX.thud(v);

  // ---- Setup / teardown ----
  function start(onDone) {
    done = onDone; ended = false;
    root = document.createElement('div');
    root.className = 'maze';
    root.innerHTML = `
      <style>
        .maze { position: fixed; inset: 0; z-index: 51; background: #07040d; display: flex; align-items: center; justify-content: center; }
        .maze canvas { display: block; touch-action: none; }
        .maze .pad { position: absolute; right: 14px; bottom: 14px; display: none; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 56px); gap: 6px; }
        .maze .pad button { border-radius: 12px; border: 2px solid rgba(255,255,255,.3); background: rgba(255,255,255,.12); color: #fff; font: 700 20px system-ui, sans-serif; }
        .maze .pad [data-d="0"] { grid-column: 2; grid-row: 1; } .maze .pad [data-d="3"] { grid-column: 1; grid-row: 2; }
        .maze .pad [data-d="2"] { grid-column: 2; grid-row: 2; } .maze .pad [data-d="1"] { grid-column: 3; grid-row: 2; }
        .maze .throw { position: absolute; left: 14px; bottom: 14px; display: none; width: 84px; height: 84px; border-radius: 50%;
          border: 2px solid rgba(255,225,77,.6); background: rgba(255,225,77,.25); color: #fff; font: 800 15px system-ui, sans-serif; }
        @media (pointer: coarse) { .maze .pad { display: grid; } .maze .throw { display: block; } }
      </style>
      <canvas></canvas>
      <button class="throw">THROW</button>
      <div class="pad"><button data-d="0">▲</button><button data-d="3">◀</button><button data-d="2">▼</button><button data-d="1">▶</button></div>`;
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    for (const b of root.querySelectorAll('.pad button')) b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); anyInput(); input(+b.dataset.d); });
    root.querySelector('.throw').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); anyInput(); throwBanana(); });
    // swipes on the maze steer too; any tap counts as pressing the final button
    let sw = null;
    cv.addEventListener('pointerdown', e => { sw = { x: e.clientX, y: e.clientY }; anyInput(); });
    cv.addEventListener('pointerup', e => {
      if (!sw) return;
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
      if (Math.hypot(dx, dy) > 24) input(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    });
    addEventListener('keydown', onKey, true);
    addEventListener('resize', resize);
    resize();

    const s = find('P')[0];
    P = { x: s.x, y: s.y, dir: 3, want: 3, moving: false, prog: 0, hp: LIVES, inv: 0, peels: 0, ammo: 2, cd: 0, trail: [], t: 0 };
    thrown = []; waves = []; zaps = []; voiceStunT = 0; shoutT = 0;
    heads = []; bananas = []; peels = []; fx = []; texts = [];
    toSpawn = HEAD_COUNT; spawnTimer = 1.2; bananaTimer = 0; shake = 0; flash = 0; button = null; tempt = 0;
    phase = 'intro'; phaseT = 0; beatAt = 0;
    sfx('sting'); setTimeout(() => { if (!ended && phase !== 'lose') SFX.music('maze'); }, 1500);
    voice = 'off'; voiceQueue = 0; startVoice();
    for (let i = 0; i < 8; i++) spawnBanana();
    computeDist();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function finish(result) {
    if (ended) return;
    ended = true;
    stopVoice();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', resize);
    SFX.music(null);
    if (result === 'lose') sfx('jingleDown');
    const close = () => { cancelAnimationFrame(raf); root.remove(); };
    done && done(result);
    if (result !== 'lose' || !root.animate) return close();
    // lost: close in on the snake, revealing the snake game underneath
    const r = cv.getBoundingClientRect(), sc = r.width / W, p = pos(P);
    const cx = r.left + (ox + (p.x + 0.5) * T) * sc, cy = r.top + (oy + (p.y + 0.5) * T) * sc;
    root.style.background = 'transparent';
    root.animate([
      { clipPath: `circle(150vmax at ${cx}px ${cy}px)` },
      { clipPath: `circle(60px at ${cx}px ${cy}px)`, offset: 0.55 },
      { clipPath: `circle(60px at ${cx}px ${cy}px)`, offset: 0.7 },
      { clipPath: `circle(0px at ${cx}px ${cy}px)` },
    ], { duration: 1400, easing: 'ease-in-out', fill: 'forwards' }).onfinish = close;
  }

  function resize() {
    const s = Math.min(innerWidth / W, innerHeight / H), dpr = devicePixelRatio || 1;
    cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
    cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
    T = Math.floor(Math.min(W / COLS, (H - 70) / ROWS));
    ox = Math.floor((W - COLS * T) / 2); oy = 56;
  }

  const KEYMAP = { w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3 };
  function onKey(e) {
    e.stopImmediatePropagation(); // the snake game underneath must not react
    const k = e.key.toLowerCase();
    if (k in KEYMAP || k in THROW_KEYS) e.preventDefault();
    if (e.repeat) return;        // a key still held from the maze is not a press
    if (k === 'm') return SFX.toggleMute(); // muting is not pressing the button
    if (k === '1') return devSkip();        // hidden developer key; never presses the button
    anyInput();
    if (k in KEYMAP) input(KEYMAP[k]);
    else if (k in THROW_KEYS) throwBanana();
  }
  const THROW_KEYS = { ' ': 1, j: 1, k: 1, f: 1, enter: 1 };
  function input(d) { if (phase === 'play' || phase === 'intro') P.want = d; }
  function anyInput() {
    if (phase === 'button' && button.t > 1.2) pressButton();
    else if (phase === 'victory' && phaseT > 1.5) finish('win');
  }

  // ---- Grid movement ----
  const pos = e => ({ x: e.x + DIRS[e.dir][0] * e.prog, y: e.y + DIRS[e.dir][1] * e.prog });
  const open = (x, y, d) => !wall(x + DIRS[d][0], y + DIRS[d][1]);

  // distance (in steps) from every tile to the player, for the heads to chase
  function computeDist() {
    dist = MAP.map(row => [...row].map(() => Infinity));
    const q = [[P.x, P.y]]; dist[P.y][P.x] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (!wall(nx, ny) && dist[ny][nx] === Infinity) { dist[ny][nx] = dist[y][x] + 1; q.push([nx, ny]); }
      }
    }
  }

  function updatePlayer(dt) {
    P.t += dt;
    if (P.cd > 0) P.cd -= dt;
    if (P.inv > 0) P.inv -= dt;
    // turn around at any time
    if (P.moving && P.want === (P.dir + 2) % 4) {
      P.x += DIRS[P.dir][0]; P.y += DIRS[P.dir][1]; P.dir = P.want; P.prog = 1 - P.prog;
    }
    if (!P.moving) {
      if (open(P.x, P.y, P.want)) { P.dir = P.want; P.moving = true; }
      else return;
    }
    P.prog += PLAYER_SPEED * dt;
    while (P.prog >= 1) {
      const prev = { x: P.x, y: P.y };
      P.x += DIRS[P.dir][0]; P.y += DIRS[P.dir][1]; P.prog -= 1;
      arrive(prev);
      if (open(P.x, P.y, P.want)) P.dir = P.want;
      else if (!open(P.x, P.y, P.dir)) { P.moving = false; P.prog = 0; break; }
    }
  }

  function arrive(prev) {
    computeDist();
    const b = bananas.find(b => b.x === P.x && b.y === P.y);
    if (b) {
      bananas = bananas.filter(o => o !== b);
      P.peels++;
      P.ammo = Math.min(POCKET_MAX, P.ammo + 1);
      sfx('nom');
      popText(P.x + 0.5, P.y, 'NOM', '#ffe14d');
    }
    // drop a peel behind the snake for every banana eaten
    if (P.peels > 0 && !peels.some(p => p.x === prev.x && p.y === prev.y) && peels.length < PEELS_MAX) {
      peels.push({ x: prev.x, y: prev.y, rot: Math.random() * 6, t: 0 });
      P.peels--;
      sfx('splat');
    }
  }

  // Hidden developer key "1": every head pops, on to the final button.
  function devSkip() {
    if (phase !== 'intro' && phase !== 'play') return;
    phase = 'play'; phaseT = 0; toSpawn = 0;
    for (const h of heads) { h.hp = 1; damageHead(h, 'POP!'); }
    heads = [];
  }

  // ---- Throwing bananas ----
  function throwBanana(free = false) {
    if (phase !== 'play' || (!free && P.ammo <= 0) || P.cd > 0) { if (phase === 'play' && !free && P.ammo <= 0) sfx('clunk'); return false; }
    if (!free) P.ammo--;
    P.cd = THROW_COOLDOWN;
    const p = pos(P);
    thrown.push({ x: p.x, y: p.y, dir: P.dir, rot: 0 });
    sfx('swoosh');
    return true;
  }

  // ---- Voice: say "banana" and the snake throws one (free) ----
  // Uses the browser's speech recognition (Chrome, Edge, Safari). Each "banana" heard is queued and
  // thrown as soon as the throw cooldown allows, so "banana banana banana" throws three.
  let rec = null, voice = 'off', voiceQueue = 0, heard = {};
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { voice = 'unsupported'; return; }
    try {
      rec = new SR();
      rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;
      rec.onstart = () => { if (voice !== 'denied') voice = 'on'; };
      rec.onresult = e => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          // count the word in this phrase (interim results grow as you speak; only new ones count)
          let n = 0;
          for (let a = 0; a < e.results[i].length; a++) n = Math.max(n, (e.results[i][a].transcript.match(/banan/gi) || []).length);
          const before = heard[i] || 0;
          if (n > before) { voiceQueue += n - before; heard[i] = n; }
        }
      };
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') voice = 'denied'; };
      rec.onend = () => { // the browser stops listening now and then: start again while the maze is on
        heard = {};
        if (rec && !ended && voice !== 'denied') setTimeout(() => { try { rec && rec.start(); } catch (e) {} }, 250);
      };
      rec.start();
      voice = 'starting';
    } catch (e) { voice = 'unsupported'; }
  }
  function stopVoice() {
    const r = rec; rec = null;
    if (r) { r.onend = null; try { r.abort(); } catch (e) {} }
  }
  function updateVoice() {
    if (phase !== 'play') { voiceQueue = 0; return; }
    if (voiceQueue > 0 && P.cd <= 0 && throwBanana(true)) {
      voiceQueue--;
      stunAllHeads(pos(P)); // the big BANANA! title says it all
    }
  }

  // The power of the word: every head freezes in place, dizzy, for VOICE_STUN seconds.
  // Unlimited range: every head in the maze, however far away, and any head that rolls out meanwhile.
  function stunAllHeads(from) {
    waves.push({ x: from.x, y: from.y, t: 0 });
    voiceStunT = VOICE_STUN; shoutT = 0.9;
    for (const h of heads) {
      stunHead(h, VOICE_STUN);
      const q = pos(h);
      zaps.push({ x0: from.x, y0: from.y, h, t: 0, seed: Math.random() * 100 });
      setTimeout(() => burst(q.x + 0.5, q.y + 0.5, 14, ['#ffe14d', '#fff', '#fff3b0'], 6), 120);
    }
    sfx('boing'); sfx('shieldUp'); setTimeout(() => sfx('tweet'), 300);
    shake = Math.max(shake, 8);
  }
  function stunHead(h, t) { h.stun = Math.max(h.stun, t); h.stunMax = h.stun; h.zapped = true; } // the countdown ring refills

  function updateThrown(dt) {
    for (const b of thrown) {
      const [dx, dy] = DIRS[b.dir];
      b.x += dx * THROW_SPEED * dt; b.y += dy * THROW_SPEED * dt; b.rot += dt * 20;
      // hit a head?
      const h = heads.find(h => !h.dead && Math.hypot(pos(h).x - b.x, pos(h).y - b.y) < 0.7);
      if (h) {
        b.done = true;
        damageHead(h, 'BONK!');
        continue;
      }
      // reached a wall: it splats and leaves a peel on the last open tile
      const cx = Math.round(b.x), cy = Math.round(b.y);
      if (wall(cx + dx, cy + dy) && (b.x - cx) * dx + (b.y - cy) * dy >= 0) {
        b.done = true;
        if (!peels.some(p => p.x === cx && p.y === cy) && peels.length < PEELS_MAX && !wall(cx, cy)) peels.push({ x: cx, y: cy, rot: Math.random() * 6, t: 0 });
        burst(cx + 0.5, cy + 0.5, 8, ['#ffe14d', '#fff3b0'], 4);
        sfx('splat');
      }
    }
    thrown = thrown.filter(b => !b.done);
  }

  // A head takes 1 damage, spins dizzy for a moment, and pops when it runs out.
  function damageHead(h, label) {
    h.hp--; h.hurt = 0.4;
    if (h.stun < 1.1) { h.stun = 1.1; h.stunMax = 1.1; h.zapped = false; }
    sfx(label === 'SLIP!' ? 'slip' : 'hit'); setTimeout(() => sfx(h.hp > 0 ? 'oof' : 'bigPop'), label === 'SLIP!' ? 350 : 120);
    burst(h.x + 0.5, h.y + 0.5, 10, ['#ffe14d', '#fff'], 5);
    popText(h.x + 0.5, h.y, h.hp > 0 ? label : 'POP!', h.hp > 0 ? '#ffe14d' : '#fff');
    if (h.hp <= 0) { h.dead = true; shake = Math.max(shake, 6); burst(h.x + 0.5, h.y + 0.5, 30, ['#d9692b', '#f2c7a0', '#fff', '#ffe14d'], 7); }
  }

  function spawnBanana() {
    for (let i = 0; i < 50; i++) {
      const x = 1 + Math.floor(Math.random() * (COLS - 2)), y = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (wall(x, y) || MAP[y][x] === 'H' || (x === P.x && y === P.y)) continue;
      if (bananas.some(b => b.x === x && b.y === y) || peels.some(p => p.x === x && p.y === y)) continue;
      bananas.push({ x, y, t: Math.random() * 6 });
      return;
    }
  }

  function spawnHead() {
    const pen = pick(find('H'));
    heads.push({ x: pen.x, y: pen.y, dir: pick([1, 3]), prog: 0, hp: 2 + (Math.random() < 0.5 ? 1 : 0), stun: 0, rot: 0, hurt: 0,
      chase: heads.length % 3 === 2 ? 0.45 : 0.85, say: 0 });
    heads[heads.length - 1].max = heads[heads.length - 1].hp;
    if (voiceStunT > 0) stunHead(heads[heads.length - 1], voiceStunT); // rolled out into a stun: frozen too
    sfx('pop'); sfx('roll');
  }

  function updateHeads(dt) {
    const speed = HEAD_SPEED + (HEAD_SPEED_MAX - HEAD_SPEED) * (1 - (heads.length + toSpawn) / HEAD_COUNT);
    for (const h of heads) {
      if (h.hurt > 0) h.hurt -= dt;
      if (h.stun > 0) { h.stun -= dt; h.rot += dt * 18; continue; }
      h.prog += speed * dt;
      h.rot += speed * dt * 2.2 * (DIRS[h.dir][0] || 1);
      while (h.prog >= 1) {
        h.x += DIRS[h.dir][0]; h.y += DIRS[h.dir][1]; h.prog -= 1;
        // slipped on a peel?
        const peel = peels.find(p => p.x === h.x && p.y === h.y);
        if (peel) {
          peels = peels.filter(p => p !== peel);
          h.prog = 0;
          damageHead(h, 'SLIP!');
          break;
        }
        // pick the next direction: mostly toward the player, never straight back unless it's a dead end
        let opts = [0, 1, 2, 3].filter(d => d !== (h.dir + 2) % 4 && open(h.x, h.y, d));
        if (!opts.length) opts = [(h.dir + 2) % 4];
        if (Math.random() < h.chase) opts.sort((a, b) => dist[h.y + DIRS[a][1]][h.x + DIRS[a][0]] - dist[h.y + DIRS[b][1]][h.x + DIRS[b][0]]);
        h.dir = Math.random() < h.chase ? opts[0] : pick(opts);
      }
    }
    heads = heads.filter(h => !h.dead);
    // touching a head costs a heart
    const p = pos(P);
    for (const h of heads) {
      if (h.stun > 0) continue;
      const q = pos(h);
      if (Math.hypot(p.x - q.x, p.y - q.y) < 0.65 && P.inv <= 0) {
        P.hp--; P.inv = 2; shake = 12; flash = 0.3;
        sfx('hurt'); sfx('laugh');
        popText(p.x + 0.5, p.y, P.hp > 0 ? 'OUCH!' : 'ROLLED OVER!', '#ff5a4e');
        h.x += DIRS[h.dir][0]; h.y += DIRS[h.dir][1]; h.dir = (h.dir + 2) % 4; h.prog = 1 - h.prog; // bounce off
        if (P.hp <= 0) { phase = 'lose'; phaseT = 0; SFX.music(null); setTimeout(() => sfx('sadTrombone'), 300); }
      }
    }
  }

  // ---- The final button ----
  function pressButton() {
    phase = 'pressed'; phaseT = 0;
    sfx('whoosh');
  }

  // ---- Effects ----
  function burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.9), l = 0.3 + Math.random() * 0.5;
      fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, c: pick(colors) });
    }
  }
  function popText(x, y, text, c) { texts.push({ x, y, text, c, life: 1 }); }

  // ---- Main loop ----
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    phaseT += dt;
    if (phase === 'intro' && phaseT > 2.6) { phase = 'play'; phaseT = 0; P.inv = 1.5; }
    if (phase === 'intro' || phase === 'play') {
      if (phase === 'play') updatePlayer(dt);
      if (phase === 'play' && toSpawn > 0 && (spawnTimer -= dt) <= 0) { spawnHead(); toSpawn--; spawnTimer = 1.0; }
      if (phase === 'play') { updateHeads(dt); updateThrown(dt); }
      updateVoice();
      for (const w of waves) w.t += dt;
      waves = waves.filter(w => w.t < 1.1);
      for (const z of zaps) z.t += dt;
      zaps = zaps.filter(z => z.t < 0.45 && !z.h.dead);
      if (voiceStunT > 0) voiceStunT -= dt;
      if (shoutT > 0) shoutT -= dt;
      if ((bananaTimer -= dt) <= 0) { if (bananas.length < BANANAS_MAX) spawnBanana(); bananaTimer = 0.9; }
      if (phase === 'play' && toSpawn === 0 && heads.length === 0) { phase = 'cleared'; phaseT = 0; SFX.music(null); sfx('fanfare'); }
    }
    if (phase === 'cleared' && phaseT > 2.2) { phase = 'button'; phaseT = 0; button = { t: 0 }; sfx('rumble'); thud(0.7); }
    if (phase === 'button') {
      button.t += dt;
      if ((tempt += dt) > 2.4) { tempt = 0; if (button.t > 1.2) sfx('talk'); } // the tempting lines change
      // a heartbeat that speeds up the longer you resist
      if (button.t > 1.2 && (beatAt -= dt) <= 0) { sfx('heartbeat'); beatAt = Math.max(0.45, 1.1 - (button.t - 1.2) * 0.05); }
      if (button.t > 1.0) { // the teasing hand taps at the button, faster and faster
        const period = Math.max(0.45, 0.9 - (button.t - 1.0) * 0.04);
        const before = button.tap || 0; button.tap = before + dt / period;
        if (Math.floor(button.tap + 0.25) > Math.floor(before + 0.25) && Math.floor(button.tap + 0.25) % 4 !== 0) sfx('click'); // finger reaches the button
      }
      if (button.t > BUTTON_WAIT + 1.2) { phase = 'victory'; phaseT = 0; sfx('fanfare'); for (let i = 0; i < 8; i++) setTimeout(() => sfx('coin'), 400 + i * 120); setTimeout(() => sfx('sparkle'), 500); setTimeout(() => sfx('newBest'), 900); }
    }
    if (phase === 'pressed' && phaseT > 3.2) finish('pressed');
    if (phase === 'lose' && phaseT > 2) finish('lose');
    for (const p of fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
    fx = fx.filter(p => p.life > 0);
    for (const t of texts) { t.y -= dt * 1.2; t.life -= dt; }
    texts = texts.filter(t => t.life > 0);
    for (const b of bananas) b.t += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 50);
    if (flash > 0) flash -= dt;
    const p = pos(P);
    P.trail.unshift(p); if (P.trail.length > 30) P.trail.pop();
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---- Drawing ----
  const sx = x => ox + (x + 0.5) * T, sy = y => oy + (y + 0.5) * T;

  function draw() {
    ctx.save();
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    ctx.fillStyle = '#0a0716'; ctx.fillRect(-20, -20, W + 40, H + 40);
    drawMaze();
    for (const pl of peels) drawPeel(sx(pl.x), sy(pl.y), pl.rot);
    for (const b of bananas) drawBanana(sx(b.x), sy(b.y) + Math.sin(b.t * 4) * T * 0.05);
    for (const h of heads) drawHead(h);
    drawSnake();
    for (const b of thrown) { ctx.save(); ctx.translate(sx(b.x), sy(b.y)); ctx.rotate(b.rot); drawBanana(0, 0); ctx.restore(); }
    for (const f of fx) { ctx.globalAlpha = clamp01(f.life / f.max * 1.5); ctx.fillStyle = f.c; ctx.fillRect(sx(f.x - 0.5) - 3, sy(f.y - 0.5) - 3, 6, 6); }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of texts) {
      ctx.globalAlpha = clamp01(t.life / 0.3);
      ctx.font = '900 20px system-ui, sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = '#0a0716';
      ctx.strokeText(t.text, sx(t.x - 0.5), sy(t.y - 0.5)); ctx.fillStyle = t.c; ctx.fillText(t.text, sx(t.x - 0.5), sy(t.y - 0.5));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = `rgba(255,60,50,${flash})`; ctx.fillRect(0, 0, W, H); }
    for (const w of waves) { // the shout ripples out past every corner of the maze
      const cx = sx(w.x), cy = sy(w.y);
      const far = Math.max(...[[ox, oy], [ox + COLS * T, oy], [ox, oy + ROWS * T], [ox + COLS * T, oy + ROWS * T]].map(([x, y]) => Math.hypot(x - cx, y - cy))) + 40;
      for (const [delay, width] of [[0, 18], [0.18, 8]]) {
        const k = Math.max(0, Math.min(1, (w.t - delay) / 0.75));
        if (k <= 0 || k >= 1) continue;
        const r = 20 + ease(k) * far;
        ctx.save(); ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 20;
        ctx.strokeStyle = `rgba(255,225,77,${(1 - k) * 0.95})`; ctx.lineWidth = width * (1 - k) + 2;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); ctx.restore();
      }
      if (w.t < 0.2) { ctx.fillStyle = `rgba(255,225,77,${0.35 * (1 - w.t / 0.2)})`; ctx.fillRect(0, 0, W, H); }
    }
    for (const z of zaps) drawZap(z);
    if (shoutT > 0) { // big BANANA! across the screen
      const k = 1 - shoutT / 0.9, sc = k < 0.15 ? ease(k / 0.15) * 1.25 : 1.25 - Math.min(0.25, (k - 0.15) * 0.6);
      ctx.save(); ctx.globalAlpha = Math.min(1, shoutT / 0.25);
      ctx.translate(W / 2, oy + ROWS * T * 0.42); ctx.rotate(-0.06); ctx.scale(sc, sc);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 84px system-ui, sans-serif';
      ctx.lineWidth = 12; ctx.strokeStyle = '#3a2a00'; ctx.strokeText('BANANA!', 0, 0);
      ctx.fillStyle = '#ffe14d'; ctx.fillText('BANANA!', 0, 0);
      ctx.font = '800 22px system-ui, sans-serif'; ctx.lineWidth = 6; ctx.strokeText('EVERY HEAD STUNNED', 0, 58);
      ctx.fillStyle = '#fff'; ctx.fillText('EVERY HEAD STUNNED', 0, 58);
      ctx.restore();
    }
    drawHUD();
    if (phase === 'intro') drawCard('THE FINAL FINAL BOSS', 'Eat bananas, drop peels, throw bananas with SPACE.', '#ff3b30', clamp01(phaseT / 0.3) * clamp01((2.6 - phaseT) / 0.4), 'LEVEL 3');
    if (phase === 'cleared') drawCard('ALL HEADS DOWN!', 'You did it. Time for your reward...', '#5ee07a', clamp01(phaseT / 0.3));
    if (phase === 'lose') drawCard('ROLLED OVER', 'The heads got you. Back to the snake.', '#ff3b30', clamp01(phaseT / 0.3));
    if (phase === 'button' || phase === 'pressed' || phase === 'victory') drawFinale();
    if (phase === 'intro' && phaseT < 0.5) { ctx.fillStyle = `rgba(0,0,0,${1 - phaseT / 0.5})`; ctx.fillRect(0, 0, W, H); } // fade in from the boss fight
  }

  function drawMaze() {
    // solid wall blocks, with a neon line only along edges that face a corridor
    ctx.fillStyle = '#1c0f33';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (wall(x, y)) ctx.fillRect(ox + x * T, oy + y * T, T, T);
    ctx.save();
    ctx.shadowColor = '#ff4fb8'; ctx.shadowBlur = 12; ctx.strokeStyle = '#ff4fb8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const i = 3; // inset, so the glow sits inside the wall
    ctx.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!wall(x, y)) continue;
      const L = ox + x * T, Tp = oy + y * T;
      if (y > 0 && !wall(x, y - 1)) { ctx.moveTo(L, Tp + i); ctx.lineTo(L + T, Tp + i); }
      if (y < ROWS - 1 && !wall(x, y + 1)) { ctx.moveTo(L, Tp + T - i); ctx.lineTo(L + T, Tp + T - i); }
      if (x > 0 && !wall(x - 1, y)) { ctx.moveTo(L + i, Tp); ctx.lineTo(L + i, Tp + T); }
      if (x < COLS - 1 && !wall(x + 1, y)) { ctx.moveTo(L + T - i, Tp); ctx.lineTo(L + T - i, Tp + T); }
    }
    ctx.stroke();
    ctx.restore();
    // the pen the heads come out of
    for (const c of find('H')) { ctx.fillStyle = 'rgba(255,79,184,.10)'; ctx.fillRect(ox + c.x * T, oy + c.y * T, T, T); }
  }

  function drawBanana(x, y) {
    ctx.save(); ctx.translate(x, y + T * 0.1); ctx.rotate(-0.5); const s = T / 28; ctx.scale(s, s);
    ctx.fillStyle = '#ffe14d'; ctx.strokeStyle = '#a07a10'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, -10, 16, 0.25 * Math.PI, 0.85 * Math.PI); ctx.arc(0, -16, 17, 0.8 * Math.PI, 0.25 * Math.PI, true); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a3d10'; ctx.beginPath(); ctx.arc(11, 1, 2, 0, 7); ctx.arc(-13, 0, 1.8, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawPeel(x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); const s = T / 36; ctx.scale(s, s);
    ctx.fillStyle = '#f2cf3a'; ctx.strokeStyle = '#8a6a10'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.save(); ctx.rotate(i * 2.1);
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.quadraticCurveTo(-6, 10, 0, 15); ctx.quadraticCurveTo(6, 10, 4, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a5a10'; ctx.beginPath(); ctx.arc(0, 9, 1.4, 0, 7); ctx.fill(); ctx.fillStyle = '#f2cf3a';
      ctx.restore();
    }
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
    ctx.restore();
  }

  // A jagged lightning bolt from the snake to a head (it follows the head while it flickers).
  function drawZap(z) {
    const q = pos(z.h), x0 = sx(z.x0), y0 = sy(z.y0), x1 = sx(q.x), y1 = sy(q.y);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    const reach = Math.min(1, z.t / 0.12), segs = Math.max(4, Math.round(len / 28));
    ctx.save();
    ctx.globalAlpha = z.t < 0.3 ? 1 : 1 - (z.t - 0.3) / 0.15;
    ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 16; ctx.lineJoin = 'round';
    for (const [w, c] of [[7, 'rgba(255,225,77,.55)'], [2.5, '#fffbe0']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let i = 1; i <= segs * reach; i++) {
        const k = i / segs, j = i === segs ? 0 : Math.sin(z.seed + i * 12.9 + Math.floor(z.t * 30) * 3.1) * 14;
        ctx.lineTo(x0 + (x1 - x0) * k + nx * j, y0 + (y1 - y0) * k + ny * j);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHead(h) {
    const p = pos(h), x = sx(p.x), y = sy(p.y);
    ctx.save(); ctx.translate(x, y);
    if (h.stun > 0 && h.zapped) { // frozen by the shout: a yellow glow and a ring counting down
      const k = Math.max(0, h.stun / (h.stunMax || VOICE_STUN));
      const g = ctx.createRadialGradient(0, 0, T * 0.2, 0, 0, T * 0.85);
      g.addColorStop(0, 'rgba(255,225,77,.7)'); g.addColorStop(1, 'rgba(255,225,77,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, T * 0.85, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, T * 0.66, 0, 7); ctx.stroke();
      ctx.save(); ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 8; ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, T * 0.66, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (!(h.hurt > 0 && Math.floor(h.hurt * 20) % 2)) {
      ctx.save(); ctx.rotate(h.rot); const s = T / 44; ctx.scale(DIRS[h.dir][0] < 0 ? -s : s, s);
      window.RickHead ? window.RickHead(ctx, h.stun > 0 ? 'dizzy' : 'normal') : (ctx.fillStyle = '#f2c7a0', ctx.beginPath(), ctx.arc(0, 0, 20, 0, 7), ctx.fill());
      ctx.restore();
    }
    // health pips
    for (let i = 0; i < h.max; i++) {
      ctx.fillStyle = i < h.hp ? '#ff5a4e' : 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.arc((i - (h.max - 1) / 2) * 8, -T * 0.62, 3, 0, 7); ctx.fill();
    }
    if (h.stun > 0 && h.zapped) for (let i = 0; i < 3; i++) { // little bananas orbiting the frozen head
      const a = performance.now() / 220 + i * 2.1;
      ctx.save(); ctx.translate(Math.cos(a) * T * 0.62, Math.sin(a) * T * 0.62); ctx.scale(0.42, 0.42); drawBanana(0, -T * 0.1); ctx.restore();
    } else if (h.stun > 0) for (let i = 0; i < 3; i++) {
      const a = performance.now() / 150 + i * 2.1;
      ctx.fillStyle = '#ffe14d'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('★', Math.cos(a) * T * 0.4, -T * 0.4 + Math.sin(a) * 4);
    }
    ctx.restore();
  }

  function drawSnake() {
    if (P.inv > 0 && Math.floor(P.inv * 10) % 2) return;
    for (let i = 4; i >= 1; i--) {
      const q = P.trail[Math.min(P.trail.length - 1, i * 4)] || pos(P);
      ctx.fillStyle = `hsl(135, 65%, ${50 - i * 4}%)`;
      ctx.beginPath(); ctx.arc(sx(q.x), sy(q.y), T * (0.36 - i * 0.03), 0, 7); ctx.fill();
    }
    const p = pos(P), x = sx(p.x), y = sy(p.y), [dx, dy] = DIRS[P.dir];
    ctx.fillStyle = '#a6f5b5'; ctx.beginPath(); ctx.arc(x, y, T * 0.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#14161b';
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(x + dx * T * 0.15 - dy * sgn * T * 0.17, y + dy * T * 0.15 + dx * sgn * T * 0.17, T * 0.07, 0, 7); ctx.fill(); }
    if (P.ammo > 0) { ctx.fillStyle = '#ffe14d'; ctx.font = '800 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('×' + P.ammo, x, y - T * 0.6); }
  }

  function heart(x, y, s, full) {
    ctx.fillStyle = full ? '#ff5a7a' : 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.9); ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.9, y - s * 1.4, x, y - s * 0.5);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9); ctx.fill();
  }

  function drawHUD() {
    for (let i = 0; i < LIVES; i++) heart(30 + i * 30, 28, 10, i < P.hp);
    ctx.textBaseline = 'middle'; ctx.font = '800 16px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText(`HEADS LEFT: ${heads.length + toSpawn}`, W / 2, 26);
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffe14d';
    ctx.fillText(`BANANAS TO THROW: ${P.ammo}`, W - 20, 26);
    // microphone status
    const mic = { on: ['MIC ON · say "BANANA" to throw one and stun every head', '#7cff8a'], starting: ['MIC · allow the microphone to throw by voice', '#ffd23f'],
      denied: ['MIC BLOCKED · allow the microphone to throw by voice', '#ff8a80'], unsupported: ['Voice throwing needs Chrome, Edge or Safari', '#8a93a3'] }[voice];
    if (mic) {
      ctx.textAlign = 'left'; ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = mic[1];
      if (voice === 'on') { ctx.beginPath(); ctx.arc(24, 50, 4 + Math.sin(performance.now() / 200), 0, 7); ctx.fill(); }
      ctx.fillText(mic[0], 34, 50);
    }
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('W A S D move · SPACE throws a banana (say "banana" to also stun every head) · every banana you eat also drops a peel behind you · M mute', W / 2, H - 8);
  }

  function drawCard(title, sub, color, a, kicker) {
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(7,4,13,.6)'; ctx.fillRect(0, H * 0.3 - (kicker ? 40 : 0), W, 130 + (kicker ? 40 : 0));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (kicker) { ctx.font = '900 28px system-ui, sans-serif'; ctx.fillStyle = '#ffd23f'; ctx.fillText(kicker, W / 2, H * 0.3 - 6); }
    ctx.font = '900 54px system-ui, sans-serif'; ctx.fillStyle = color; ctx.fillText(title, W / 2, H * 0.3 + 52);
    ctx.font = '700 20px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(sub, W / 2, H * 0.3 + 100);
    ctx.restore();
  }

  // An open cartoon hand (palm with four fingers along +x and a thumb), in units of its own size.
  function drawHand(spread) {
    ctx.translate(0.1, 0);
    ctx.fillStyle = '#9bf0ac'; ctx.strokeStyle = '#2c8a44'; ctx.lineWidth = 0.05; ctx.lineJoin = 'round';
    [[-0.21, 0.30], [-0.07, 0.38], [0.07, 0.36], [0.21, 0.28]].forEach(([y, len], i) => {
      ctx.save(); ctx.translate(0.12, y); ctx.rotate((i - 1.5) * spread);
      ctx.beginPath(); ctx.roundRect(0, -0.06, len, 0.12, 0.06); ctx.fill(); ctx.stroke(); ctx.restore();
    });
    ctx.save(); ctx.translate(-0.08, 0.24); ctx.rotate(0.9 + spread);
    ctx.beginPath(); ctx.roundRect(0, -0.065, 0.3, 0.13, 0.065); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.roundRect(-0.36, -0.29, 0.52, 0.58, 0.16); ctx.fill(); ctx.stroke();
  }

  // A white cartoon glove that keeps poking at the button: "go on, press it". It never presses it.
  function drawGlove() { // pointing along +x, in units of its own size
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = 0.045; ctx.lineJoin = 'round';
    const shape = (x, y, w, h, r, rot = 0) => { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); ctx.roundRect(0, -h / 2, w, h, r); ctx.fill(); ctx.stroke(); ctx.restore(); };
    shape(-0.36, -0.2, 0.34, 0.15, 0.075, -0.9);                   // thumb
    ctx.beginPath(); ctx.roundRect(-0.56, -0.27, 0.56, 0.56, 0.2); ctx.fill(); ctx.stroke(); // palm
    for (const y of [0.0, 0.11, 0.22]) shape(-0.06, y, 0.2, 0.12, 0.06); // curled fingers
    shape(-0.08, -0.17, 0.66, 0.15, 0.075);                         // the pointing finger
    ctx.beginPath(); ctx.roundRect(-0.82, -0.22, 0.3, 0.44, 0.08); ctx.fill(); ctx.stroke(); // cuff
    ctx.beginPath(); for (const y of [-0.08, 0.06]) { ctx.moveTo(-0.79, y); ctx.lineTo(-0.55, y); } ctx.stroke();
    ctx.beginPath(); for (const y of [-0.12, 0.0, 0.12]) { ctx.moveTo(-0.44, y); ctx.lineTo(-0.28, y); } ctx.stroke(); // stitching
  }
  // The teasing hand: pokes the button three times, then wags its finger ("go on…").
  // It gets faster and shakier the longer you resist, and never presses it itself.
  function drawCoaxingHand(cx, cy, R) {
    const t = phase === 'button' ? button.t : BUTTON_WAIT + 1.2;
    if (t < 0.7) return;
    const appear = ease(clamp01((t - 0.7) / 0.45));
    const tap = button.tap || 0, beat = Math.floor(tap) % 4, f = tap % 1;
    const wag = beat === 3;                                      // every fourth beat: wag the finger instead of poking
    const jab = wag ? 0 : f < 0.55 ? 0 : f < 0.72 ? ease((f - 0.55) / 0.17) : 1 - (f - 0.72) / 0.28;
    const tx = cx + R * 0.25, ty = cy - R * 0.15;               // where it pokes: the button's face, next to PRESS
    const dx = 0.93, dy = -0.37;                                // it comes from the right
    const dist = (R * 0.5 - jab * R * 0.44) + (wag ? R * 0.12 : 0) + (1 - appear) * W * 0.7; // the tip stops just short
    const impatience = clamp01((t - 4) / 6);                     // shakes more and more
    let hx = tx + dx * dist + (Math.random() - 0.5) * 12 * impatience, hy = ty + dy * dist + (Math.random() - 0.5) * 12 * impatience;
    let angle = Math.atan2(ty - hy, tx - hx) + (wag ? Math.sin(f * Math.PI * 6) * 0.45 : Math.sin(t * 7) * 0.05 * (1 - jab));
    let alpha = 1;
    if (phase === 'victory') { // it gives up and droops away
      const k = phaseT; hy += k * k * 500; angle += k * 1.5; alpha = 1 - clamp01((k - 0.6) / 0.6);
    }
    // "press here" ripples while the finger is down
    if (phase === 'button' && !wag && f > 0.68) {
      const k = (f - 0.68) / 0.32;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; ctx.lineWidth = 4;
      for (const m of [1, 0.6]) { ctx.beginPath(); ctx.ellipse(tx, ty + 6, 16 + k * 60 * m, (16 + k * 60 * m) * 0.45, 0, 0, 7); ctx.stroke(); }
    }
    const S = R * 0.6;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(hx, hy); ctx.rotate(angle);
    if (Math.cos(angle) < 0) ctx.scale(1, -1); // keep the thumb on top
    ctx.scale(S, S); ctx.translate(-0.58, 0); // the fingertip sits at (hx, hy)
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 12;
    drawGlove();
    ctx.restore();
  }


  // The reward: a huge red button. Pressing it loses; leaving it alone wins.
  function drawFinale() {
    const t = phase === 'button' ? button.t : 99;
    const rise = ease(clamp01(t / 1.0));
    const pressed = phase === 'pressed' && phaseT > 0.45;
    const sad = phase === 'victory' ? ease(clamp01(phaseT / 1.2)) : 0;
    ctx.fillStyle = `rgba(7,4,13,${0.75 * rise})`; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.56 + (1 - rise) * H + sad * H * 0.7, R = Math.min(W, H) * 0.42 * (1 - sad * 0.5);
    const pulse = phase === 'button' ? 1 + Math.sin(t * 5) * 0.02 : 1;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255,60,50,.18)'; ctx.beginPath(); ctx.arc(0, 0, R * 1.25, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b2f38'; ctx.beginPath(); ctx.arc(0, R * 0.08, R, 0, 7); ctx.fill();
    ctx.fillStyle = pressed ? '#a8201a' : '#ff3b30';
    ctx.beginPath(); if (pressed) ctx.ellipse(0, R * 0.12, R * 0.85, R * 0.6, 0, 0, 7); else ctx.arc(0, -R * 0.06, R * 0.78, 0, 7); ctx.fill();
    if (!pressed) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 0.42, R * 0.2, R * 0.11, -0.5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${R * 0.26}px system-ui, sans-serif`;
    ctx.fillText(phase === 'victory' ? ':(' : 'PRESS', 0, -R * 0.04);
    ctx.restore();
    if (phase === 'button' || phase === 'victory') drawCoaxingHand(cx, cy, R);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (phase === 'button' && t < 3.4) { // the last level
      ctx.save(); ctx.globalAlpha = clamp01(t / 0.3) * clamp01((3.4 - t) / 0.5);
      ctx.font = '900 30px system-ui, sans-serif'; ctx.fillStyle = '#ffd23f'; ctx.fillText('LEVEL 4', W / 2, 30);
      ctx.font = '800 20px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('THE REWARD', W / 2, 60);
      ctx.restore();
    }
    if (phase === 'button' && t > 1.2) {
      const lines = ['Your reward. PRESS IT.', 'You earned it.', 'Go on...', "It's totally safe.", 'Just one little press.', 'Why are you waiting?', 'PRESS. THE. BUTTON.'];
      ctx.font = '800 24px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(lines[Math.floor((t - 1.2) / 2.4) % lines.length], W / 2, H - 30);
    }
    if (phase === 'pressed') { // the snake's hand can't resist
      const k = clamp01(phaseT / 0.45), y = -200 + k * k * (cy - R * 0.3 + 200);
      ctx.save(); ctx.translate(cx, y); ctx.scale(260, 200); ctx.rotate(Math.PI / 2); drawHand(phaseT > 0.45 ? 0.24 : 0.08); ctx.restore();
      if (phaseT > 0.45 && !button.slammed) {
        button.slammed = true; shake = 26; flash = 0.6;
        sfx('slam'); sfx('buzzer'); setTimeout(() => sfx('sadTrombone'), 700);
      }
      if (phaseT > 1.0) {
        ctx.fillStyle = `rgba(7,4,13,${0.7 * clamp01((phaseT - 1) / 0.4)})`; ctx.fillRect(0, 0, W, H);
        ctx.font = '900 56px system-ui, sans-serif'; ctx.fillStyle = '#ff3b30'; ctx.fillText('YOU PRESSED IT.', W / 2, H * 0.4);
        ctx.font = '700 22px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('It said DON\'T PRESS all along. You lose.', W / 2, H * 0.4 + 48);
      }
    }
    if (phase === 'victory') {
      ctx.font = '900 60px system-ui, sans-serif'; ctx.fillStyle = '#5ee07a'; ctx.fillText('TRUE VICTORY', W / 2, H * 0.3);
      ctx.font = '700 22px system-ui, sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText("You didn't press it. Nobody ever doesn't press it.", W / 2, H * 0.3 + 50);
      // the bonus counts up, then pops
      const k = clamp01((phaseT - 0.4) / 1.0), shown = Math.round(ease(k) * VICTORY_POINTS);
      const pop = 1 + Math.max(0, 0.25 - Math.abs(phaseT - 1.45) * 0.8);
      ctx.save(); ctx.translate(W / 2, H * 0.3 + 130); ctx.scale(pop, pop);
      ctx.font = '900 76px system-ui, sans-serif'; ctx.lineWidth = 8; ctx.strokeStyle = '#3a2a00';
      ctx.strokeText(`+${shown}`, 0, 0); ctx.fillStyle = '#ffd23f'; ctx.fillText(`+${shown}`, 0, 0);
      ctx.font = '800 20px system-ui, sans-serif'; ctx.fillStyle = '#ffd23f'; ctx.fillText('BONUS POINTS', 0, 52);
      ctx.restore();
      if (phaseT > 1.6) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '16px system-ui, sans-serif'; ctx.fillText('Press any key to go back to the snake with your bonus', W / 2, H * 0.3 + 230); }
    }
  }

  window.MazeFight = { start, VICTORY_POINTS };
})();
