import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Appearance = "system" | "light" | "dark";
export type Accent = "sunset" | "ocean" | "violet" | "lime" | "mono";

export const accents: Record<Accent, { name: string; a: string; b: string }> = {
  sunset: { name: "Sunset", a: "#ff9240", b: "#ec266e" },
  ocean: { name: "Ocean", a: "#28c8c8", b: "#1e50c8" },
  violet: { name: "Violet", a: "#b06bff", b: "#5b3bf0" },
  lime: { name: "Lime", a: "#b6e843", b: "#16a34a" },
  mono: { name: "Graphite", a: "#9ca3af", b: "#4b5563" },
};

/** kbit/s, 0 = original. */
export const qualities = [0, 320, 256, 192, 128, 96];
export const qualityName = (q: number) => (q === 0 ? "Original" : `${q} kbit/s`);

export const eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const eqPresets: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  "Bass Booster": [6, 5, 4, 2.5, 1, 0, 0, 0, 0, 0],
  "Bass Reducer": [-6, -5, -4, -2.5, -1, 0, 0, 0, 0, 0],
  "Treble Booster": [0, 0, 0, 0, 0, 1, 2.5, 4, 5, 6],
  "Vocal Booster": [-2, -3, -3, 1, 4, 4, 3, 1, 0, -2],
  Rock: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5],
  Pop: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1],
  Jazz: [4, 3, 1, 2, -1.5, -1.5, 0, 1.5, 3, 4],
  Classical: [5, 4, 3, 2, -1, -1, 0, 2, 3, 4],
  Electronic: [4.5, 4, 1, 0, -2, 2, 1, 1.5, 4, 5],
  "Hip-Hop": [5, 4.5, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3],
  Acoustic: [4.5, 4, 3, 1, 2, 1.5, 3, 3.5, 3, 2],
  Loudness: [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  "Late Night": [-4, -3, -1, 1, 3, 3, 2, 0, -2, -4],
  "Small Speakers": [5.5, 4.5, 4, 3, 2, 0, -2, -3, -4, -5],
};

export interface EqualizerSettings {
  enabled: boolean;
  preset: string;
  gains: number[];
  preamp: number;
}

export const defaultEqualizer = (): EqualizerSettings => ({ enabled: false, preset: "Flat", gains: [...eqPresets.Flat], preamp: 0 });

export interface ReaderSettings {
  theme: "original" | "paper" | "quiet" | "night";
  font: string;
  textSize: number;
  lineHeight: number;
  margin: number;
  justify: boolean;
  scrolling: boolean;
}

export const readerThemes = {
  original: { name: "Original", bg: "#ffffff", fg: "#1c1c1e" },
  paper: { name: "Paper", bg: "#f8f1e3", fg: "#3b2f25" },
  quiet: { name: "Quiet", bg: "#4a4a4d", fg: "#e2e2e4" },
  night: { name: "Night", bg: "#121212", fg: "#d6d6d8" },
} as const;

export const readerFonts: { id: string; name: string; css?: string }[] = [
  { id: "original", name: "Original" },
  { id: "serif", name: "Serif", css: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif" },
  { id: "sans", name: "Sans", css: "'DM Sans Variable', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "georgia", name: "Georgia", css: "Georgia, serif" },
  { id: "charter", name: "Charter", css: "Charter, 'Bitstream Charter', Georgia, serif" },
  { id: "mono", name: "Mono", css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
];

export interface Settings {
  appearance: Appearance;
  accent: Accent;
  quality: number;
  downloadQuality: number;
  offlineMode: boolean;
  reportPlays: boolean;
  normalizeVolume: boolean;
  downloadFavorites: boolean;
  syncOnLaunch: boolean;
  /** Minutes between background syncs, 0 = off. */
  syncInterval: number;
  showMusic: boolean;
  showBooks: boolean;
  showAudiobooks: boolean;
  showRadio: boolean;
  welcomeDone: boolean;
  equalizer: EqualizerSettings;
  /** Equalizers per server ("server:<id>") or library ("library:<server>:<library>"). */
  equalizerProfiles: Record<string, EqualizerSettings>;
  reader: ReaderSettings;
  volume: number;
  radioCountry?: string;
  sidebarCollapsed: boolean;
}

export const useSettings = create<Settings & { set: (patch: Partial<Settings>) => void }>()(
  persist(
    (set) => ({
      appearance: "system",
      accent: "sunset",
      quality: 0,
      downloadQuality: 0,
      offlineMode: false,
      reportPlays: true,
      normalizeVolume: false,
      downloadFavorites: false,
      syncOnLaunch: true,
      syncInterval: 60,
      showMusic: true,
      showBooks: true,
      showAudiobooks: true,
      showRadio: true,
      welcomeDone: false,
      equalizer: defaultEqualizer(),
      equalizerProfiles: {},
      reader: { theme: "original", font: "original", textSize: 100, lineHeight: 0, margin: 48, justify: false, scrolling: false },
      volume: 0.8,
      sidebarCollapsed: false,
      set: (patch) => set(patch),
    }),
    { name: "ampli.settings", partialize: ({ set: _set, ...rest }) => rest },
  ),
);

export const settings = () => useSettings.getState();

/** The equalizer that applies to a song: its library's, its server's, or the default one. */
export function equalizerFor(serverId?: string, libraryId?: string): EqualizerSettings {
  const s = settings();
  if (serverId && libraryId && s.equalizerProfiles[`library:${serverId}:${libraryId}`]) return s.equalizerProfiles[`library:${serverId}:${libraryId}`];
  if (serverId && s.equalizerProfiles[`server:${serverId}`]) return s.equalizerProfiles[`server:${serverId}`];
  return s.equalizer;
}
