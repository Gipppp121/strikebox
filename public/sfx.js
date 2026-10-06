// Synthesized sound effects. Nothing is downloaded; everything is built with WebAudio on first use.
let AC = null, master = null, noiseBuf = null, muted = false;
export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = .55;
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp); comp.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
export function setMuted(v) { muted = v; if (master) master.gain.value = v ? 0 : .55; }
export function isMuted() { return muted; }
function out(vol, pan) { const g = AC.createGain(); g.gain.value = vol; if (pan !== undefined && AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); } else g.connect(master); return g; }
function noise(dst, t, dur, type, f, q, a0, decay) { const s = AC.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = .8 + Math.random() * .4; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const e = AC.createGain(); e.gain.setValueAtTime(a0, t); e.gain.exponentialRampToValueAtTime(.0001, t + decay); s.connect(fl); fl.connect(e); e.connect(dst); s.start(t, Math.random() * .5, dur); }
function tone(dst, t, type, f0, f1, dur, a0) { const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); const e = AC.createGain(); e.gain.setValueAtTime(a0, t); e.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(e); e.connect(dst); o.start(t); o.stop(t + dur + .02); }
const ok = () => AC && !muted;

export function shot(vol = 1, pan = 0, far = 0) { if (!ok()) return; const t = AC.currentTime, o = out(vol, pan);
  if (far > .5) { noise(o, t, .35, 'lowpass', 900, .7, .9, .32); tone(o, t, 'sine', 120, 50, .18, .6); return; }
  noise(o, t, .3, 'bandpass', 1800, .6, 1.2, .16); noise(o, t, .5, 'lowpass', 600, .8, 1, .3); tone(o, t, 'sine', 160, 45, .14, 1.1); }
export function hit(head) { if (!ok()) return; const t = AC.currentTime, o = out(head ? .5 : .35);
  if (head) { tone(o, t, 'sine', 1900, 1850, .25, .6); tone(o, t, 'sine', 2850, 2800, .2, .25); } else tone(o, t, 'square', 1250, 1200, .05, .25); }
export function hurt() { if (!ok()) return; const t = AC.currentTime, o = out(.7); tone(o, t, 'sine', 140, 60, .2, 1); noise(o, t, .15, 'lowpass', 500, .7, .6, .12); }
export function kill() { if (!ok()) return; const t = AC.currentTime, o = out(.35); [880, 1320].forEach((f, i) => tone(o, t + i * .07, 'triangle', f, f, .18, .5)); }
export function death() { if (!ok()) return; const t = AC.currentTime, o = out(.6); tone(o, t, 'sawtooth', 300, 40, .9, .35); noise(o, t, .6, 'lowpass', 400, .5, .5, .6); }
export function reload() { if (!ok()) return; const t = AC.currentTime, o = out(.45); [0, .55, 1.6].forEach((d, i) => noise(o, t + d, .06, 'bandpass', i === 2 ? 2600 : 1700, 4, .9, .05)); tone(o, t + 1.62, 'square', 420, 380, .04, .2); }
export function step(vol = .25) { if (!ok()) return; const t = AC.currentTime, o = out(vol); noise(o, t, .09, 'lowpass', 380 + Math.random() * 120, 1, .9, .08); }
export function land() { step(.45); }
export function spawn() { if (!ok()) return; const t = AC.currentTime, o = out(.25); [523, 659, 784].forEach((f, i) => tone(o, t + i * .06, 'triangle', f, f, .16, .4)); }
