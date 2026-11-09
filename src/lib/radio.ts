// Live radio: 1000+ stations from 34 countries shipped with the app (no API), favourites and recents, song
// titles from the stream (ICY through the proxy, ID3 in HLS), next/previous station, sleep timer, reconnects.
import type Hls from "hls.js";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createAudio, engine } from "./engine";
import { icyTitle, isTauri, proxied } from "./native";
import { toast } from "./nav";
import { normalize } from "./search";
import { settings } from "./settings";

export interface RadioStream {
  url: string;
  codec: string;
  bitrate: number;
}

export interface RadioStation {
  id: string;
  name: string;
  shortName?: string;
  country: string;
  language?: string;
  region?: string;
  network?: string;
  genres: string[];
  color: string;
  featured?: boolean;
  homepage?: string;
  keywords?: string[];
  streams: RadioStream[];
}

export const genres: Record<string, { name: string; color: string }> = {
  news: { name: "News", color: "#1F4E79" },
  talk: { name: "Talk", color: "#5B4B8A" },
  pop: { name: "Pop", color: "#E5007E" },
  hits: { name: "Hits", color: "#F04E23" },
  rock: { name: "Rock", color: "#3A3A3A" },
  alternative: { name: "Alternative", color: "#7A2BD9" },
  electronic: { name: "Electronic", color: "#0F7C9E" },
  jazz: { name: "Jazz", color: "#2E7D6F" },
  classical: { name: "Classical", color: "#8C6A3F" },
  culture: { name: "Culture", color: "#B5121B" },
  folk: { name: "Folk & Schlager", color: "#3E8E5A" },
  country: { name: "Country", color: "#B07A3B" },
  oldies: { name: "Oldies", color: "#C2185B" },
  community: { name: "Community Radio", color: "#E39B00" },
  regional: { name: "Regional", color: "#2B6CB0" },
  religion: { name: "Faith", color: "#D08A2E" },
};

export const languageAreas: Record<string, string> = {
  de: "German-speaking Switzerland",
  fr: "French-speaking Switzerland",
  it: "Italian-speaking Switzerland",
  rm: "Romansh",
  en: "English",
  multi: "Multilingual",
};

const regionNames = new Intl.DisplayNames([navigator.language, "en"], { type: "region" });
export const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};
export const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));

export const displayName = (s: RadioStation) => s.shortName ?? s.name;

/** "Zürich · Hits", or "News · Pop" for stations without a region. */
export function subtitle(s: RadioStation): string {
  const g = s.genres.filter((x) => x !== "regional" && genres[x]).map((x) => genres[x].name);
  if (s.region) return [s.region, ...g.slice(0, 1)].join(" · ");
  if (!g.length) return countryName(s.country);
  return g.slice(0, 2).join(" · ");
}

/** Short text for small artwork: "SRF 3", "Pilatus", "SJ". */
export function monogram(s: RadioStation): string {
  let short = displayName(s);
  if (short.length > 8 && short.startsWith("Radio ")) short = short.slice(6);
  if (short.length <= 8) return short;
  return short
    .split(" ")
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// MARK: Catalog

let catalog: { code: string; stations: RadioStation[] }[] = [];
let byId = new Map<string, RadioStation>();

export async function loadCatalog() {
  if (catalog.length) return catalog;
  const data = (await import("../data/radio-stations.json")).default as { countries: { code: string; stations: RadioStation[] }[] };
  catalog = data.countries.map((c) => ({ code: c.code, stations: c.stations.map((s) => ({ ...s, country: s.country ?? c.code })) }));
  byId = new Map(catalog.flatMap((c) => c.stations.map((s) => [s.id, s] as const)));
  useRadio.setState({ catalogLoaded: true });
  return catalog;
}

export const countries = () => catalog.map((c) => c.code);
export const stationsOf = (code: string) => catalog.find((c) => c.code === code)?.stations ?? [];
export const station = (id: string) => byId.get(id);
export const allStations = () => catalog.flatMap((c) => c.stations);

/** The user's country first (from the system language), then Switzerland, then the rest by name. */
export function defaultCountry(): string {
  const chosen = settings().radioCountry;
  if (chosen && catalog.some((c) => c.code === chosen)) return chosen;
  const region = navigator.language.split("-")[1]?.toUpperCase();
  if (region && catalog.some((c) => c.code === region)) return region;
  return "CH";
}

export function searchStations(query: string, limit = 60): RadioStation[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const ranked: [RadioStation, number][] = [];
  for (const s of allStations()) {
    const name = normalize(`${s.name} ${s.shortName ?? ""}`);
    const extra = normalize(
      [s.region, s.network, ...(s.keywords ?? []), ...s.genres, ...s.genres.map((g) => genres[g]?.name ?? ""), countryName(s.country), s.country, s.language ? languageAreas[s.language] : ""]
        .filter(Boolean)
        .join(" "),
    );
    const hay = `${name} ${extra}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const rank = tokens.every((t) => name.startsWith(t) || name.includes(" " + t)) ? 0 : tokens.every((t) => name.includes(t)) ? 1 : 2;
    ranked.push([s, rank]);
  }
  ranked.sort((a, b) => a[1] - b[1] || Number(!!b[0].featured) - Number(!!a[0].featured) || a[0].name.localeCompare(b[0].name));
  return ranked.slice(0, limit).map((r) => r[0]);
}

// MARK: What's on air

export interface OnAir {
  artist?: string;
  title: string;
}

/** "ST. GERMAIN" → "St. Germain"; mixed case, "AC/DC" and "UB40" stay. */
function softened(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length <= 3 || letters !== letters.toUpperCase()) return text;
  return text
    .split(" ")
    .map((w) => (/[\d/]/.test(w) || ["DJ", "MC", "UK", "USA", "TV"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** Parses "Artist - Title". Station names, slogans, phone numbers and ad markers give nothing. */
export function parseOnAir(raw: string | null | undefined, s: RadioStation): OnAir | null {
  let text = raw?.trim();
  if (!text) return null;
  text = text.replace(/\0/g, "");
  const lower = text.toLowerCase();
  if (["www.", "http", ".ch/", "@", "werbung", "advert", "publicité", "pubblicità", "jingle"].some((n) => lower.includes(n))) return null;
  if (/\d{3}[\s/]?\d{2,3}[\s/]?\d{2}[\s/]?\d{2}/.test(lower)) return null;
  const names = [s.name, displayName(s)].map((n) => n.toLowerCase());
  if (names.includes(lower) || names.some((n) => lower.startsWith(`${n} -`) || lower.startsWith(`${n} |`))) return null;
  for (const sep of [" - ", " – ", " — ", " / "]) {
    const at = text.indexOf(sep);
    if (at >= 0) {
      const artist = text.slice(0, at).trim();
      const title = text.slice(at + sep.length).trim();
      if (!title) return artist ? { title: softened(artist) } : null;
      return { artist: artist ? softened(artist) : undefined, title: softened(title) };
    }
  }
  if (!text.includes(" ") && text === text.toUpperCase()) return null;
  return { title: softened(text) };
}

// MARK: Favourites, recents and the player

interface RadioState {
  catalogLoaded: boolean;
  favorites: string[];
  recents: string[];
  current: RadioStation | null;
  /** The list the station was started from, for next/previous. */
  context: string[];
  playing: boolean;
  buffering: boolean;
  onAir: OnAir | null;
  sleepAt: number | null;
}

export const useRadio = create<RadioState>()(
  persist(
    (): RadioState => ({
      catalogLoaded: false,
      favorites: [],
      recents: [],
      current: null,
      context: [],
      playing: false,
      buffering: false,
      onAir: null,
      sleepAt: null,
    }),
    { name: "ampli.radio", partialize: (s) => ({ favorites: s.favorites, recents: s.recents }) },
  ),
);

const get = () => useRadio.getState();
const set = (patch: Partial<RadioState>) => useRadio.setState(patch);

const el = createAudio();
el.preload = "none";
engine.attach(el);
engine.register("radio", () => {
  if (!el.paused || get().playing) radio.stop();
});

let hls: Hls | null = null;
let streamIndex = 0;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let icyId = "";
let wanted = false;

const isHls = (s: RadioStream) => /\.m3u8(\?|$)/i.test(s.url) || s.codec.toLowerCase() === "hls";

async function start() {
  const s = get().current;
  if (!s) return;
  const stream = s.streams[streamIndex] ?? s.streams[0];
  clearTimeout(retryTimer);
  hls?.destroy();
  hls = null;
  set({ buffering: true });
  engine.claim("radio");
  engine.setEqualizer(settings().equalizer);
  engine.setElementGain(el, undefined);
  if (isHls(stream)) {
    const { default: HlsClass } = await import("hls.js");
    if (HlsClass.isSupported()) {
      hls = new HlsClass({
        lowLatencyMode: false,
        // Every request goes through the proxy too (CORS, mixed content).
        xhrSetup: (xhr, url) => xhr.open("GET", proxied(url), true),
      });
      hls.on(HlsClass.Events.FRAG_PARSING_METADATA, (_e, data) => {
        for (const sample of data.samples) {
          const title = id3Title(sample.data);
          if (title) set({ onAir: parseOnAir(title, s) });
        }
      });
      hls.on(HlsClass.Events.ERROR, (_e, data) => {
        if (data.fatal) failed();
      });
      hls.loadSource(stream.url);
      hls.attachMedia(el);
    } else {
      el.src = proxied(stream.url);
    }
  } else {
    icyId = `${s.id}-${Date.now()}`;
    el.src = isTauri ? proxied(stream.url, { icy: icyId }) : stream.url;
  }
  el.play().catch(() => {});
}

function failed() {
  const s = get().current;
  if (!s || !wanted) return;
  // Try the station's other streams, then wait and try again.
  if (streamIndex < s.streams.length - 1) {
    streamIndex++;
    void start();
    return;
  }
  streamIndex = 0;
  if (retries < 5) {
    retries++;
    set({ buffering: true });
    retryTimer = setTimeout(() => void start(), Math.min(2000 * 2 ** (retries - 1), 20_000));
  } else {
    set({ playing: false, buffering: false });
    toast(`${displayName(s)} can't be reached right now.`, "error");
  }
}

el.addEventListener("playing", () => {
  retries = 0;
  set({ playing: true, buffering: false });
});
el.addEventListener("waiting", () => set({ buffering: true }));
el.addEventListener("error", () => {
  if (el.getAttribute("src")) failed();
});
el.addEventListener("ended", () => failed());
el.addEventListener("pause", () => {
  if (!wanted) set({ playing: false, buffering: false });
});
// Reconnects when the network comes back.
window.addEventListener("online", () => {
  if (wanted && get().current) {
    retries = 0;
    void start();
  }
});

// Stream titles from the proxy.
setInterval(async () => {
  const s = get().current;
  if (!s || !get().playing || hls) return;
  const title = await icyTitle(icyId);
  const onAir = parseOnAir(title, s);
  const prev = get().onAir;
  if (onAir?.title !== prev?.title || onAir?.artist !== prev?.artist) set({ onAir });
  updateSession();
}, 5000);

setInterval(() => {
  const { sleepAt } = get();
  if (sleepAt && Date.now() >= sleepAt) {
    radio.stop();
    set({ sleepAt: null });
    toast("Sleep timer: radio stopped");
  }
}, 1000);

/** The title from an ID3 tag (TIT2, with TPE1 when there). */
function id3Title(data: Uint8Array): string | null {
  const frames: Record<string, string> = {};
  if (data.length < 10 || String.fromCharCode(data[0], data[1], data[2]) !== "ID3") return null;
  let i = 10;
  while (i + 10 < data.length) {
    const id = String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]);
    const size = (data[i + 4] << 24) | (data[i + 5] << 16) | (data[i + 6] << 8) | data[i + 7];
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0) break;
    const body = data.subarray(i + 10, i + 10 + size);
    if (id === "TIT2" || id === "TPE1") {
      const enc = body[0];
      const text = new TextDecoder(enc === 1 ? "utf-16" : enc === 2 ? "utf-16be" : enc === 3 ? "utf-8" : "latin1").decode(body.subarray(1));
      frames[id] = text.replace(/\0/g, "").trim();
    }
    i += 10 + size;
  }
  if (!frames.TIT2) return null;
  return frames.TPE1 ? `${frames.TPE1} - ${frames.TIT2}` : frames.TIT2;
}

function updateSession() {
  const { current: s, onAir } = get();
  if (!s || !("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: onAir?.title ?? displayName(s),
    artist: onAir?.artist ?? (onAir ? displayName(s) : subtitle(s)),
    album: "Radio",
  });
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => radio.toggle());
  ms.setActionHandler("pause", () => radio.stop());
  ms.setActionHandler("nexttrack", () => radio.step(1));
  ms.setActionHandler("previoustrack", () => radio.step(-1));
  ms.setActionHandler("seekto", null);
}

export const radio = {
  play(s: RadioStation, context?: RadioStation[]) {
    wanted = true;
    streamIndex = 0;
    retries = 0;
    const recents = [s.id, ...get().recents.filter((id) => id !== s.id)].slice(0, 30);
    set({ current: s, onAir: null, recents, context: context?.map((x) => x.id) ?? get().context });
    void start();
    updateSession();
  },

  toggle() {
    const s = get().current;
    if (!s) return;
    if (get().playing || get().buffering) radio.stop();
    else radio.play(s);
  },

  stop() {
    wanted = false;
    clearTimeout(retryTimer);
    hls?.destroy();
    hls = null;
    el.pause();
    // Live streams don't pause: drop the connection.
    el.removeAttribute("src");
    el.load();
    set({ playing: false, buffering: false });
  },

  step(delta: 1 | -1) {
    const { current: s, context, favorites } = get();
    if (!s) return;
    const list = context.length > 1 ? context : favorites.length > 1 ? favorites : stationsOf(s.country).map((x) => x.id);
    const at = list.indexOf(s.id);
    const next = station(list[(at + delta + list.length) % list.length]);
    if (next) radio.play(next);
  },

  toggleFavorite(s: RadioStation) {
    const { favorites } = get();
    set({ favorites: favorites.includes(s.id) ? favorites.filter((id) => id !== s.id) : [...favorites, s.id] });
  },

  sleep(minutes: number | null) {
    set({ sleepAt: minutes === null ? null : Date.now() + minutes * 60_000 });
  },
};
