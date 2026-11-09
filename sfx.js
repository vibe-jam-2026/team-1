// Sound effects and music for all levels, synthesized with the Web Audio API (no audio files).
//   SFX.play('pop')            a named effect (see FX below)
//   SFX.beep(freq, dur, type, vol) / SFX.thud(volume)   simple building blocks
//   SFX.music('boss' | 'maze' | null)   a background loop, or silence
//   SFX.toggleMute()           M key in the game
(() => {
  let ac = null, master = null, musicBus = null, muted = false;
  try { muted = localStorage.getItem('snakeMuted') === '1'; } catch (e) {}

  function audio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
        musicBus = ac.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
      } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // One oscillator note with an optional pitch slide and vibrato.
  function tone({ f = 440, f2 = null, dur = 0.1, type = 'square', vol = 0.06, delay = 0, attack = 0.005, vib = 0, vibRate = 8, out = null }) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    if (vib) {
      const l = a.createOscillator(), lg = a.createGain();
      l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur);
    }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || master); o.start(t); o.stop(t + dur + 0.02);
  }

  // A burst of filtered noise, optionally sweeping the filter.
  let noiseBuf = null;
  function noise({ dur = 0.2, vol = 0.2, type = 'lowpass', freq = 1000, freq2 = null, q = 1, delay = 0, out = null }) {
    const a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = a.currentTime + delay, n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    n.buffer = noiseBuf; n.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(out || master); n.start(t); n.stop(t + dur + 0.02);
  }

  const notes = (list, step, opts) => list.forEach((f, i) => f && tone({ f, dur: step * 1.6, delay: i * step, ...opts }));

  const FX = {
    // UI and little things
    click: () => tone({ f: 1800, dur: 0.02, vol: 0.03 }),
    steer: () => tone({ f: 520, dur: 0.03, vol: 0.025 }),
    tick: () => tone({ f: 2400, dur: 0.015, type: 'square', vol: 0.02 }),
    clunk: () => { tone({ f: 70, dur: 0.08, vol: 0.06 }); noise({ dur: 0.05, vol: 0.06, freq: 400 }); },
    ding: () => { tone({ f: 1320, dur: 0.5, type: 'sine', vol: 0.08 }); tone({ f: 2640, dur: 0.3, type: 'sine', vol: 0.03 }); },
    dingBlue: () => { tone({ f: 660, dur: 0.6, type: 'sine', vol: 0.08 }); tone({ f: 990, dur: 0.6, type: 'sine', vol: 0.05, delay: 0.08 }); },
    chime: () => { tone({ f: 880, dur: 0.15, type: 'triangle', vol: 0.06 }); tone({ f: 1175, dur: 0.2, type: 'triangle', vol: 0.05, delay: 0.07 }); },
    coin: () => { tone({ f: 988, dur: 0.06, vol: 0.05 }); tone({ f: 1319, dur: 0.2, vol: 0.05, delay: 0.06 }); },
    score: () => tone({ f: 1500 + Math.random() * 300, dur: 0.04, type: 'triangle', vol: 0.025 }),
    sparkle: () => { for (let i = 0; i < 5; i++) tone({ f: 2000 + Math.random() * 2000, dur: 0.08, type: 'triangle', vol: 0.025, delay: i * 0.04 }); },
    start: () => notes([523, 659, 784, 1047], 0.07, { type: 'square', vol: 0.05 }),
    newBest: () => notes([784, 988, 1175, 1568, 0, 1568], 0.08, { type: 'square', vol: 0.05 }),

    // movement
    jump: () => tone({ f: 300, f2: 700, dur: 0.12, vol: 0.05 }),
    land: () => noise({ dur: 0.06, vol: 0.12, freq: 300 }),
    whoosh: () => noise({ dur: 0.3, vol: 0.18, type: 'bandpass', freq: 400, freq2: 2400, q: 1.5 }),
    swoosh: () => noise({ dur: 0.2, vol: 0.15, type: 'bandpass', freq: 2400, freq2: 500, q: 2 }),
    boing: () => tone({ f: 180, f2: 520, dur: 0.35, type: 'sine', vol: 0.1, vib: 30, vibRate: 18 }),
    turbo: () => { tone({ f: 200, f2: 900, dur: 0.35, type: 'sawtooth', vol: 0.05 }); noise({ dur: 0.35, vol: 0.08, type: 'bandpass', freq: 600, freq2: 3000 }); },
    slowmo: () => tone({ f: 500, f2: 120, dur: 0.6, type: 'sawtooth', vol: 0.05, vib: 20, vibRate: 6 }),
    roll: () => noise({ dur: 0.25, vol: 0.05, freq: 160, q: 4 }),

    // hits and impacts
    hit: () => { tone({ f: 160, f2: 60, dur: 0.35, type: 'sawtooth', vol: 0.09 }); noise({ dur: 0.2, vol: 0.15, freq: 900 }); },
    hurt: () => { tone({ f: 420, f2: 140, dur: 0.25, type: 'square', vol: 0.07 }); noise({ dur: 0.12, vol: 0.12, freq: 1500 }); },
    crunch: () => { noise({ dur: 0.15, vol: 0.25, freq: 2500 }); tone({ f: 90, f2: 40, dur: 0.2, type: 'sine', vol: 0.2 }); },
    thud: (v = 0.5) => { tone({ f: 150, f2: 28, dur: 0.45, type: 'sine', vol: 0.45 * v }); noise({ dur: 0.3, vol: 0.45 * v, freq: 1200 }); },
    boom: () => { tone({ f: 90, f2: 25, dur: 0.9, type: 'sine', vol: 0.4 }); noise({ dur: 0.9, vol: 0.45, freq: 1500, freq2: 120 }); },
    explosion: () => { tone({ f: 120, f2: 30, dur: 0.6, type: 'sine', vol: 0.3 }); noise({ dur: 0.6, vol: 0.35, freq: 2500, freq2: 200 }); },
    slam: () => { FX.thud(1); noise({ dur: 0.08, vol: 0.3, type: 'highpass', freq: 3000 }); },
    pop: () => { tone({ f: 600, f2: 1600, dur: 0.06, type: 'sine', vol: 0.12 }); noise({ dur: 0.05, vol: 0.1, type: 'highpass', freq: 2000 }); },
    bigPop: () => { tone({ f: 300, f2: 1400, dur: 0.12, type: 'sine', vol: 0.16 }); noise({ dur: 0.12, vol: 0.18, type: 'highpass', freq: 1500 }); },
    splat: () => { noise({ dur: 0.18, vol: 0.2, freq: 900, freq2: 200 }); tone({ f: 200, f2: 80, dur: 0.12, type: 'sine', vol: 0.08 }); },
    rocket: () => { noise({ dur: 0.5, vol: 0.18, type: 'bandpass', freq: 3000, freq2: 500, q: 0.8 }); tone({ f: 200, f2: 90, dur: 0.3, type: 'sawtooth', vol: 0.05 }); },
    whistle: () => tone({ f: 2200, f2: 700, dur: 0.9, type: 'sine', vol: 0.05 }),
    snip: () => { noise({ dur: 0.03, vol: 0.2, type: 'highpass', freq: 5000 }); noise({ dur: 0.03, vol: 0.2, type: 'highpass', freq: 6000, delay: 0.12 }); },
    glass: () => { noise({ dur: 0.25, vol: 0.15, type: 'highpass', freq: 4000 }); [3100, 4200, 5300].forEach((f, i) => tone({ f, dur: 0.3, type: 'sine', vol: 0.03, delay: i * 0.03 })); },

    // power-ups
    powerup: () => notes([523, 659, 784, 1047, 1319], 0.05, { type: 'square', vol: 0.045 }),
    powerdown: () => notes([784, 659, 523, 392, 262], 0.06, { type: 'square', vol: 0.045 }),
    shieldUp: () => { tone({ f: 300, f2: 1200, dur: 0.4, type: 'sine', vol: 0.08, vib: 40, vibRate: 25 }); FX.sparkle(); },
    shieldLow: () => tone({ f: 1000, dur: 0.05, type: 'sine', vol: 0.05 }),
    nom: () => { noise({ dur: 0.06, vol: 0.12, type: 'bandpass', freq: 1200, q: 2 }); tone({ f: 500, f2: 800, dur: 0.06, type: 'triangle', vol: 0.05, delay: 0.05 }); },
    slip: () => tone({ f: 1500, f2: 250, dur: 0.55, type: 'sine', vol: 0.09, vib: 25, vibRate: 12 }), // slide whistle
    grow: () => tone({ f: 150, f2: 90, dur: 0.25, type: 'sawtooth', vol: 0.07 }),

    // voices (gibberish blips) and characters
    blip: () => tone({ f: 180 + Math.random() * 120, dur: 0.05, type: 'square', vol: 0.03 }),
    talk: (n = 6) => { for (let i = 0; i < n; i++) tone({ f: 160 + Math.random() * 140, dur: 0.05, type: 'square', vol: 0.03, delay: i * 0.07 }); },
    laugh: () => [0, 0.16, 0.32].forEach((d, i) => tone({ f: 330 - i * 30, f2: 250 - i * 30, dur: 0.12, type: 'square', vol: 0.05, delay: d })),
    oof: () => tone({ f: 260, f2: 120, dur: 0.2, type: 'square', vol: 0.06, vib: 15, vibRate: 30 }),
    tweet: () => { for (let i = 0; i < 3; i++) tone({ f: 2400, f2: 3400, dur: 0.06, type: 'sine', vol: 0.03, delay: i * 0.12 }); },
    rumble: () => noise({ dur: 0.8, vol: 0.25, freq: 120, freq2: 60 }),
    heartbeat: () => { tone({ f: 70, f2: 45, dur: 0.12, type: 'sine', vol: 0.3 }); tone({ f: 70, f2: 45, dur: 0.12, type: 'sine', vol: 0.22, delay: 0.22 }); },
    alarm: () => [0, 0.15, 0.3].forEach(d => { tone({ f: 880, dur: 0.07, vol: 0.04, delay: d }); tone({ f: 660, dur: 0.07, vol: 0.04, delay: d + 0.07 }); }),

    // stings
    sting: () => { tone({ f: 110, dur: 0.8, type: 'sawtooth', vol: 0.06 }); tone({ f: 116.5, dur: 0.8, type: 'sawtooth', vol: 0.06 }); noise({ dur: 0.8, vol: 0.12, freq: 300 }); },
    fanfare: () => { notes([523, 659, 784, 1047], 0.1, { type: 'square', vol: 0.05 }); [523, 659, 784, 1047].forEach(f => tone({ f, dur: 0.9, type: 'triangle', vol: 0.04, delay: 0.42 })); },
    sadTrombone: () => [392, 370, 349].forEach((f, i) => tone({ f, dur: i === 2 ? 0.9 : 0.35, type: 'sawtooth', vol: 0.05, delay: i * 0.38, vib: i === 2 ? 8 : 0, vibRate: 6 })),
    buzzer: () => { tone({ f: 110, dur: 0.6, type: 'square', vol: 0.07 }); tone({ f: 117, dur: 0.6, type: 'square', vol: 0.07 }); },
    jingleDown: () => notes([500, 330, 196], 0.15, { type: 'triangle', vol: 0.05 }),
  };

  // ---- Music: a tiny step sequencer (16 steps per bar) ----
  const N = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number to Hz
  const SONGS = {
    // disco stage: four-on-the-floor, offbeat hats, octave bass over Am - F - C - G
    boss: { bpm: 118, bars: [[45, 57], [41, 53], [48, 60], [43, 55]], step(i, bar, t) {
      const s = i % 16;
      if (s % 4 === 0) kick(t);
      if (s % 4 === 2) hat(t, 0.05);
      if (s % 2 === 0) bass(t, N(this.bars[bar % 4][(s / 2) % 2]), 0.11);
      if (s === 4 || s === 12) clap(t);
    } },
    // maze: tense minor arpeggio, quick hats
    maze: { bpm: 140, arp: [40, 47, 52, 55, 52, 47, 43, 47], step(i, bar, t) {
      const s = i % 16;
      if (s % 8 === 0) kick(t);
      hat(t, s % 2 ? 0.02 : 0.035);
      if (s % 2 === 0) bass(t, N(this.arp[(s / 2) % 8] + (bar % 4 === 3 ? 2 : 0)), 0.1);
      if (s === 14 && bar % 2) tone({ f: N(79), dur: 0.08, type: 'square', vol: 0.015, out: musicBus });
    } },
  };
  function kick(t) { const d = t - ac.currentTime; tone({ f: 120, f2: 40, dur: 0.15, type: 'sine', vol: 0.35, delay: d, out: musicBus }); }
  function hat(t, v) { noise({ dur: 0.03, vol: v, type: 'highpass', freq: 7000, delay: t - ac.currentTime, out: musicBus }); }
  function clap(t) { noise({ dur: 0.08, vol: 0.08, type: 'bandpass', freq: 1500, q: 1, delay: t - ac.currentTime, out: musicBus }); }
  function bass(t, f, dur) { tone({ f, dur, type: 'square', vol: 0.05, delay: t - ac.currentTime, out: musicBus }); }

  let song = null, timer = null, nextT = 0, stepN = 0;
  function music(name) {
    clearInterval(timer); timer = null; song = SONGS[name] || null;
    if (!song || !audio()) return;
    nextT = ac.currentTime + 0.05; stepN = 0;
    timer = setInterval(() => { // schedule a little ahead so timing stays tight
      const stepDur = 60 / song.bpm / 4;
      while (nextT < ac.currentTime + 0.15) { song.step(stepN, Math.floor(stepN / 16), nextT); nextT += stepDur; stepN++; }
    }, 40);
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('snakeMuted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 0.8;
  }

  window.SFX = {
    play(name, ...args) { if (!muted && FX[name]) try { FX[name](...args); } catch (e) {} },
    beep(f, dur = 0.08, type = 'square', vol = 0.06) { if (!muted) tone({ f, dur, type, vol }); },
    thud(v = 0.5) { if (!muted) FX.thud(v); },
    music,
    toggleMute() { setMuted(!muted); return muted; },
    get muted() { return muted; },
    audio, // so the rickroll and others can share one AudioContext
  };
})();
