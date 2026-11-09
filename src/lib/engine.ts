// The audio graph every player plays through: per-element gain (volume normalization) → 10-band equalizer →
// preamp → volume. Streams come through the local proxy with CORS, so Web Audio can process them.
// One source plays at a time: music, an audiobook or radio.
import { create } from "zustand";
import { isTauri } from "./native";
import { eqFrequencies, settings, type EqualizerSettings } from "./settings";

export type Source = "music" | "audiobook" | "radio";

/** Which player the player bar shows: the one that played last. */
export const useSource = create<{ source: Source | null }>(() => ({ source: (localStorage.getItem("ampli.source") as Source | null) ?? null }));
useSource.subscribe((s) => s.source && localStorage.setItem("ampli.source", s.source));

class Engine {
  private ctx: AudioContext | null = null;
  private bands: BiquadFilterNode[] = [];
  private preamp: GainNode | null = null;
  private master: GainNode | null = null;
  private gains = new WeakMap<HTMLMediaElement, GainNode>();
  private stoppers = new Map<Source, () => void>();
  private eq: EqualizerSettings | null = null;
  /** Web Audio needs CORS on every stream; only the desktop app's proxy guarantees that. */
  readonly graph = isTauri || import.meta.env.DEV;

  private setup() {
    if (this.ctx || !this.graph) return;
    this.ctx = new AudioContext({ latencyHint: "playback" });
    this.bands = eqFrequencies.map((frequency, i) => {
      const f = this.ctx!.createBiquadFilter();
      f.type = i === 0 ? "lowshelf" : i === eqFrequencies.length - 1 ? "highshelf" : "peaking";
      f.frequency.value = frequency;
      f.Q.value = 1.1;
      f.gain.value = 0;
      return f;
    });
    this.preamp = this.ctx.createGain();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings().volume;
    let node: AudioNode = this.preamp;
    for (const band of this.bands) {
      node.connect(band);
      node = band;
    }
    node.connect(this.master);
    this.master.connect(this.ctx.destination);
    if (this.eq) this.setEqualizer(this.eq);
  }

  private pending = new Set<HTMLMediaElement>();
  private wanted = new WeakMap<HTMLMediaElement, number>();

  /**
   * Routes an element through the graph. The graph itself is built on the first play (browsers want a user
   * gesture before audio starts), so elements wait until then.
   */
  attach(el: HTMLMediaElement) {
    el.crossOrigin = "anonymous";
    if (!this.graph) {
      el.volume = settings().volume;
      return;
    }
    this.pending.add(el);
    if (this.ctx) this.connectPending();
  }

  private connectPending() {
    for (const el of this.pending) {
      if (this.gains.has(el)) continue;
      const source = this.ctx!.createMediaElementSource(el);
      const gain = this.ctx!.createGain();
      gain.gain.value = this.wanted.get(el) ?? 1;
      source.connect(gain).connect(this.preamp!);
      this.gains.set(el, gain);
    }
    this.pending.clear();
  }

  /** Call before playing: browsers keep the context suspended until the user did something. */
  async resume() {
    if (!this.graph) return;
    this.setup();
    this.connectPending();
    if (this.ctx && this.ctx.state !== "running") await this.ctx.resume().catch(() => {});
  }

  setElementGain(el: HTMLMediaElement, db: number | undefined) {
    const linear = db === undefined ? 1 : Math.pow(10, Math.max(-20, Math.min(db, 8)) / 20);
    this.wanted.set(el, linear);
    const node = this.gains.get(el);
    if (node && this.ctx) node.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.02);
  }

  setVolume(v: number, elements: HTMLMediaElement[] = []) {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.02);
    if (!this.graph) elements.forEach((el) => (el.volume = v));
  }

  setEqualizer(eq: EqualizerSettings | null) {
    this.eq = eq;
    if (!this.ctx) return;
    const on = !!eq?.enabled;
    const t = this.ctx.currentTime;
    this.bands.forEach((band, i) => band.gain.setTargetAtTime(on ? (eq!.gains[i] ?? 0) : 0, t, 0.03));
    this.preamp!.gain.setTargetAtTime(on ? Math.pow(10, (eq!.preamp ?? 0) / 20) : 1, t, 0.03);
  }

  /** Each player registers how to stop itself; starting one stops the others. */
  register(source: Source, stop: () => void) {
    this.stoppers.set(source, stop);
  }

  claim(source: Source) {
    useSource.setState({ source });
    for (const [other, stop] of this.stoppers) if (other !== source) stop();
    // Synchronously, so the element is in the graph before it starts playing.
    if (this.graph) {
      this.setup();
      this.connectPending();
    }
    void this.resume();
  }
}

export const engine = new Engine();

export function createAudio(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  return el;
}
