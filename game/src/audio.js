// All sound is synthesized with WebAudio: noise bursts, filtered clicks and
// tones. No audio files, no network. Created lazily on first user gesture.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, type, gain, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gain, slideTo, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); },
    // kind: 'pistol' | 'smg' | 'rifle' | 'dmr' | 'enemy' (distant, quieter)
    shot(kind, distant) {
      const g = distant ? 0.1 : 0.5;
      if (kind === 'dmr') { noise(0.22, 900, 'lowpass', g); tone(140, 0.12, 'square', g * 0.5, 55); }
      else if (kind === 'pistol') { noise(0.09, 2200, 'bandpass', g * 0.8); tone(220, 0.05, 'square', g * 0.3, 90); }
      else if (kind === 'smg') { noise(0.07, 1800, 'bandpass', g * 0.7); }
      else { noise(0.14, 1400, 'lowpass', g); tone(170, 0.08, 'square', g * 0.4, 70); }
    },
    dryFire() { tone(1200, 0.03, 'square', 0.12); },
    reload() {
      tone(900, 0.04, 'square', 0.14);
      tone(600, 0.04, 'square', 0.14, null, 0.25);
      tone(1100, 0.05, 'square', 0.18, null, 0.55);
    },
    hit(kill) {
      tone(kill ? 1400 : 1050, 0.06, 'sine', 0.25);
      if (kill) tone(1750, 0.09, 'sine', 0.22, null, 0.06);
    },
    hurt() { tone(180, 0.16, 'sawtooth', 0.25, 90); },
    plant() { tone(520, 0.1, 'square', 0.16); tone(520, 0.1, 'square', 0.16, null, 0.2); },
    planted() { tone(660, 0.3, 'square', 0.2, 440); tone(880, 0.4, 'sine', 0.2, null, 0.15); },
    beep() { tone(980, 0.07, 'square', 0.14); },
    defuseTick() { tone(1250, 0.04, 'square', 0.1); },
    explosion() {
      noise(0.7, 300, 'lowpass', 0.9);
      tone(70, 0.6, 'sine', 0.6, 30);
    },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.22, null, i * 0.12)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', 0.2, null, i * 0.13)); },
    buy() { tone(880, 0.06, 'sine', 0.18); tone(1320, 0.08, 'sine', 0.16, null, 0.07); },
    denied() { tone(220, 0.12, 'square', 0.18, 160); },
    step() { noise(0.05, 500, 'lowpass', 0.05); },
  };
}
