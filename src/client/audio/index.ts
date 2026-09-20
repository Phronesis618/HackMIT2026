/**
 * Audio port — Agent C. The controller maps GameEvents to cue ids and calls `play`.
 *
 * Everything is procedural Web Audio; there are no samples. Cohesion comes from one
 * shared "world voice" (root note, scale, timbre) that every tonal cue draws from and one
 * shared space (soft compression + a short filtered feedback delay). Character comes from
 * the world itself: the voice is derived from the generated ArtRecipe, so a crystal
 * observatory rings, a cable-strung spire crackles and a root archive thuds. Cues are
 * documented in design/audio/cues.json.
 */
import type { ArtRecipe, GameEvent } from '../../shared/contracts';

export const AUDIO_CUE_IDS = [
  'ui_confirm', 'portal_open', 'room_enter', 'room_clear', 'dash', 'attack', 'ability', 'enemy_shot',
  'hit', 'player_hit', 'player_down', 'revive', 'enemy_down', 'lore', 'anchor', 'memory_saved',
] as const;
export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];

export type AudioScene = 'headquarters' | 'training' | 'expedition' | 'debrief';

export interface AudioPort {
  play(cue: AudioCueId): void;
  /** The generated world's look decides the sound's voice; null returns to the sanctuary voice. */
  setWorld?(art: ArtRecipe | null): void;
  /** Drives the ambient bed (sanctuary hum, expedition drone, silence at debrief). */
  setScene?(scene: AudioScene): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose?(): void;
}

type Timbre = 'glass' | 'electric' | 'deep';

/** Everything a cue needs to sound like it belongs to this world. */
export interface WorldVoice {
  /** Root frequency in Hz (a low note; cues pick octaves above it). */
  root: number;
  /** Scale degrees in semitones above the root. */
  scale: number[];
  timbre: Timbre;
  /** 0..1, from palette luminance; brighter worlds get more highs and shorter tails. */
  brightness: number;
}

const ROOTS = [55, 58.27, 61.74, 65.41, 69.3, 73.42, 77.78, 82.41, 87.31, 92.5, 98, 103.83]; // A1 .. G#2
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const SANCTUARY_VOICE: WorldVoice = { root: 65.41, scale: DORIAN, timbre: 'glass', brightness: 0.55 };

/** Deterministic: the same generated world always sounds the same. */
export function voiceForWorld(art: ArtRecipe): WorldVoice {
  const accent = parseHex(art.palette.accent);
  const floor = parseHex(art.palette.floor);
  const hue = hueOf(accent);
  const root = ROOTS[Math.floor((hue / 360) * ROOTS.length) % ROOTS.length]!;
  const brightness = clamp(0.35 + luminance(accent) * 0.5 - luminance(floor) * 0.2, 0.15, 0.95);
  // The dominant motif decides the timbre; the skyline motif counts double.
  const votes: Record<Timbre, number> = { glass: 0, electric: 0, deep: 0 };
  for (const [motif, weight] of [[art.skyline, 2], ...art.motifIds.map((m) => [m, 1] as const)] as const) {
    const family: Timbre = motif === 'crystals' || motif === 'lanterns' ? 'glass'
      : motif === 'cables' || motif === 'ruined_machinery' ? 'electric' : 'deep';
    votes[family] += weight;
  }
  const timbre = (Object.keys(votes) as Timbre[]).reduce((best, t) => (votes[t] > votes[best] ? t : best), 'deep');
  const scale = brightness > 0.55 ? DORIAN : MINOR_PENTATONIC;
  return { root, scale, timbre, brightness };
}

export function createBrowserAudio(): AudioPort {
  if (typeof AudioContext === 'undefined') return createSilentAudio();
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let space: DelayNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let muted = false;
  let disposed = false;
  let voices = 0;
  let voice: WorldVoice = SANCTUARY_VOICE;
  let scene: AudioScene = 'headquarters';
  let bed: { gain: GainNode; stop: () => void; key: string } | null = null;
  const lastPlayed = new Map<AudioCueId, number>();
  try {
    muted = localStorage.getItem('relay.audio.muted') === 'true';
  } catch {
    /* Storage is optional. */
  }

  const ensureGraph = (): AudioContext | null => {
    if (!context || !master || !space) return null;
    return context;
  };

  const unlock = (): void => {
    if (disposed) return;
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : 1;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      master.connect(compressor).connect(context.destination);
      // One shared room: a short, dark feedback delay every cue can send into.
      space = context.createDelay(0.5);
      space.delayTime.value = 0.17;
      const feedback = context.createGain();
      feedback.gain.value = 0.28;
      const damp = context.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 1800;
      space.connect(damp).connect(feedback).connect(space);
      const wet = context.createGain();
      wet.gain.value = 0.35;
      damp.connect(wet).connect(master);
    }
    void context.resume().then(refreshBed).catch(() => {});
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // ---- building blocks ---------------------------------------------------------------

  const noise = (ctx: AudioContext): AudioBufferSourceNode => {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    return source;
  };

  /** A note in the world voice: scale degree (any integer; wraps octaves) at an octave offset. */
  const note = (degree: number, octave: number): number => {
    const steps = voice.scale.length;
    const wrap = Math.floor(degree / steps);
    const semis = voice.scale[((degree % steps) + steps) % steps]! + (octave + wrap) * 12;
    return voice.root * 2 ** (semis / 12);
  };

  interface Layer {
    kind: 'osc' | 'noise';
    type?: OscillatorType;
    /** Hz for osc; centre frequency for the noise filter. */
    freq: number;
    /** Pitch/filter glide target by the end of the layer. */
    to?: number;
    filter?: { type: BiquadFilterType; q?: number };
    gain: number;
    attack?: number;
    decay: number;
    delay?: number;
    detune?: number;
    send?: number;
  }

  const play = (layers: Layer[]): void => {
    const ctx = ensureGraph();
    if (!ctx || !master || !space || voices >= 48) return;
    const now = ctx.currentTime;
    for (const layer of layers) {
      const start = now + (layer.delay ?? 0);
      const end = start + (layer.attack ?? 0.004) + layer.decay;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(layer.gain, start + (layer.attack ?? 0.004));
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      let source: AudioScheduledSourceNode;
      let head: AudioNode;
      if (layer.kind === 'osc') {
        const osc = ctx.createOscillator();
        osc.type = layer.type ?? 'sine';
        osc.frequency.setValueAtTime(layer.freq, start);
        if (layer.to) osc.frequency.exponentialRampToValueAtTime(layer.to, end);
        if (layer.detune) osc.detune.value = layer.detune;
        source = osc;
        head = osc;
      } else {
        const n = noise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = layer.filter?.type ?? 'bandpass';
        filter.Q.value = layer.filter?.q ?? 1;
        filter.frequency.setValueAtTime(layer.freq, start);
        if (layer.to) filter.frequency.exponentialRampToValueAtTime(layer.to, end);
        n.connect(filter);
        source = n;
        head = filter;
      }
      if (layer.kind === 'osc' && layer.filter) {
        const filter = ctx.createBiquadFilter();
        filter.type = layer.filter.type;
        filter.Q.value = layer.filter.q ?? 1;
        filter.frequency.value = Math.min(18000, layer.freq * 4 + 400 + voice.brightness * 2400);
        head.connect(filter);
        head = filter;
      }
      head.connect(amp).connect(master);
      if (layer.send) {
        const send = ctx.createGain();
        send.gain.value = layer.send;
        amp.connect(send).connect(space);
      }
      voices++;
      source.onended = () => {
        voices--;
        amp.disconnect();
      };
      source.start(start);
      source.stop(end + 0.02);
    }
  };

  /** Timbre-specific colouring shared by every tonal cue. */
  const toneType = (): OscillatorType => (voice.timbre === 'glass' ? 'sine' : voice.timbre === 'electric' ? 'square' : 'triangle');
  const tail = (base: number): number => base * (1.25 - voice.brightness * 0.5);
  const noiseColour = (): { type: BiquadFilterType; freq: number; q: number } =>
    voice.timbre === 'glass' ? { type: 'highpass', freq: 3200, q: 0.7 }
      : voice.timbre === 'electric' ? { type: 'bandpass', freq: 1400, q: 2.5 }
        : { type: 'lowpass', freq: 900, q: 0.8 };

  const bell = (degree: number, octave: number, gain: number, decay: number, delay = 0): Layer[] => {
    const f = note(degree, octave);
    return voice.timbre === 'glass'
      ? [
        { kind: 'osc', type: 'sine', freq: f, gain, decay, delay, send: 0.5 },
        { kind: 'osc', type: 'sine', freq: f * 2.76, gain: gain * 0.22, decay: decay * 0.45, delay, send: 0.3 },
        { kind: 'osc', type: 'sine', freq: f * 5.4, gain: gain * 0.08, decay: decay * 0.25, delay },
      ]
      : voice.timbre === 'electric'
        ? [
          { kind: 'osc', type: 'square', freq: f, gain: gain * 0.5, decay, delay, filter: { type: 'lowpass', q: 4 }, send: 0.4 },
          { kind: 'osc', type: 'sawtooth', freq: f, detune: 9, gain: gain * 0.3, decay: decay * 0.8, delay, filter: { type: 'lowpass', q: 2 } },
        ]
        : [
          { kind: 'osc', type: 'triangle', freq: f, gain, decay: decay * 1.2, delay, send: 0.45 },
          { kind: 'osc', type: 'sine', freq: f / 2, gain: gain * 0.5, decay: decay * 1.4, delay },
        ];
  };

  // ---- cues ----------------------------------------------------------------------------

  const cues: Record<AudioCueId, () => void> = {
    // Melee swing: a swept air whoosh over a low thump; harder-edged in electric worlds.
    attack: () => {
      const c = noiseColour();
      play([
        { kind: 'noise', filter: { type: 'bandpass', q: 1.4 }, freq: 2600, to: 420, gain: 0.16, attack: 0.006, decay: 0.11 },
        { kind: 'osc', type: 'sine', freq: 130, to: 62, gain: 0.12, decay: 0.09 },
        { kind: 'noise', filter: { type: c.type, q: c.q }, freq: c.freq, gain: 0.05, decay: 0.05, delay: 0.01 },
      ]);
    },
    // Enemy release: a short zap that sits in the world scale so bullet hell never turns to mush.
    enemy_shot: () => {
      play([
        { kind: 'osc', type: toneType(), freq: note(4, 3), to: note(0, 2), gain: 0.05, decay: 0.09, filter: { type: 'lowpass', q: 3 } },
        { kind: 'noise', filter: { type: 'highpass', q: 0.8 }, freq: 2800, gain: 0.04, decay: 0.04 },
      ]);
    },
    // Enemy takes damage: dry, close, mostly transient.
    hit: () => {
      const c = noiseColour();
      play([
        { kind: 'noise', filter: { type: c.type, q: c.q }, freq: c.freq * 1.4, to: c.freq * 0.5, gain: 0.14, decay: 0.05 },
        { kind: 'osc', type: 'sine', freq: 160, to: 70, gain: 0.1, decay: 0.07 },
      ]);
    },
    // You take damage: the same body plus a dissonant chirp and a longer, darker sub so it stings.
    player_hit: () => {
      play([
        { kind: 'osc', type: 'sine', freq: 95, to: 38, gain: 0.26, decay: 0.22 },
        { kind: 'osc', type: 'square', freq: note(1, 4) * 1.06, to: note(1, 3), gain: 0.05, decay: 0.12, filter: { type: 'lowpass', q: 6 } },
        { kind: 'noise', filter: { type: 'lowpass', q: 0.7 }, freq: 700, gain: 0.12, decay: 0.09 },
      ]);
    },
    // Downed: a slow, hollow fall.
    player_down: () => {
      play([
        { kind: 'osc', type: 'triangle', freq: note(0, 3), to: note(0, 1), gain: 0.18, attack: 0.02, decay: 0.9, send: 0.6 },
        { kind: 'osc', type: 'sine', freq: 60, to: 28, gain: 0.22, decay: 0.7 },
        { kind: 'noise', filter: { type: 'lowpass', q: 0.5 }, freq: 400, to: 80, gain: 0.08, decay: 0.6 },
      ]);
    },
    // Enemy dies: a pitched crumble that resolves downward into the world root.
    enemy_down: () => {
      const c = noiseColour();
      play([
        { kind: 'noise', filter: { type: c.type, q: c.q }, freq: c.freq * 2, to: c.freq * 0.3, gain: 0.16, decay: tail(0.26), send: 0.4 },
        { kind: 'osc', type: toneType(), freq: note(4, 2), to: note(0, 1), gain: 0.1, decay: 0.24, filter: { type: 'lowpass', q: 2 } },
        ...bell(0, 1, 0.07, 0.3, 0.05),
      ]);
    },
    // Dash: a rising air tear with a tiny tonal tick in the scale.
    dash: () => {
      play([
        { kind: 'noise', filter: { type: 'bandpass', q: 1.2 }, freq: 500, to: 3600, gain: 0.12, attack: 0.008, decay: 0.13 },
        { kind: 'osc', type: 'sine', freq: note(2, 4), to: note(4, 4), gain: 0.04, decay: 0.08 },
      ]);
    },
    // Ability: a two-note flourish in the world voice with a shimmer send.
    ability: () => {
      play([
        ...bell(0, 3, 0.11, tail(0.28)),
        ...bell(4, 3, 0.09, tail(0.36), 0.07),
        { kind: 'noise', filter: { type: 'highpass', q: 0.7 }, freq: 4000, gain: 0.04, decay: 0.16 },
      ]);
    },
    ui_confirm: () => play([...bell(0, 4, 0.07, 0.14), ...bell(2, 4, 0.06, 0.18, 0.06)]),
    // Portal: a slow swell up the scale, blooming into the shared space.
    portal_open: () => {
      play([
        { kind: 'osc', type: 'sawtooth', freq: note(0, 1), to: note(0, 2), gain: 0.07, attack: 0.3, decay: 0.9, filter: { type: 'lowpass', q: 5 }, send: 0.6 },
        ...bell(0, 2, 0.08, 0.7, 0.1),
        ...bell(2, 2, 0.08, 0.7, 0.28),
        ...bell(4, 2, 0.09, 0.9, 0.46),
        ...bell(0, 3, 0.1, 1.2, 0.64),
        { kind: 'noise', filter: { type: 'highpass', q: 0.5 }, freq: 2500, to: 9000, gain: 0.05, attack: 0.4, decay: 0.8 },
      ]);
    },
    // Arriving in a room: one deep note and its fifth, like a door shutting behind you.
    room_enter: () => {
      play([
        { kind: 'osc', type: 'sine', freq: 48, gain: 0.2, attack: 0.01, decay: 0.5 },
        ...bell(0, 1, 0.1, tail(0.8)),
        ...bell(4, 2, 0.06, tail(0.6), 0.12),
        { kind: 'noise', filter: { type: 'lowpass', q: 0.6 }, freq: 600, to: 120, gain: 0.08, decay: 0.35 },
      ]);
    },
    // Room cleared: a resolved rising triad; the exits are glowing.
    room_clear: () => {
      play([
        ...bell(0, 3, 0.09, 0.5),
        ...bell(2, 3, 0.09, 0.55, 0.11),
        ...bell(4, 3, 0.1, 0.7, 0.22),
        ...bell(0, 4, 0.08, 1.0, 0.36),
      ]);
    },
    revive: () => play([...bell(4, 2, 0.1, 0.5), ...bell(0, 3, 0.11, 0.7, 0.14), { kind: 'noise', filter: { type: 'highpass', q: 0.6 }, freq: 3000, gain: 0.04, attack: 0.1, decay: 0.4 }]),
    // Lore: a slow, reverent bell pattern — the only cue that takes its time.
    lore: () => {
      play([
        ...bell(0, 2, 0.1, 1.4),
        ...bell(4, 2, 0.08, 1.3, 0.22),
        ...bell(2, 3, 0.07, 1.2, 0.48),
        ...bell(0, 3, 0.06, 1.6, 0.8),
        { kind: 'noise', filter: { type: 'highpass', q: 0.5 }, freq: 5000, gain: 0.025, attack: 0.5, decay: 1.2 },
      ]);
    },
    // Anchor planted: the biggest moment in a run — swell, chord, long tail.
    anchor: () => {
      play([
        { kind: 'osc', type: 'sawtooth', freq: note(0, 0), to: note(0, 1), gain: 0.1, attack: 0.6, decay: 1.8, filter: { type: 'lowpass', q: 3 }, send: 0.7 },
        { kind: 'osc', type: 'sine', freq: 40, gain: 0.22, attack: 0.3, decay: 2.2 },
        ...bell(0, 2, 0.12, 2.0, 0.5),
        ...bell(4, 2, 0.1, 2.0, 0.62),
        ...bell(2, 3, 0.09, 2.2, 0.76),
        ...bell(0, 4, 0.08, 2.6, 0.95),
        { kind: 'noise', filter: { type: 'highpass', q: 0.4 }, freq: 1500, to: 8000, gain: 0.06, attack: 0.9, decay: 1.6 },
      ]);
    },
    memory_saved: () => play([...bell(0, 4, 0.05, 0.3), ...bell(4, 4, 0.05, 0.4, 0.1)]),
  };

  // ---- ambient bed -----------------------------------------------------------------------

  const refreshBed = (): void => {
    const ctx = ensureGraph();
    if (!ctx || !master || ctx.state !== 'running') return;
    const key = scene === 'debrief' ? 'off' : `${scene}:${voice.root}:${voice.timbre}:${voice.brightness.toFixed(2)}`;
    if (bed?.key === key) return;
    if (bed) {
      const old = bed;
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
      setTimeout(old.stop, 2500);
      bed = null;
    }
    if (key === 'off') return;
    const calm = scene === 'headquarters' || scene === 'training';
    const level = calm ? 0.035 : 0.05;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.setTargetAtTime(level, ctx.currentTime, 1.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260 + voice.brightness * 420;
    filter.Q.value = 1.2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = calm ? 0.05 : 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 90 + voice.brightness * 120;
    lfo.connect(lfoDepth).connect(filter.frequency);
    const sources: AudioScheduledSourceNode[] = [lfo];
    const drone = (freq: number, type: OscillatorType, detune: number, level: number): void => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(filter);
      sources.push(osc);
    };
    const type: OscillatorType = voice.timbre === 'electric' ? 'sawtooth' : voice.timbre === 'deep' ? 'triangle' : 'sine';
    drone(note(0, 0), type, -6, 1);
    drone(note(0, 0), type, 7, 0.8);
    drone(note(4, 0), type, 0, calm ? 0.45 : 0.6);
    if (calm) drone(note(2, 1), 'sine', 3, 0.35);
    if (voice.timbre === 'electric') {
      const hiss = noise(ctx);
      const hissFilter = ctx.createBiquadFilter();
      hissFilter.type = 'bandpass';
      hissFilter.frequency.value = 3200;
      hissFilter.Q.value = 3;
      const hissGain = ctx.createGain();
      hissGain.gain.value = 0.12;
      hiss.connect(hissFilter).connect(hissGain).connect(filter);
      sources.push(hiss);
    }
    filter.connect(gain).connect(master);
    for (const s of sources) s.start();
    bed = {
      gain, key,
      stop: () => {
        for (const s of sources) {
          try { s.stop(); } catch { /* already stopped */ }
        }
        gain.disconnect();
      },
    };
  };

  return {
    play(cue) {
      const ctx = ensureGraph();
      if (disposed || muted || !ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (now - (lastPlayed.get(cue) ?? -1) < 0.06) return;
      lastPlayed.set(cue, now);
      cues[cue]();
    },
    setWorld(art) {
      voice = art ? voiceForWorld(art) : SANCTUARY_VOICE;
      refreshBed();
    },
    setScene(next) {
      scene = next;
      refreshBed();
    },
    setMuted(value) {
      muted = value;
      const ctx = ensureGraph();
      if (ctx && master) master.gain.setTargetAtTime(value ? 0 : 1, ctx.currentTime, 0.05);
      try {
        localStorage.setItem('relay.audio.muted', String(value));
      } catch {
        /* Storage is optional. */
      }
    },
    isMuted: () => muted,
    dispose() {
      disposed = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      bed?.stop();
      bed = null;
      void context?.close().catch(() => {});
    },
  };
}

export function createSilentAudio(): AudioPort {
  let muted = false;
  return {
    play: () => {},
    setMuted: (m) => {
      muted = m;
    },
    isMuted: () => muted,
  };
}

/** Event -> cue mapping. Returns null for events with no sound. */
export function cueForEvent(event: GameEvent): AudioCueId | null {
  switch (event.type) {
    case 'world_prepared':
      return 'portal_open';
    case 'room_entered':
      return 'room_enter';
    case 'room_cleared':
      return 'room_clear';
    case 'player_dashed':
      return 'dash';
    case 'player_attacked':
      return 'attack';
    case 'ability_used':
      return 'ability';
    case 'enemy_attacked':
      return 'enemy_shot';
    case 'ability_unlocked':
      return 'ui_confirm';
    case 'player_revived':
      return 'revive';
    case 'lore_discovered':
      return 'lore';
    case 'anchor_planted':
      return 'anchor';
    case 'enemy_damaged':
      return 'hit';
    case 'player_damaged':
      return 'player_hit';
    case 'player_downed':
      return 'player_down';
    case 'enemy_defeated':
      return 'enemy_down';
    default:
      return null;
  }
}

// ---- colour helpers (palette → voice) ----------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function hueOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
