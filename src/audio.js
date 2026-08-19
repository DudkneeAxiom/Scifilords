// All audio is synthesised at runtime with WebAudio. Nothing is sampled, so
// nothing is licensed from anyone, and the whole soundscape is a few hundred
// lines instead of a few megabytes.
//
// The target is dry, mechanical and a little cheap: hard transients, short
// tails, and a distant industrial bed that never resolves into music.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let ambientNodes = [];
let started = false;

export const settings = { master: 0.75, sfx: 1.0, music: 0.7, muted: false };

export function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.muted ? 0 : settings.master;
  master.connect(ctx.destination);

  // A gentle limiter keeps a firefight from clipping into mush.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  comp.connect(master);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = settings.sfx;
  sfxBus.connect(comp);

  musicBus = ctx.createGain();
  musicBus.gain.value = settings.music;
  musicBus.connect(comp);
  return ctx;
}

export function resume() {
  if (!ctx) init();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  started = true;
}

export function setMuted(m) {
  settings.muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : settings.master, ctx.currentTime, 0.05);
}

export function setVolume(v) {
  settings.master = v;
  if (master && !settings.muted) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

// --------------------------------------------------------------------------
// Primitives
// --------------------------------------------------------------------------

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
}

function env(node, t, { a = 0.001, d = 0.1, peak = 1, sustain = 0, s = 0, r = 0.05 }) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
  if (s > 0) {
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    g.setValueAtTime(Math.max(0.0001, sustain), t + a + d + s);
  }
  g.exponentialRampToValueAtTime(0.0001, t + a + d + s + r);
}

/** Positional attenuation. Distance is in metres; falloff is deliberately harsh. */
function panGain(pos) {
  if (!pos) return { gain: 1, pan: 0 };
  const d = Math.hypot(pos.x, pos.z);
  return { gain: Math.max(0.04, 1 / (1 + d * d * 0.0045)), pan: Math.max(-1, Math.min(1, pos.x / 22)) };
}

function out(pos) {
  const { gain, pan } = panGain(pos);
  const g = ctx.createGain();
  g.gain.value = gain;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p); p.connect(sfxBus);
  } else {
    g.connect(sfxBus);
  }
  return g;
}

// --------------------------------------------------------------------------
// Weapons
// --------------------------------------------------------------------------

const GUN_VOICE = {
  rifle: { body: 260, crackHz: 3200, dur: 0.16, peak: 0.9, thump: 78 },
  smg: { body: 340, crackHz: 4000, dur: 0.10, peak: 0.65, thump: 96 },
  shotgun: { body: 150, crackHz: 2200, dur: 0.30, peak: 1.15, thump: 52 },
  dmr: { body: 190, crackHz: 2700, dur: 0.34, peak: 1.2, thump: 60 },
  lmg: { body: 220, crackHz: 3000, dur: 0.18, peak: 1.0, thump: 66 },
  relic: { body: 520, crackHz: 5200, dur: 0.26, peak: 0.85, thump: 130 },
};

export function shot(kind = 'rifle', pos = null) {
  if (!ctx || settings.muted) return;
  const v = GUN_VOICE[kind] || GUN_VOICE.rifle;
  const t = ctx.currentTime;
  const dest = out(pos);

  // Crack: bright filtered noise burst — the part that reads as "rifle".
  const n = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(v.crackHz, t);
  bp.frequency.exponentialRampToValueAtTime(v.crackHz * 0.32, t + v.dur);
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  env(ng, t, { a: 0.0015, d: v.dur, peak: v.peak, r: v.dur * 0.5 });
  n.connect(bp); bp.connect(ng); ng.connect(dest);
  n.start(t); n.stop(t + v.dur * 2.2);

  // Body: a pitched thump so the weapon has weight and a distinct calibre.
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(v.body, t);
  o.frequency.exponentialRampToValueAtTime(v.thump, t + v.dur * 0.8);
  const og = ctx.createGain();
  env(og, t, { a: 0.001, d: v.dur * 0.7, peak: v.peak * 0.55, r: v.dur * 0.6 });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 900;
  o.connect(lp); lp.connect(og); og.connect(dest);
  o.start(t); o.stop(t + v.dur * 2);

  if (kind === 'relic') {
    // The prototype should not sound like chemistry. A short descending tone.
    const w = ctx.createOscillator();
    w.type = 'sawtooth';
    w.frequency.setValueAtTime(1800, t);
    w.frequency.exponentialRampToValueAtTime(220, t + 0.22);
    const wg = ctx.createGain();
    env(wg, t, { a: 0.002, d: 0.2, peak: 0.35, r: 0.1 });
    w.connect(wg); wg.connect(dest);
    w.start(t); w.stop(t + 0.4);
  }

  // Tail: the basin is flat and hard, so everything slaps back once.
  const tn = noise();
  const tf = ctx.createBiquadFilter();
  tf.type = 'lowpass'; tf.frequency.value = 1100;
  const tg = ctx.createGain();
  tg.gain.setValueAtTime(0.0001, t + 0.045);
  tg.gain.exponentialRampToValueAtTime(v.peak * 0.13, t + 0.07);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
  tn.connect(tf); tf.connect(tg); tg.connect(dest);
  tn.start(t); tn.stop(t + 0.6);
}

// --------------------------------------------------------------------------
// Steel
//
// A melee battle is not a quieter firefight — it is a different noise
// entirely: air, then a bang, then the long ring of something metal that
// did not want to be hit. Built from the same three primitives as the gun
// voices (noise, a pitched body, a tail), because the era changed and the
// synthesiser did not.
// --------------------------------------------------------------------------

/** The swing itself: air moving, no contact. Cheap, and it sells weight. */
export function whoosh(heft = 1, pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const dur = 0.16 + heft * 0.10;
  const n = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  // The sweep down is the blade passing: quick for a sword, lumbering for a maul.
  bp.frequency.setValueAtTime(1500 / heft, t);
  bp.frequency.exponentialRampToValueAtTime(320 / heft, t + dur);
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  env(g, t, { a: dur * 0.45, d: dur * 0.5, peak: 0.16 + heft * 0.05, r: 0.06 });
  n.connect(bp); bp.connect(g); g.connect(dest);
  n.start(t); n.stop(t + dur * 2);
}

/**
 * Steel arriving. `kind` is what it arrived ON, which is the whole point: a
 * blade into a shield is a bang and a long ring, into armour a duller
 * clash, into a body a wet thud with no ring at all.
 */
export function clash(kind = 'armour', heft = 1, pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const V = {
    shield: { hz: 1900, q: 2.2, ring: 380, rdur: 0.55, peak: 0.85, lp: 3400 },
    armour: { hz: 2600, q: 3.4, ring: 720, rdur: 0.30, peak: 0.70, lp: 4200 },
    parry: { hz: 3300, q: 5.0, ring: 1250, rdur: 0.42, peak: 0.60, lp: 6000 },
    flesh: { hz: 420, q: 0.8, ring: 0, rdur: 0, peak: 0.55, lp: 900 },
  };
  const v = V[kind] || V.armour;

  // The strike: a short filtered crack, pitched by what it hit.
  const n = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(v.hz * (0.9 + Math.random() * 0.25), t);
  bp.Q.value = v.q;
  const ng = ctx.createGain();
  env(ng, t, { a: 0.0008, d: 0.05 + heft * 0.03, peak: v.peak * (0.8 + heft * 0.3), r: 0.05 });
  n.connect(bp); bp.connect(ng); ng.connect(dest);
  n.start(t); n.stop(t + 0.3);

  // The body of the blow: low, brief, heavier for heavier weapons.
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(300 / heft, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
  const og = ctx.createGain();
  env(og, t, { a: 0.001, d: 0.09, peak: 0.35 * heft, r: 0.08 });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = v.lp;
  o.connect(lp); lp.connect(og); og.connect(dest);
  o.start(t); o.stop(t + 0.3);

  // The ring: plate and blades sing afterwards. Flesh does not.
  if (v.ring) {
    for (let i = 0; i < 2; i++) {
      const r = ctx.createOscillator();
      r.type = 'triangle';
      r.frequency.value = v.ring * (i ? 1.51 : 1) * (0.95 + Math.random() * 0.12);
      const rg = ctx.createGain();
      env(rg, t + 0.005, { a: 0.004, d: v.rdur, peak: 0.13 / (i + 1), r: v.rdur * 0.6 });
      r.connect(rg); rg.connect(dest);
      r.start(t); r.stop(t + v.rdur * 2);
    }
  }
}

/** A bow: the string, then the shaft going away. */
export function bowshot(pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  const g = ctx.createGain();
  env(g, t, { a: 0.001, d: 0.07, peak: 0.35, r: 0.05 });
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + 0.2);
  const n = noise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(1100, t + 0.18);
  bp.Q.value = 1.1;
  const ng = ctx.createGain();
  env(ng, t, { a: 0.002, d: 0.16, peak: 0.22, r: 0.08 });
  n.connect(bp); bp.connect(ng); ng.connect(dest);
  n.start(t); n.stop(t + 0.4);
}

/** An arrow finding something. Short, and it does not ring. */
export function arrowHit(kind = 'flesh', pos = null) {
  if (!ctx || settings.muted) return;
  if (kind === 'shield') { clash('shield', 0.5, pos); return; }
  const t = ctx.currentTime;
  const dest = out(pos);
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = kind === 'flesh' ? 800 : 2200;
  const g = ctx.createGain();
  env(g, t, { a: 0.001, d: 0.05, peak: 0.4, r: 0.04 });
  n.connect(f); f.connect(g); g.connect(dest);
  n.start(t); n.stop(t + 0.2);
}

/**
 * Voices. Not words — a battle line does not enunciate. A shout on the
 * charge, a grunt taking a hit, and the ugly noise a line makes when it
 * decides to be somewhere else. One formant band is the whole trick: it
 * turns a sawtooth into a throat.
 */
export function cry(kind = 'charge', pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const V = {
    charge: { f0: 190, f1: 260, dur: 0.50, peak: 0.30, form: 900 },
    hurt: { f0: 240, f1: 130, dur: 0.26, peak: 0.26, form: 700 },
    rout: { f0: 300, f1: 420, dur: 0.42, peak: 0.24, form: 1300 },
  };
  const v = V[kind] || V.charge;
  const jitter = 0.85 + Math.random() * 0.3;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(v.f0 * jitter, t);
  o.frequency.linearRampToValueAtTime(v.f1 * jitter, t + v.dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = v.form * jitter;
  bp.Q.value = 2.2;
  const g = ctx.createGain();
  env(g, t, { a: 0.02, d: v.dur * 0.7, peak: v.peak, r: v.dur * 0.5 });
  o.connect(bp); bp.connect(g); g.connect(dest);
  o.start(t); o.stop(t + v.dur * 1.8);
}

export function impact(kind = 'dirt', pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const n = noise();
  const f = ctx.createBiquadFilter();
  if (kind === 'metal') { f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 3; }
  else if (kind === 'flesh') { f.type = 'lowpass'; f.frequency.value = 700; }
  else { f.type = 'lowpass'; f.frequency.value = 1500; }
  const g = ctx.createGain();
  env(g, t, { a: 0.001, d: kind === 'metal' ? 0.13 : 0.06, peak: kind === 'flesh' ? 0.5 : 0.35, r: 0.05 });
  n.connect(f); f.connect(g); g.connect(dest);
  n.start(t); n.stop(t + 0.3);
  if (kind === 'metal') {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1400 + Math.random() * 800, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    const og = ctx.createGain();
    env(og, t, { a: 0.001, d: 0.18, peak: 0.12, r: 0.1 });
    o.connect(og); og.connect(dest);
    o.start(t); o.stop(t + 0.35);
  }
}

export function reload(stage = 'out', pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const seq = stage === 'out' ? [[0, 1900, 0.22], [0.09, 1200, 0.16]]
    : [[0, 900, 0.26], [0.12, 2400, 0.3]];
  for (const [dt, hz, pk] of seq) {
    const n = noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = hz; f.Q.value = 5;
    const g = ctx.createGain();
    env(g, t + dt, { a: 0.001, d: 0.045, peak: pk, r: 0.03 });
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(t + dt); n.stop(t + dt + 0.15);
  }
}

export function dryFire(pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 9;
  const g = ctx.createGain();
  env(g, t, { a: 0.0005, d: 0.03, peak: 0.2, r: 0.02 });
  n.connect(f); f.connect(g); g.connect(dest);
  n.start(t); n.stop(t + 0.1);
}

export function explosion(pos = null) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const dest = out(pos);
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(120, t + 1.1);
  const g = ctx.createGain();
  env(g, t, { a: 0.004, d: 0.7, peak: 1.4, r: 0.9 });
  n.connect(f); f.connect(g); g.connect(dest);
  n.start(t); n.stop(t + 2.2);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
  const og = ctx.createGain();
  env(og, t, { a: 0.005, d: 0.8, peak: 0.9, r: 0.5 });
  o.connect(og); og.connect(dest);
  o.start(t); o.stop(t + 1.8);
}

// --------------------------------------------------------------------------
// Interface — dry, low, mechanical. No pleasant chimes anywhere.
// --------------------------------------------------------------------------

function blip(hz, dur, peak, type = 'square', delay = 0) {
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = hz;
  const g = ctx.createGain();
  env(g, t, { a: 0.002, d: dur, peak, r: 0.02 });
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 2400;
  o.connect(f); f.connect(g); g.connect(sfxBus);
  o.start(t); o.stop(t + dur + 0.1);
}

export const uiMove = () => blip(420, 0.03, 0.10);
export const uiSelect = () => { blip(560, 0.04, 0.16); blip(760, 0.05, 0.12, 'square', 0.05); };
export const uiBack = () => { blip(420, 0.05, 0.14); blip(280, 0.06, 0.11, 'square', 0.05); };
export const uiDeny = () => { blip(180, 0.13, 0.18, 'sawtooth'); };
export const uiAlert = () => { blip(880, 0.07, 0.16); blip(880, 0.07, 0.16, 'square', 0.14); };

export function order() {
  // Squad command: a radio key-up, not a beep.
  if (!ctx || settings.muted) return;
  const t = ctx.currentTime;
  const n = noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 2;
  const g = ctx.createGain();
  env(g, t, { a: 0.004, d: 0.05, peak: 0.16, s: 0.04, sustain: 0.05, r: 0.05 });
  n.connect(f); f.connect(g); g.connect(sfxBus);
  n.start(t); n.stop(t + 0.25);
  blip(1200, 0.03, 0.09, 'square', 0.0);
}

export function deployTone() {
  if (!ctx || settings.muted) return;
  [220, 293, 220, 165].forEach((hz, i) => blip(hz, 0.28, 0.2, 'sawtooth', i * 0.22));
}

export function extractTone() {
  if (!ctx || settings.muted) return;
  [165, 220, 330].forEach((hz, i) => blip(hz, 0.34, 0.2, 'sawtooth', i * 0.26));
}

export function casualtyTone() {
  if (!ctx || settings.muted) return;
  blip(140, 0.5, 0.24, 'sawtooth');
  blip(96, 0.7, 0.2, 'sine', 0.16);
}

// --------------------------------------------------------------------------
// Ambience / music bed
// --------------------------------------------------------------------------

export function stopAmbience() {
  for (const n of ambientNodes) {
    try { n.stop ? n.stop() : n.disconnect(); } catch { /* already stopped */ }
  }
  ambientNodes = [];
}

/**
 * `mode` is 'world' (open basin wind, distant plant) or 'mission' (closer,
 * tighter, with an electrical hum). Music is a drifting drone rather than a
 * theme — it should never announce itself.
 */
export function ambience(mode = 'world') {
  if (!ctx || settings.muted) return;
  stopAmbience();

  // Wind: filtered noise with a slowly moving cutoff.
  const w = noise();
  const wf = ctx.createBiquadFilter();
  wf.type = 'bandpass';
  wf.frequency.value = mode === 'world' ? 420 : 300;
  wf.Q.value = 0.6;
  const wg = ctx.createGain();
  wg.gain.value = mode === 'world' ? 0.055 : 0.035;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 220;
  lfo.connect(lfoG); lfoG.connect(wf.frequency);
  w.connect(wf); wf.connect(wg); wg.connect(musicBus);
  w.start(); lfo.start();
  ambientNodes.push(w, lfo);

  // Distant plant hum: two detuned low oscillators. Industrial, not musical.
  for (const [hz, gain] of [[54, 0.030], [81.5, 0.016]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = mode === 'world' ? 180 : 260;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(f); f.connect(g); g.connect(musicBus);
    o.start();
    ambientNodes.push(o);
  }

  if (mode === 'mission') {
    // Electrical whine — sells "this place still has power it should not have".
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 1490;
    const g = ctx.createGain();
    g.gain.value = 0.008;
    const t = ctx.createOscillator();
    t.frequency.value = 0.13;
    const tg = ctx.createGain();
    tg.gain.value = 0.005;
    t.connect(tg); tg.connect(g.gain);
    o.connect(g); g.connect(musicBus);
    o.start(); t.start();
    ambientNodes.push(o, t);
  } else {
    // Occasional far-off metallic knock. Irregular on purpose.
    const tick = () => {
      if (!ambientNodes.length) return;
      impact('metal', { x: (Math.random() - 0.5) * 40, z: 30 + Math.random() * 30 });
      const h = setTimeout(tick, 6000 + Math.random() * 14000);
      ambientNodes.push({ stop: () => clearTimeout(h) });
    };
    const h = setTimeout(tick, 4000 + Math.random() * 6000);
    ambientNodes.push({ stop: () => clearTimeout(h) });
  }
}

export const isStarted = () => started;
