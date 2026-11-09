// Boss fight: a small side-scroller against Rick, the final boss.
// The snake game starts it when the blue button is slammed:
//   BossFight.start(result => ...)   result is 'win' or 'lose' (or, once the maze level takes over, 'pressed')
// Controls: A/D (or arrows) move, W jumps, S or Space slams (or fires a rocket when you have the launcher).
(() => {
  // ---- Tunables ----
  const W = 960, H = 540;            // logical screen size; the canvas is scaled to fit the window
  const GY = 470;                    // ground level
  const WW = 2000;                   // width of the arena
  const PLATFORMS = [{ x: 380, y: 360, w: 170 }, { x: 900, y: 300, w: 200 }, { x: 1440, y: 360, w: 170 }];
  const PLAYER_HP = 5, RICK_HP = 10;
  const MOVE = 300, JUMP = 650, GRAVITY = 1650;
  const FLEE_DIST = 240, FLEE_SPEED = 290;
  const SLAM_DMG = 1, MEGA_DMG = 2, ROCKET_DMG = 2;
  const ROCKET_AMMO = 3, MEGA_SLAMS = 3;
  // Hand slam timelines (seconds): reach out, wind up, SLAM, hold, then pull back.
  const PLAYER_TL = { reach: 0.14, wind: 0.28, slam: 0.34, hold: 0.45, end: 0.58 };
  const RICK_TL = { reach: 0.3, wind: 1.05, slam: 1.15, hold: 1.55, end: 1.9 };

  // Rick's head, centred on the face and looking right. Shared with the maze level (maze.js).
  // mood: 'normal' | 'hurt' | 'dizzy'
  function drawRickHead(c, mood = 'normal') {
    c.fillStyle = '#f2c7a0'; c.beginPath(); c.ellipse(0, 0, 17, 20, 0, 0, 7); c.fill();
    c.fillStyle = '#d9692b'; c.strokeStyle = '#a3471a'; c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-18, 5); c.quadraticCurveTo(-25, -21, -7, -31);
    c.quadraticCurveTo(15, -41, 27, -25); c.quadraticCurveTo(23, -17, 13, -16);
    c.quadraticCurveTo(1, -17, -5, -9); c.quadraticCurveTo(-9, -1, -12, 9); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#1b1b22';
    if (mood === 'dizzy') { c.font = '700 12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('x', 8, 1); }
    else { c.beginPath(); c.arc(8, -2, 2.4, 0, 7); c.fill(); }
    c.strokeStyle = '#7a3a17'; c.lineWidth = 2; c.beginPath(); c.moveTo(3, -9); c.lineTo(12, -10); c.stroke();
    c.strokeStyle = '#9b4a3a';
    c.beginPath(); if (mood !== 'normal') c.arc(7, 15, 4, Math.PI * 1.1, Math.PI * 1.9); else c.arc(6, 8, 6, 0.2, 1.3); c.stroke();
  }
  window.RickHead = drawRickHead;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clamp01 = t => clamp(t, 0, 1);
  const ease = t => 1 - Math.pow(1 - t, 3);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  let root, cv, ctx, raf, last, onDone, beatTimer, actx;
  let rhead, minis, handedOff; // the head-pop transition into the maze level
  let keys, P, R, cam, shake, bonuses, rockets, fx, texts, rickSlam, phase, phaseT, bonusTimer, flash, ended;

  // ---- Sound ----
  function audio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    return actx;
  }
  function beep(freq, dur = 0.08, type = 'square', vol = 0.05) {
    const a = audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  function thud(big = 1) {
    const a = audio(); if (!a) return;
    const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    g.gain.setValueAtTime(0.45 * big, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.5);
    const len = Math.floor(a.sampleRate * 0.3), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const n = a.createBufferSource(), f = a.createBiquadFilter(), ng = a.createGain();
    n.buffer = buf; f.type = 'lowpass'; f.frequency.value = 1200; ng.gain.value = 0.45 * big;
    n.connect(f).connect(ng).connect(a.destination); n.start(t);
  }
  // a simple disco beat while the fight is on (kick on every beat, hi-hat in between)
  function startBeat() {
    let n = 0;
    beatTimer = setInterval(() => {
      const a = audio(); if (!a || phase === 'lose') return;
      if (n % 2 === 0) {
        const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.15);
      } else beep(7000 + Math.random() * 1000, 0.03, 'square', 0.008);
      n++;
    }, 265);
  }

  // ---- Setup / teardown ----
  function start(done) {
    onDone = done; ended = false;
    root = document.createElement('div');
    root.className = 'boss';
    root.innerHTML = `
      <style>
        .boss { position: fixed; inset: 0; z-index: 50; background: #07040d; display: flex; align-items: center; justify-content: center; }
        .boss canvas { display: block; touch-action: none; }
        .boss .touch { position: absolute; left: 0; right: 0; bottom: 10px; display: none; justify-content: space-between; padding: 0 12px; pointer-events: none; }
        .boss .touch div { display: flex; gap: 10px; }
        .boss .touch button { pointer-events: auto; width: 64px; height: 64px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35);
          background: rgba(255,255,255,.12); color: #fff; font: 700 18px system-ui, sans-serif; }
        .boss .touch button.slam { background: rgba(255,59,48,.55); width: 76px; height: 76px; }
        @media (pointer: coarse) { .boss .touch { display: flex; } }
      </style>
      <canvas></canvas>
      <div class="touch">
        <div><button data-k="left">◀</button><button data-k="right">▶</button></div>
        <div><button data-k="jump">▲</button><button data-k="attack" class="slam">SLAM</button></div>
      </div>`;
    document.body.appendChild(root);
    cv = root.querySelector('canvas'); ctx = cv.getContext('2d');
    for (const b of root.querySelectorAll('.touch button')) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', e => { e.preventDefault(); press(k, true); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => press(k, false));
    }
    cv.addEventListener('pointerdown', () => { if (phase === 'win' || phase === 'lose') finish(); });
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onKey, true);
    addEventListener('resize', resize);
    resize();

    keys = { left: false, right: false, jump: false, attack: false };
    P = { x: 220, y: GY, vx: 0, vy: 0, kb: 0, face: 1, hp: PLAYER_HP, inv: 0, ground: true, slam: null, ammo: 0, mega: 0, cd: 0, t: 0 };
    R = { x: 780, y: GY, face: -1, hp: RICK_HP, st: 'dance', t: 0, stT: 0, atkTimer: 2.2, fleeCd: 0, hurtT: 0, leap: null, say: null, sayT: 0, downT: 0 };
    cam = { x: 0 }; shake = 0; flash = 0;
    bonuses = []; rockets = []; fx = []; texts = []; rickSlam = null;
    phase = 'intro'; phaseT = 0; bonusTimer = 3;
    rhead = null; minis = null; handedOff = false;
    startBeat();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function finish() {
    const lose = phase === 'lose';
    if (ended || phaseT < (lose ? 0.6 : 1.2)) return;
    ended = true;
    clearInterval(beatTimer);
    removeEventListener('keydown', onKey, true);
    removeEventListener('keyup', onKey, true);
    removeEventListener('resize', resize);
    const close = () => { cancelAnimationFrame(raf); root.remove(); };
    onDone && onDone(lose ? 'lose' : 'win');
    if (!lose || !root.animate) return close();
    // Lost: the boss stage closes in a shrinking circle around the fallen snake,
    // revealing the snake game underneath, which is already waiting.
    const r = cv.getBoundingClientRect(), sc = r.width / W;
    const cx = r.left + (P.x - cam.x) * sc, cy = r.top + (P.y - 20) * sc;
    root.style.background = 'transparent';
    const anim = root.animate([
      { clipPath: `circle(150vmax at ${cx}px ${cy}px)` },
      { clipPath: `circle(70px at ${cx}px ${cy}px)`, offset: 0.55 },
      { clipPath: `circle(70px at ${cx}px ${cy}px)`, offset: 0.7 },
      { clipPath: `circle(0px at ${cx}px ${cy}px)` },
    ], { duration: 1400, easing: 'ease-in-out', fill: 'forwards' });
    anim.onfinish = close;
    beep(500, 0.15, 'triangle', 0.05); setTimeout(() => beep(330, 0.2, 'triangle', 0.05), 150); setTimeout(() => beep(196, 0.4, 'triangle', 0.05), 320);
  }

  function resize() {
    const s = Math.min(innerWidth / W, innerHeight / H), dpr = devicePixelRatio || 1;
    cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
    cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  }

  const KEYMAP = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', w: 'jump', arrowup: 'jump',
    s: 'attack', arrowdown: 'attack', ' ': 'attack', j: 'attack', k: 'attack', enter: 'attack' };
  function onKey(e) {
    const k = KEYMAP[e.key.toLowerCase()];
    // the boss fight owns the keyboard while it runs; the snake game underneath must not react
    e.stopImmediatePropagation();
    if (e.type === 'keydown' && (phase === 'win' || phase === 'lose')) { e.preventDefault(); return finish(); }
    if (!k) return;
    e.preventDefault();
    if (e.type === 'keydown' && e.repeat) return;
    press(k, e.type === 'keydown');
  }
  function press(k, down) {
    if (down && (phase === 'win' || phase === 'lose')) return finish();
    keys[k] = down;
    if (down && k === 'jump' && P.ground && phase === 'fight') { P.vy = -JUMP; P.ground = false; beep(520, 0.06, 'triangle', 0.04); }
    if (down && k === 'attack' && phase === 'fight') attack();
  }

  // ---- Effects helpers ----
  function burst(x, y, n, colors, speed = 300, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.9), l = life * (0.5 + Math.random() * 0.7);
      fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: l, max: l, c: pick(colors), g: 900 });
    }
  }
  function popText(x, y, text, c, size = 26) { texts.push({ x, y, text, c, size, life: 1.2 }); }
  function say(text) { R.say = text; R.sayT = 1.6; }

  // ---- Player ----
  function attack() {
    if (P.slam || P.cd > 0) return;
    if (P.ammo > 0) { // rocket launcher
      P.ammo--; P.cd = 0.35;
      rockets.push({ x: P.x + P.face * 34, y: P.y - 34, vx: P.face * 820, t: 0 });
      beep(180, 0.15, 'sawtooth', 0.06);
      burst(P.x + P.face * 40, P.y - 34, 8, ['#fff', '#ccc', '#ffb838'], 120, 0.4);
      return;
    }
    const mega = P.mega > 0;
    if (mega) P.mega--;
    P.slam = { t: 0, tx: P.x + P.face * (mega ? 170 : 140), ty: P.y, mega, done: false };
    beep(300, 0.08, 'triangle', 0.06);
  }

  function hurtPlayer(fromX) {
    if (P.inv > 0 || phase !== 'fight') return;
    P.hp--; P.inv = 1.4; P.slam = null;
    P.kb = Math.sign(P.x - fromX || 1) * 420; P.vy = -380; P.ground = false;
    shake = Math.max(shake, 16); flash = 0.25;
    beep(110, 0.3, 'sawtooth', 0.09);
    popText(P.x, P.y - 70, P.hp > 0 ? 'OUCH!' : 'SLAMMED!', '#ff5a4e', 30);
    if (P.hp <= 0) { phase = 'lose'; phaseT = 0; }
  }

  function updatePlayer(dt) {
    P.t += dt;
    if (P.inv > 0) P.inv -= dt;
    if (P.cd > 0) P.cd -= dt;
    const input = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const control = phase === 'fight' && !P.slam;
    if (control && input) P.face = input;
    P.vx = (control ? input * MOVE : 0) + P.kb;
    P.kb *= Math.pow(0.02, dt);
    const prevY = P.y;
    P.vy += GRAVITY * dt;
    P.x = clamp(P.x + P.vx * dt, 30, WW - 30);
    P.y += P.vy * dt;
    P.ground = false;
    if (P.vy >= 0) for (const pl of PLATFORMS) {
      if (P.x > pl.x - 10 && P.x < pl.x + pl.w + 10 && prevY <= pl.y && P.y >= pl.y) { P.y = pl.y; P.vy = 0; P.ground = true; }
    }
    if (P.y >= GY) { P.y = GY; P.vy = 0; P.ground = true; }

    // the slam
    const s = P.slam;
    if (s) {
      const before = s.t;
      s.t += dt;
      if (before < PLAYER_TL.slam && s.t >= PLAYER_TL.slam) {
        const radius = s.mega ? 115 : 72;
        thud(s.mega ? 0.8 : 0.45); shake = Math.max(shake, s.mega ? 12 : 6);
        burst(s.tx, s.ty - 10, s.mega ? 26 : 14, ['#fff', '#ffd23f', '#ff3b30'], s.mega ? 420 : 300);
        if (Math.abs(R.x - s.tx) < radius && s.ty > R.y - 200 && s.ty < R.y + 30) hitRick(s.mega ? MEGA_DMG : SLAM_DMG);
        else popText(s.tx, s.ty - 60, 'MISS', '#9aa3b5', 20);
      }
      if (s.t >= PLAYER_TL.end) P.slam = null;
    }
  }

  // ---- Rick ----
  function hitRick(dmg) {
    if (R.st === 'down') return;
    R.hp = Math.max(0, R.hp - dmg); R.hurtT = 0.35;
    popText(R.x, R.y - 220, `-${dmg}`, '#ffd23f', 34);
    burst(R.x, R.y - 120, 16, ['#ffd23f', '#fff', '#d9692b'], 350);
    beep(880, 0.08, 'square', 0.06);
    if (R.hp <= 0 && window.MazeFight) { // on to the FINAL final boss
      R.st = 'decap'; rickSlam = null; phase = 'decap'; phaseT = 0; rockets = []; bonuses = [];
      say('Wait... what?!');
      return;
    }
    if (R.hp <= 0) {
      R.st = 'down'; R.downT = 0; rickSlam = null; phase = 'win'; phaseT = 0;
      say('Never gonna give... ugh');
      for (let i = 0; i < 5; i++) setTimeout(() => burst(R.x + (Math.random() - 0.5) * 200, R.y - 150 - Math.random() * 100, 30,
        ['#ff3b30', '#ffd23f', '#46d4ff', '#5ee07a', '#ff7ae0'], 380, 1.2), i * 220);
      return;
    }
    say(pick(['Ouch!', 'Not the hair!', 'Hey!', 'That hurt!']));
    if (R.st !== 'attack' && R.st !== 'leap') { R.st = 'hurt'; R.stT = 0; }
  }

  function startRickSlam() {
    R.st = 'attack'; R.stT = 0;
    rickSlam = { t: 0, tx: clamp(P.x, 60, WW - 60), ty: GY, done: false };
    say('Never gonna give you up!');
    beep(220, 0.2, 'square', 0.05);
  }

  function updateRick(dt) {
    R.t += dt; R.stT += dt;
    if (R.hurtT > 0) R.hurtT -= dt;
    if (R.sayT > 0) R.sayT -= dt;
    const dist = Math.abs(P.x - R.x), away = Math.sign(R.x - P.x) || 1;
    if (R.st !== 'leap' && R.st !== 'down') R.face = Math.sign(P.x - R.x) || R.face;

    switch (R.st) {
      case 'dance':
        R.fleeCd -= dt; R.atkTimer -= dt;
        if (dist < FLEE_DIST && R.fleeCd <= 0) { R.st = 'flee'; R.stT = 0; if (Math.random() < 0.5) say(pick(['Too slow!', 'Catch me if you can!', 'Dance-off!', 'Nope!'])); }
        else if (R.atkTimer <= 0) startRickSlam();
        break;
      case 'flee':
        R.x += away * FLEE_SPEED * dt;
        if ((R.atkTimer -= dt) <= 0 && dist > 160) { startRickSlam(); break; } // he also stops mid-dance to slam
        if (R.x < 90 || R.x > WW - 90) { // cornered: leap over the player
          R.x = clamp(R.x, 90, WW - 90);
          R.st = 'leap'; R.stT = 0;
          R.leap = { x0: R.x, x1: clamp(P.x - away * 330, 120, WW - 120), dur: 0.95 };
          say('Wheee!'); beep(660, 0.25, 'triangle', 0.05);
        } else if (dist > 430 || R.stT > 1.7) { R.st = 'dance'; R.stT = 0; R.fleeCd = 0.4; }
        break;
      case 'leap': {
        const k = clamp01(R.stT / R.leap.dur);
        R.x = R.leap.x0 + (R.leap.x1 - R.leap.x0) * k;
        R.y = GY - Math.sin(k * Math.PI) * 240;
        if (k >= 1) { R.y = GY; R.st = 'dizzy'; R.stT = 0; shake = Math.max(shake, 6); say('Whoa... dizzy'); }
        break;
      }
      case 'dizzy':
        if (R.stT > 1.4) { R.st = 'dance'; R.stT = 0; R.fleeCd = 1.0; R.atkTimer = Math.min(R.atkTimer, 1.2); }
        break;
      case 'hurt':
        R.x = clamp(R.x + away * 160 * dt, 90, WW - 90);
        if (R.stT > 0.45) { R.st = 'flee'; R.stT = 0; }
        break;
      case 'attack':
        if (!rickSlam) { R.st = 'dance'; R.stT = 0; R.atkTimer = 2.8 + Math.random() * 1.6; R.fleeCd = 0.4; }
        break;
      case 'down':
        R.downT += dt;
        break;
    }

    const s = rickSlam;
    if (s) {
      const before = s.t;
      s.t += dt;
      if (before < RICK_TL.slam && s.t >= RICK_TL.slam) {
        thud(1.2); shake = Math.max(shake, 22);
        burst(s.tx, s.ty - 10, 40, ['#fff', '#ffd23f', '#ff3b30', '#ff8a3d'], 520, 0.8);
        if (Math.abs(P.x - s.tx) < 125) hurtPlayer(s.tx);
      }
      if (s.t >= RICK_TL.end) rickSlam = null;
    }
  }

  // ---- Rick loses his head: it pops off, bounces, and bursts into mini heads that roll away ----
  const POP_AT = 1.0, HANDOFF_AT = 5.2;
  function updateDecap(dt) {
    const t = phaseT;
    R.t += dt * 0.6; // the body keeps dancing, a bit slower
    if (R.sayT > 0) R.sayT -= dt;
    if (R.hurtT > 0) R.hurtT -= dt;
    if (!rhead && !minis && t > POP_AT) {
      R.headless = true;
      rhead = { x: R.x + R.face * 3, y: R.y - 175, vx: -R.face * 90, vy: -720, rot: 0, vr: 9 * R.face, bounces: 0 };
      shake = Math.max(shake, 8);
      beep(900, 0.06, 'square', 0.07); setTimeout(() => beep(1500, 0.08, 'square', 0.06), 40);
      burst(rhead.x, rhead.y, 16, ['#fff', '#ffd23f'], 300);
      popText(rhead.x, rhead.y - 40, 'POP!', '#fff', 40);
    }
    if (rhead) {
      rhead.vy += 1500 * dt; rhead.x += rhead.vx * dt; rhead.y += rhead.vy * dt; rhead.rot += rhead.vr * dt;
      if (rhead.y >= GY - 20 && rhead.vy > 0) {
        rhead.y = GY - 20; rhead.vy *= -0.5; rhead.bounces++; thud(0.4); shake = Math.max(shake, 5);
        if (rhead.bounces >= 2) split();
      }
    }
    if (minis) for (const m of minis) {
      m.vy += 1500 * dt; m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y >= GY - 9 && m.vy > 0) { m.y = GY - 9; m.vy *= -0.4; }
      m.rot += m.vx * dt / 9; // rolling
    }
    if (t > HANDOFF_AT) handOff();
  }
  function split() {
    const x = rhead.x, y = rhead.y;
    rhead = null;
    minis = [];
    for (let i = 0; i < 8; i++) {
      const side = i % 2 ? 1 : -1;
      minis.push({ x, y, vx: side * (140 + Math.random() * 320), vy: -250 - Math.random() * 450, rot: 0 });
    }
    thud(0.9); shake = Math.max(shake, 14);
    burst(x, y, 40, ['#ddd', '#aaa', '#fff', '#d9692b'], 380, 0.9);
    beep(200, 0.4, 'sawtooth', 0.07);
  }
  // Hand over to the maze level once the screen has faded to black.
  function handOff() {
    if (handedOff) return;
    handedOff = true; ended = true;
    clearInterval(beatTimer);
    removeEventListener('keydown', onKey, true);
    removeEventListener('keyup', onKey, true);
    removeEventListener('resize', resize);
    window.MazeFight.start(onDone);
    setTimeout(() => { cancelAnimationFrame(raf); root.remove(); }, 60);
  }

  // ---- Rockets and bonuses ----
  function updateRockets(dt) {
    for (const r of rockets) {
      r.x += r.vx * dt; r.t += dt;
      if (Math.random() < 0.7) fx.push({ x: r.x - Math.sign(r.vx) * 18, y: r.y + (Math.random() - 0.5) * 6, vx: -r.vx * 0.05, vy: -20,
        life: 0.5, max: 0.5, c: pick(['#bbb', '#888', '#ffb838']), g: 0, smoke: true });
      const hitR = R.st !== 'down' && Math.abs(r.x - R.x) < 36 && r.y > R.y - 210 && r.y < R.y + 5;
      if (hitR || r.x < 0 || r.x > WW) {
        r.dead = true;
        burst(r.x, r.y, 30, ['#ff3b30', '#ffb838', '#fff', '#555'], 420, 0.7);
        thud(0.7); shake = Math.max(shake, 10);
        if (hitR) hitRick(ROCKET_DMG);
      }
    }
    rockets = rockets.filter(r => !r.dead);
  }

  function updateBonuses(dt) {
    if ((bonusTimer -= dt) <= 0 && bonuses.length < 2) {
      bonusTimer = 6 + Math.random() * 3;
      const type = P.hp < PLAYER_HP && Math.random() < 0.35 ? 'heart' : Math.random() < 0.6 ? 'rocket' : 'mega';
      bonuses.push({ type, x: clamp(cam.x + 80 + Math.random() * (W - 160), 60, WW - 60), y: -30, landed: false, life: 11, t: 0 });
    }
    for (const b of bonuses) {
      b.t += dt;
      if (!b.landed) {
        const prev = b.y;
        b.y += 120 * dt;
        for (const pl of PLATFORMS) if (b.x > pl.x && b.x < pl.x + pl.w && prev <= pl.y && b.y >= pl.y) { b.y = pl.y; b.landed = true; }
        if (b.y >= GY) { b.y = GY; b.landed = true; }
      } else b.life -= dt;
      if (Math.abs(P.x - b.x) < 42 && Math.abs(P.y - b.y) < 60) {
        b.dead = true;
        burst(b.x, b.y - 24, 16, ['#fff', '#ffd23f', '#5ee07a'], 260);
        beep(660, 0.08, 'triangle', 0.06); setTimeout(() => beep(990, 0.12, 'triangle', 0.06), 80);
        if (b.type === 'rocket') { P.ammo += ROCKET_AMMO; popText(b.x, b.y - 70, 'ROCKET LAUNCHER!', '#7cff8a'); }
        else if (b.type === 'mega') { P.mega += MEGA_SLAMS; popText(b.x, b.y - 70, 'MEGA SLAM!', '#ffd23f'); }
        else { P.hp = Math.min(PLAYER_HP, P.hp + 1); popText(b.x, b.y - 70, '+1 HEART', '#ff5a7a'); }
      }
    }
    bonuses = bonuses.filter(b => !b.dead && b.life > 0);
  }

  // ---- Main loop ----
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now;
    phaseT += dt;
    if (phase === 'intro' && phaseT > 2.4) { phase = 'fight'; phaseT = 0; }
    if (phase === 'lose' && phaseT > 2) finish(); // no key needed: straight back to the snake
    if (phase === 'decap') { updatePlayer(dt); updateDecap(dt); }
    else if (phase === 'fight' || phase === 'win' || phase === 'lose') {
      updatePlayer(dt);
      if (phase !== 'lose') updateRick(dt); else R.t += dt;
      updateRockets(dt);
      if (phase === 'fight') updateBonuses(dt);
    } else R.t += dt;
    for (const p of fx) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.vx *= 0.97; p.life -= dt; }
    fx = fx.filter(p => p.life > 0);
    for (const t of texts) { t.y -= 50 * dt; t.life -= dt; }
    texts = texts.filter(t => t.life > 0);
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    if (flash > 0) flash -= dt;
    const target = clamp(P.x - W * 0.45, 0, WW - W);
    cam.x += (target - cam.x) * Math.min(1, dt * 6);
    draw();
    raf = requestAnimationFrame(frame);
  }

  // ---- Drawing ----
  function draw() {
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    drawBackground();
    ctx.save();
    ctx.translate(-Math.round(cam.x) + sx, sy);
    drawStage();
    for (const b of bonuses) drawBonus(b);
    if (rickSlam) drawMarker(rickSlam.tx, rickSlam.ty, 125, rickSlam.t, RICK_TL, '255,70,60');
    if (P.slam) drawMarker(P.slam.tx, P.slam.ty, P.slam.mega ? 115 : 72, P.slam.t, PLAYER_TL, '120,255,140');
    drawRick();
    if (rhead) { ctx.save(); ctx.translate(rhead.x, rhead.y); ctx.rotate(rhead.rot); ctx.scale(R.face, 1); drawRickHead(ctx, 'hurt'); ctx.restore(); }
    if (minis) for (const m of minis) { ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot); ctx.scale(0.45, 0.45); drawRickHead(ctx, 'normal'); ctx.restore(); }
    drawPlayer();
    for (const r of rockets) drawRocket(r);
    if (rickSlam) drawRickSlam();
    if (P.slam) drawPlayerSlam();
    for (const p of fx) {
      ctx.globalAlpha = clamp01(p.life / p.max * 1.4);
      ctx.fillStyle = p.c;
      if (p.smoke) { ctx.beginPath(); ctx.arc(p.x, p.y, 6 + (1 - p.life / p.max) * 10, 0, 7); ctx.fill(); }
      else ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
    ctx.globalAlpha = 1;
    drawSpeech();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of texts) {
      ctx.globalAlpha = clamp01(t.life / 0.4);
      ctx.font = `900 ${t.size}px system-ui, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = '#120818'; ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.c; ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (flash > 0) { ctx.fillStyle = `rgba(255,60,50,${flash})`; ctx.fillRect(0, 0, W, H); }
    drawHUD();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12052a'); g.addColorStop(0.6, '#3a0c58'); g.addColorStop(1, '#5a1260');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // stars
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i < 60; i++) {
      const x = ((i * 157) % 2000 - cam.x * 0.1 + 2000) % 1000 - 20, y = (i * 97) % 260;
      ctx.fillRect(x, y, 2, 2);
    }
    // far skyline
    ctx.fillStyle = '#1d0833';
    for (let i = 0; i < 30; i++) {
      const bw = 70 + (i * 37) % 60, bh = 80 + (i * 53) % 140, x = i * 95 - cam.x * 0.3;
      if (x > -bw && x < W) ctx.fillRect(x, GY - bh, bw, bh);
    }
    // sweeping spotlights
    const t = performance.now() / 1000;
    for (let i = 0; i < 4; i++) {
      const bx = 120 + i * 240, a = Math.sin(t * 0.8 + i * 1.7) * 0.5;
      ctx.save(); ctx.translate(bx, -10); ctx.rotate(a);
      const sg = ctx.createLinearGradient(0, 0, 0, GY);
      const c = ['255,80,200', '80,200,255', '255,220,80', '160,255,120'][i];
      sg.addColorStop(0, `rgba(${c},.35)`); sg.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(120, GY + 20); ctx.lineTo(-120, GY + 20); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawStage() {
    const t = performance.now() / 1000, beat = Math.floor(t / 0.53);
    // disco floor
    for (let x = 0; x < WW; x += 80) {
      const lit = (x / 80 + beat) % 3 === 0;
      ctx.fillStyle = lit ? ['#ff4fb8', '#4fd2ff', '#ffd84f'][(x / 80) % 3] : '#24102f';
      ctx.globalAlpha = lit ? 0.75 : 1;
      ctx.fillRect(x, GY, 78, H - GY);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#ff4fb8'; ctx.fillRect(0, GY - 2, WW, 3);
    // arena walls
    ctx.fillStyle = '#2a0f3c'; ctx.fillRect(-40, 0, 40, H); ctx.fillRect(WW, 0, 40, H);
    // platforms
    for (const pl of PLATFORMS) {
      ctx.fillStyle = '#2b1240'; ctx.fillRect(pl.x, pl.y, pl.w, 16);
      ctx.fillStyle = '#4fd2ff'; ctx.fillRect(pl.x, pl.y, pl.w, 3);
      ctx.fillStyle = 'rgba(79,210,255,.18)'; ctx.fillRect(pl.x, pl.y + 16, pl.w, 6);
    }
  }

  // A target marker on the floor showing where a hand is about to land (radius = how far the hit reaches).
  // It pulses faster as the slam gets closer, and fades out after the impact.
  function drawMarker(x, y, radius, t, tl, rgb) {
    const pop = ease(clamp01(t / 0.15));
    const fade = t < tl.slam ? 1 : 1 - clamp01((t - tl.slam) / 0.3);
    if (fade <= 0) return;
    const k = clamp01(t / tl.slam), pulse = 0.5 + 0.5 * Math.sin(t * (8 + k * 30));
    const rx = radius * pop, ry = radius * 0.16 * pop;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = `rgba(${rgb},${0.12 + k * 0.18})`;
    ctx.beginPath(); ctx.ellipse(x, y + 2, rx, ry, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${rgb},${0.6 + pulse * 0.4})`; ctx.lineWidth = 3;
    ctx.setLineDash([14, 9]); ctx.lineDashOffset = -t * 60;
    ctx.beginPath(); ctx.ellipse(x, y + 2, rx, ry, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.ellipse(x, y + 2, rx * 0.35, ry * 0.35, 0, 0, 7); ctx.stroke();
    ctx.beginPath(); // crosshair
    ctx.moveTo(x - rx * 0.6, y + 2); ctx.lineTo(x - rx * 0.15, y + 2); ctx.moveTo(x + rx * 0.15, y + 2); ctx.lineTo(x + rx * 0.6, y + 2);
    ctx.stroke();
    if (t < tl.slam) { // bobbing arrow above the spot
      const ay = y - 34 - Math.abs(Math.sin(t * 7)) * 10, s = radius > 100 ? 14 : 10;
      ctx.fillStyle = `rgba(${rgb},${0.7 + pulse * 0.3})`;
      ctx.beginPath(); ctx.moveTo(x - s, ay - s); ctx.lineTo(x + s, ay - s); ctx.lineTo(x, ay); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // An open cartoon hand: palm with four fingers along +x and a thumb, in units of its own size.
  function drawHand(spread, fill, stroke) {
    ctx.translate(0.1, 0);
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 0.05; ctx.lineJoin = 'round';
    const fingers = [[-0.21, 0.30], [-0.07, 0.38], [0.07, 0.36], [0.21, 0.28]];
    fingers.forEach(([y, len], i) => {
      ctx.save(); ctx.translate(0.12, y); ctx.rotate((i - 1.5) * spread);
      ctx.beginPath(); ctx.roundRect(0, -0.06, len, 0.12, 0.06); ctx.fill(); ctx.stroke();
      ctx.restore();
    });
    ctx.save(); ctx.translate(-0.08, 0.24); ctx.rotate(0.9 + spread);
    ctx.beginPath(); ctx.roundRect(0, -0.065, 0.3, 0.13, 0.065); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.beginPath(); ctx.roundRect(-0.36, -0.29, 0.52, 0.58, 0.16); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.035;
    for (const [y] of fingers) { ctx.beginPath(); ctx.moveTo(0.06, y - 0.04); ctx.lineTo(0.06, y + 0.04); ctx.stroke(); }
  }

  // Where a slamming hand is: reaches from (ox, oy) to above (tx, ty), winds up, slams, pulls back.
  function slamPose(t, tl, ox, oy, tx, ty, height) {
    const reach = ease(clamp01(t / tl.reach));
    let lift, back = 0;
    if (t < tl.reach) lift = reach;
    else if (t < tl.wind) lift = 1 + ease((t - tl.reach) / (tl.wind - tl.reach)) * 0.35;
    else if (t < tl.slam) lift = 1.35 * (1 - Math.pow((t - tl.wind) / (tl.slam - tl.wind), 2));
    else if (t < tl.hold) lift = Math.abs(Math.sin((t - tl.slam) * 18)) * 0.08 * Math.max(0, 1 - (t - tl.slam) * 4);
    else { back = ease(clamp01((t - tl.hold) / (tl.end - tl.hold))); lift = back * 0.8; }
    const k = reach * (1 - back);
    return { x: ox + (tx - ox) * k, y: ty - lift * height + (oy - ty) * back * 0.5, lift, slammed: t >= tl.slam && t < tl.hold };
  }

  function drawArmAndHand(ox, oy, pose, size, sleeve, sleeveEdge, skin, skinEdge, face, thick, arc = 0.6) {
    const mx = (ox + pose.x) / 2, my = Math.min(oy, pose.y) - size * arc * (1 + pose.lift * 0.8);
    ctx.lineCap = 'round';
    for (const [w, c] of [[thick + 6, sleeveEdge], [thick, sleeve]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.quadraticCurveTo(mx, my, pose.x - face * size * 0.25, pose.y - size * 0.1); ctx.stroke();
    }
    ctx.save();
    ctx.translate(pose.x, pose.y - size * 0.12);
    const sc = size * (1 + pose.lift * 0.25);
    ctx.scale(face * sc, sc * (pose.slammed ? 0.45 : 0.6)); // palm-down hand, squashed flat on impact
    drawHand(pose.slammed ? 0.24 : 0.08, skin, skinEdge);
    ctx.restore();
    if (pose.lift > 1.1) { // motion lines while it comes down
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 3;
      for (const o of [-0.4, 0, 0.4]) { ctx.beginPath(); ctx.moveTo(pose.x + o * size, pose.y - size * 1.3); ctx.lineTo(pose.x + o * size, pose.y - size * 0.7); ctx.stroke(); }
    }
  }

  function drawRickSlam() {
    const s = rickSlam;
    const ox = R.x + R.face * 16, oy = R.y - 200; // from his raised hand
    const pose = slamPose(s.t, RICK_TL, ox, oy, s.tx, s.ty, 260);
    // warning shadow where it will land
    if (s.t < RICK_TL.slam) {
      const k = clamp01(s.t / RICK_TL.slam);
      ctx.fillStyle = `rgba(0,0,0,${0.2 + k * 0.35})`;
      ctx.beginPath(); ctx.ellipse(s.tx, s.ty + 4, 125 * (0.5 + k * 0.5), 18, 0, 0, 7); ctx.fill();
    }
    drawArmAndHand(ox, oy, pose, 170, '#2b2b33', '#121217', '#f2c7a0', '#a0704f', Math.sign(s.tx - R.x) || 1, 30, 0.25);
    const ti = s.t - RICK_TL.slam;
    if (ti > 0 && ti < 0.5) { // shockwave
      ctx.strokeStyle = `rgba(255,255,255,${1 - ti / 0.5})`; ctx.lineWidth = 8 * (1 - ti / 0.5) + 1;
      ctx.beginPath(); ctx.ellipse(s.tx, s.ty, 60 + ti * 600, 14 + ti * 90, 0, 0, 7); ctx.stroke();
    }
  }

  function drawPlayerSlam() {
    const s = P.slam, size = s.mega ? 95 : 55;
    const ox = P.x + P.face * 14, oy = P.y - 36;
    const pose = slamPose(s.t, PLAYER_TL, ox, oy, s.tx, s.ty, s.mega ? 150 : 100);
    drawArmAndHand(ox, oy, pose, size, '#5ee07a', '#2c8a44', '#9bf0ac', '#2c8a44', P.face, s.mega ? 16 : 10);
    const ti = s.t - PLAYER_TL.slam;
    if (ti > 0 && ti < 0.35) {
      ctx.strokeStyle = `rgba(255,255,255,${1 - ti / 0.35})`; ctx.lineWidth = 5 * (1 - ti / 0.35) + 1;
      ctx.beginPath(); ctx.ellipse(s.tx, s.ty, 30 + ti * (s.mega ? 500 : 320), 8 + ti * 50, 0, 0, 7); ctx.stroke();
    }
  }

  // The player: a green snake, seen from the side.
  function drawPlayer() {
    if (P.inv > 0 && Math.floor(P.inv * 12) % 2) return;
    const moving = Math.abs(P.vx) > 10 ? 1 : 0.25, f = P.face;
    ctx.save(); ctx.translate(P.x, P.y);
    if (phase === 'lose') { ctx.rotate(f * Math.min(1, phaseT * 2) * Math.PI / 2); }
    for (let i = 7; i >= 1; i--) {
      const x = -f * i * 10, y = -12 - Math.sin(P.t * 12 * moving - i * 0.9) * 5, r = 13 - i * 0.8;
      ctx.fillStyle = `hsl(135, 65%, ${50 - i * 2.5}%)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    if (P.ammo > 0) { // rocket launcher on its back
      ctx.fillStyle = '#4b5a3c'; ctx.fillRect(-f * 30 - 20, -46, 46, 12);
      ctx.fillStyle = '#ff3b30'; ctx.fillRect(f > 0 ? 6 : -26, -46, 6, 12);
    }
    ctx.fillStyle = '#a6f5b5';
    ctx.beginPath(); ctx.ellipse(f * 12, -26, 17, 14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f * 17, -31, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#14161b'; ctx.beginPath(); ctx.arc(f * 18.5, -31, 2.6, 0, 7); ctx.fill();
    if (Math.floor(P.t * 2.5) % 3 === 0) { // tongue flick
      ctx.strokeStyle = '#ff5a7a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(f * 28, -22); ctx.lineTo(f * 38, -22); ctx.lineTo(f * 42, -25); ctx.moveTo(f * 38, -22); ctx.lineTo(f * 42, -19); ctx.stroke();
    }
    ctx.restore();
  }

  // Rick: a cartoon pop star in a long dark coat with a big ginger quiff, always dancing.
  function drawRick() {
    if (R.hurtT > 0 && Math.floor(R.hurtT * 20) % 2) return;
    const t = R.t, dancing = R.st === 'dance' || R.st === 'flee' || R.st === 'hurt' || R.st === 'decap' || phase === 'intro';
    const sp = R.st === 'flee' ? 9 : 6;
    const bob = dancing ? Math.abs(Math.sin(t * sp)) * 7 : 0, step = dancing ? Math.sin(t * sp) : 0;
    ctx.save();
    ctx.translate(R.x, R.y);
    if (R.st === 'leap') ctx.rotate(R.face * clamp01(R.stT / R.leap.dur) * Math.PI * 2);
    if (R.st === 'down') { const k = clamp01(R.downT * 2); ctx.rotate(-R.face * k * Math.PI / 2); }
    ctx.scale(R.face, 1);
    // legs and shoes
    ctx.strokeStyle = '#1b1b22'; ctx.lineWidth = 13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -64); ctx.lineTo(-12 + step * 10, -4); ctx.moveTo(8, -64); ctx.lineTo(12 - step * 10, -4); ctx.stroke();
    ctx.fillStyle = '#0d0d10';
    ctx.beginPath(); ctx.ellipse(-8 + step * 10, -3, 13, 5, 0, 0, 7); ctx.ellipse(16 - step * 10, -3, 13, 5, 0, 0, 7); ctx.fill();
    ctx.translate(0, -bob);
    // coat
    const sway = step * 6;
    ctx.fillStyle = '#2b2b33'; ctx.strokeStyle = '#121217'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-24, -152); ctx.lineTo(24, -152); ctx.lineTo(36 + sway, -52); ctx.lineTo(-36 + sway, -52); ctx.closePath(); ctx.fill(); ctx.stroke();
    // shirt and collar
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath(); ctx.moveTo(-10, -152); ctx.lineTo(10, -152); ctx.lineTo(0, -118); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b1b22';
    ctx.beginPath(); ctx.moveTo(-2, -146); ctx.lineTo(2, -146); ctx.lineTo(3, -122); ctx.lineTo(0, -116); ctx.lineTo(-3, -122); ctx.closePath(); ctx.fill();
    // arms: the side-to-side dance, or one arm raised while slamming
    ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = 12;
    const swing = dancing ? Math.sin(t * sp) : 0;
    const arms = R.st === 'attack' ? [[[-30, -120], [-20, -96]], [[28, -180], [18, -205]]]
      : R.st === 'dizzy' || R.st === 'down' ? [[[-30, -110], [-34, -80]], [[30, -110], [34, -80]]]
      : [[[-28 + swing * 6, -118], [swing * 22 - 6, -104]], [[28 + swing * 6, -118], [swing * 22 + 8, -100]]];
    arms.forEach(([elbow, hand], i) => {
      const sx = i ? 22 : -22;
      ctx.beginPath(); ctx.moveTo(sx, -146); ctx.lineTo(elbow[0], elbow[1]); ctx.lineTo(hand[0], hand[1]); ctx.stroke();
      ctx.fillStyle = '#f2c7a0'; ctx.beginPath(); ctx.arc(hand[0], hand[1], 6, 0, 7); ctx.fill();
    });
    // neck and head (gone once it has popped off)
    if (!R.headless) {
      ctx.fillStyle = '#f2c7a0'; ctx.fillRect(-5, -160, 10, 10);
      ctx.save(); ctx.translate(3, -175);
      drawRickHead(ctx, R.st === 'dizzy' || R.st === 'down' ? 'dizzy' : R.hurtT > 0 || R.st === 'decap' ? 'hurt' : 'normal');
      ctx.restore();
    } else { // a tidy collar where the head used to be
      ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.ellipse(0, -153, 11, 4, 0, 0, 7); ctx.fill();
    }
    ctx.restore();
    // dizzy stars
    if (R.st === 'dizzy') {
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * 2.1;
        ctx.fillStyle = '#ffd23f'; ctx.font = '18px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('★', R.x + Math.cos(a) * 26, R.y - 210 + Math.sin(a) * 8);
      }
    }
  }

  function drawSpeech() {
    if (R.sayT <= 0 || !R.say) return;
    ctx.globalAlpha = clamp01(R.sayT / 0.3);
    ctx.font = '700 16px system-ui, sans-serif';
    const w = ctx.measureText(R.say).width + 22, x = clamp(R.x - w / 2, 10, WW - w - 10), y = R.y - 268;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#120818'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, 32, 12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R.x - 6, y + 31); ctx.lineTo(R.x + 4, y + 44); ctx.lineTo(R.x + 8, y + 31); ctx.fill();
    ctx.fillStyle = '#120818'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(R.say, x + 11, y + 16);
    ctx.globalAlpha = 1;
  }

  function drawRocket(r) {
    const f = Math.sign(r.vx);
    ctx.save(); ctx.translate(r.x, r.y); ctx.scale(f, 1);
    ctx.fillStyle = '#d8dde6'; ctx.fillRect(-16, -5, 26, 10);
    ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(20, 0); ctx.lineTo(10, 5); ctx.fill();
    ctx.fillStyle = '#8a93a3'; ctx.beginPath(); ctx.moveTo(-16, -5); ctx.lineTo(-22, -10); ctx.lineTo(-12, -5); ctx.moveTo(-16, 5); ctx.lineTo(-22, 10); ctx.lineTo(-12, 5); ctx.fill();
    ctx.fillStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff7a1a'; ctx.beginPath(); ctx.arc(-20, 0, 4 + Math.random() * 3, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawBonus(b) {
    if (b.landed && b.life < 2.5 && Math.floor(b.life * 8) % 2) return;
    const y = b.y - 26 + (b.landed ? Math.sin(b.t * 4) * 4 : 0);
    if (!b.landed) { // parachute
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(b.x - 26, y - 46); ctx.lineTo(b.x, y - 10); ctx.lineTo(b.x + 26, y - 46); ctx.stroke();
      ctx.fillStyle = '#ff4fb8'; ctx.beginPath(); ctx.arc(b.x, y - 46, 28, Math.PI, 0); ctx.fill();
    }
    const col = { rocket: '#7cff8a', mega: '#ffd23f', heart: '#ff5a7a' }[b.type];
    ctx.fillStyle = col; ctx.globalAlpha = 0.25 + 0.1 * Math.sin(b.t * 6);
    ctx.beginPath(); ctx.arc(b.x, y, 30, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#140a1e'; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(b.x, y, 22, 0, 7); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.translate(b.x, y);
    if (b.type === 'rocket') {
      ctx.rotate(-0.4);
      ctx.fillStyle = '#4b5a3c'; ctx.fillRect(-15, -5, 28, 10);
      ctx.fillStyle = '#2d3524'; ctx.fillRect(-6, 4, 5, 8);
      ctx.fillStyle = '#ff3b30'; ctx.beginPath(); ctx.moveTo(13, -6); ctx.lineTo(20, 0); ctx.lineTo(13, 6); ctx.fill();
    } else if (b.type === 'heart') {
      ctx.fillStyle = '#ff5a7a';
      ctx.beginPath(); ctx.moveTo(0, 10); ctx.bezierCurveTo(-18, -2, -10, -16, 0, -6); ctx.bezierCurveTo(10, -16, 18, -2, 0, 10); ctx.fill();
    } else {
      ctx.scale(26, 26); ctx.rotate(-Math.PI / 2);
      drawHand(0.12, '#ffd23f', '#a07a10');
    }
    ctx.restore();
  }

  function drawHeart(x, y, s, full) {
    ctx.fillStyle = full ? '#ff5a7a' : 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.9); ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.9, y - s * 1.4, x, y - s * 0.5);
    ctx.bezierCurveTo(x + s * 0.9, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9); ctx.fill();
  }

  function drawHUD() {
    // player hearts and weapon
    for (let i = 0; i < PLAYER_HP; i++) drawHeart(30 + i * 30, 32, 10, i < P.hp);
    ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const weapon = P.ammo > 0 ? [`ROCKETS ×${P.ammo}`, '#7cff8a'] : P.mega > 0 ? [`MEGA SLAM ×${P.mega}`, '#ffd23f'] : ['SLAM', '#c9c3d6'];
    ctx.fillStyle = weapon[1]; ctx.fillText(weapon[0], 18, 62);
    // boss bar
    const bw = 380, bx = W - bw - 24, by = 28;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillText('RICK · THE FINAL BOSS', W - 24, by - 10);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx, by, bw, 14);
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(bx + 2, by + 2, (bw - 4) * R.hp / RICK_HP, 10);
    // where Rick is, when he's off screen
    const rx = R.x - cam.x;
    if (rx < 0 || rx > W) {
      const left = rx < 0;
      ctx.fillStyle = '#ffd23f'; ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(left ? '◀ RICK' : 'RICK ▶', left ? 14 : W - 14, GY - 120);
    }
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('A / D move · W jump · S or Space slam (or fire rockets)', W / 2, H - 14);

    // intro / end cards
    if (phase === 'intro') {
      const k = clamp01(phaseT / 0.4);
      ctx.fillStyle = `rgba(7,4,13,${0.55 * (1 - clamp01((phaseT - 1.9) / 0.5))})`; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2, H * 0.36); ctx.scale(k, k);
      ctx.textAlign = 'center'; ctx.fillStyle = '#ff3b30'; ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillText('FINAL BOSS', 0, 0);
      ctx.fillStyle = '#fff'; ctx.font = '700 24px system-ui, sans-serif';
      ctx.fillText('Slam Rick before he slams you', 0, 50);
      ctx.restore();
    }
    if (phase === 'decap' && minis) {
      const k = phaseT - POP_AT - 1.0;
      const s = 0.8 + 0.2 * ease(clamp01(k / 0.4));
      ctx.save(); ctx.translate(W / 2, H * 0.3); ctx.scale(s, s); ctx.rotate(Math.sin(phaseT * 20) * 0.02);
      ctx.globalAlpha = clamp01(k / 0.3);
      ctx.textAlign = 'center'; ctx.font = '900 60px system-ui, sans-serif';
      ctx.lineWidth = 8; ctx.strokeStyle = '#120818'; ctx.strokeText('THE FINAL FINAL BOSS', 0, 0);
      ctx.fillStyle = '#ff3b30'; ctx.fillText('THE FINAL FINAL BOSS', 0, 0);
      ctx.font = '700 22px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText("It's not over. It's never over.", 0, 44);
      ctx.restore();
    }
    if (phase === 'decap' && phaseT > HANDOFF_AT - 1) { // fade to black before the maze
      ctx.fillStyle = `rgba(0,0,0,${clamp01((phaseT - (HANDOFF_AT - 1)) / 0.9)})`; ctx.fillRect(0, 0, W, H);
    }
    if (phase === 'win' || phase === 'lose') {
      const win = phase === 'win';
      ctx.fillStyle = `rgba(7,4,13,${0.5 * clamp01(phaseT)})`; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.fillStyle = win ? '#5ee07a' : '#ff3b30'; ctx.font = '900 58px system-ui, sans-serif';
      ctx.fillText(win ? 'RICK DEFEATED!' : 'YOU GOT SLAMMED', W / 2, H * 0.38);
      ctx.fillStyle = '#fff'; ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText(win ? 'He gave you up.' : 'Rick wins. Back to the snake.', W / 2, H * 0.38 + 46);
      if (win && phaseT > 1.2) { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '16px system-ui, sans-serif'; ctx.fillText('Press any key or tap to continue', W / 2, H * 0.38 + 86); }
    }
  }

  window.BossFight = { start };
})();
