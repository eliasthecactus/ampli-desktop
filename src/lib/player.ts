// The music player: a queue with shuffle and repeat, the next song loaded ahead in a second element so it
// starts without a gap, plays reported to the server, Media Session (media keys, system Now Playing).
import { create } from "zustand";
import { account, musicClient } from "./accounts";
import { artworkURL } from "./artwork";
import { downloadedURL } from "./downloads";
import { createAudio, engine } from "./engine";
import { connectionOf, mediaURL } from "./http";
import { recordPlay } from "./library";
import { toast } from "./nav";
import { equalizerFor, settings, useSettings } from "./settings";
import type { Track } from "./types";

export type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: Track[];
  /** The order before shuffling, to go back to. */
  original: Track[] | null;
  index: number;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  /** Sleep timer: a time, or the end of the current song. */
  sleepAt: number | null;
  sleepEndOfTrack: boolean;
}

export const usePlayer = create<PlayerState>(() => ({
  queue: [],
  original: null,
  index: -1,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: "off",
  sleepAt: null,
  sleepEndOfTrack: false,
}));

const get = () => usePlayer.getState();
const set = (patch: Partial<PlayerState>) => usePlayer.setState(patch);

export const current = () => {
  const s = get();
  return s.queue[s.index] as Track | undefined;
};

// Two elements: one plays, the other loads the next song.
let el = createAudio();
let spare = createAudio();
let spareKey: string | null = null;
let scrobbled = false;
let startedKey: string | null = null;
let errorCount = 0;

function streamURL(track: Track): string | null {
  const local = downloadedURL(track.key);
  if (local) return local;
  if (settings().offlineMode) return null;
  const a = account(track.serverId);
  const client = musicClient(track.serverId);
  if (!a || !client) return null;
  try {
    return mediaURL(connectionOf(a), client.streamURL(track.id, track.suffix, settings().quality || undefined));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return null;
  }
}

function bind(audio: HTMLAudioElement) {
  engine.attach(audio);
  audio.addEventListener("timeupdate", () => {
    if (audio !== el) return;
    set({ position: audio.currentTime });
    checkScrobble();
    preloadNext();
  });
  audio.addEventListener("durationchange", () => {
    if (audio === el && Number.isFinite(audio.duration)) set({ duration: audio.duration });
  });
  audio.addEventListener("playing", () => {
    if (audio !== el) return;
    errorCount = 0;
    set({ playing: true, buffering: false });
  });
  audio.addEventListener("pause", () => audio === el && set({ playing: false }));
  audio.addEventListener("waiting", () => audio === el && set({ buffering: true }));
  audio.addEventListener("ended", () => audio === el && onEnded());
  audio.addEventListener("error", () => {
    if (audio !== el || !audio.src) return;
    const t = current();
    errorCount++;
    toast(`${t?.title ?? "This song"} can't be played.`, "error");
    set({ playing: false, buffering: false });
    // Skip what can't be played, but don't run through a whole queue when the server is down.
    if (errorCount < 3) setTimeout(() => advance(true), 800);
  });
}
bind(el);
bind(spare);

engine.register("music", () => {
  if (!el.paused) el.pause();
});

function applySound(track: Track) {
  engine.setEqualizer(equalizerFor(track.serverId, track.libraryId));
  engine.setElementGain(el, settings().normalizeVolume ? track.gain : undefined);
}

function load(autoplay: boolean, at = 0) {
  const track = current();
  if (!track) return stop();
  scrobbled = false;
  startedKey = null;
  if (spareKey === track.key && spare.src) {
    // The next song is already loading: swap elements.
    el.pause();
    [el, spare] = [spare, el];
    spare.removeAttribute("src");
    spare.load();
    spareKey = null;
  } else {
    const url = streamURL(track);
    if (!url) {
      toast(settings().offlineMode ? `${track.title} isn't downloaded.` : `${track.title} can't be played.`, "error");
      if (autoplay && get().index < get().queue.length - 1) {
        set({ index: get().index + 1 });
        return load(autoplay);
      }
      return stop();
    }
    el.pause();
    el.src = url;
    spareKey = null;
  }
  applySound(track);
  set({ position: at, duration: track.duration, buffering: autoplay });
  if (at) el.currentTime = at;
  if (autoplay) {
    engine.claim("music");
    el.play().catch(() => set({ playing: false, buffering: false }));
  }
  updateSession(track);
  persist();
}

function preloadNext() {
  const s = get();
  if (spareKey || !el.duration || el.duration - el.currentTime > 30) return;
  const next = s.repeat === "one" ? null : s.queue[s.index + 1] ?? (s.repeat === "all" ? s.queue[0] : undefined);
  if (!next) return;
  const url = streamURL(next);
  if (!url) return;
  spareKey = next.key;
  spare.src = url;
  spare.load();
}

function checkScrobble() {
  const track = current();
  if (!track) return;
  if (!startedKey && el.currentTime > 1) {
    startedKey = track.key;
    if (settings().reportPlays) void musicClient(track.serverId)?.reportNowPlaying(track.id);
  }
  const threshold = Math.min((el.duration || track.duration) / 2, 240);
  if (!scrobbled && threshold > 0 && el.currentTime >= threshold) {
    scrobbled = true;
    if (!track.catalog) void recordPlay(track.key, track.serverId, track.albumKey);
    if (settings().reportPlays) void musicClient(track.serverId)?.reportPlayed(track.id, el.currentTime, true);
  }
}

function onEnded() {
  const s = get();
  if (s.sleepEndOfTrack) {
    set({ sleepEndOfTrack: false, playing: false });
    return;
  }
  if (s.repeat === "one") {
    el.currentTime = 0;
    void el.play();
    scrobbled = false;
    return;
  }
  advance(true);
}

function advance(autoplay: boolean) {
  const s = get();
  if (s.index < s.queue.length - 1) {
    set({ index: s.index + 1 });
    load(autoplay);
  } else if (s.repeat === "all" && s.queue.length) {
    set({ index: 0 });
    load(autoplay);
  } else {
    el.pause();
    el.currentTime = 0;
    set({ playing: false, position: 0 });
  }
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const player = {
  play(tracks: Track[], start = 0, opts: { shuffle?: boolean } = {}) {
    if (!tracks.length) return;
    let queue = tracks;
    let index = start;
    let original: Track[] | null = null;
    const shuffle = opts.shuffle ?? false;
    if (shuffle) {
      original = tracks;
      const first = opts.shuffle && start === 0 ? null : tracks[start];
      const rest = shuffled(tracks.filter((t) => t !== first));
      queue = first ? [first, ...rest] : rest;
      index = 0;
    }
    spareKey = null;
    set({ queue, original, index, shuffle, sleepEndOfTrack: false });
    load(true);
  },

  toggle() {
    if (!current()) return;
    if (el.paused) {
      if (!el.src) return load(true, get().position);
      engine.claim("music");
      void el.play();
    } else el.pause();
  },

  pause() {
    el.pause();
  },

  next() {
    advance(get().playing || !el.paused);
  },

  previous() {
    if (el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    const s = get();
    if (s.index > 0) {
      set({ index: s.index - 1 });
      load(!el.paused || s.playing);
    } else el.currentTime = 0;
  },

  seek(time: number) {
    if (!current()) return;
    if (!el.src) return load(false, time);
    el.currentTime = Math.max(0, Math.min(time, el.duration || time));
    set({ position: el.currentTime });
  },

  jump(index: number) {
    if (index < 0 || index >= get().queue.length) return;
    set({ index });
    load(true);
  },

  playNext(tracks: Track[]) {
    const s = get();
    if (!s.queue.length) return player.play(tracks);
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, ...tracks);
    spareKey = null;
    set({ queue, original: s.original ? [...s.original, ...tracks] : null });
    toast(tracks.length === 1 ? `“${tracks[0].title}” plays next` : `${tracks.length} songs play next`);
  },

  addToQueue(tracks: Track[]) {
    const s = get();
    if (!s.queue.length) return player.play(tracks);
    set({ queue: [...s.queue, ...tracks], original: s.original ? [...s.original, ...tracks] : null });
    toast(tracks.length === 1 ? `Added “${tracks[0].title}” to the queue` : `Added ${tracks.length} songs to the queue`);
  },

  remove(index: number) {
    const s = get();
    if (index === s.index) return;
    const queue = s.queue.filter((_, i) => i !== index);
    spareKey = null;
    set({ queue, index: index < s.index ? s.index - 1 : s.index });
  },

  move(from: number, to: number) {
    const s = get();
    const queue = [...s.queue];
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    let index = s.index;
    if (from === s.index) index = to;
    else if (from < s.index && to >= s.index) index--;
    else if (from > s.index && to <= s.index) index++;
    spareKey = null;
    set({ queue, index });
  },

  clearUpcoming() {
    const s = get();
    set({ queue: s.queue.slice(0, s.index + 1) });
    spareKey = null;
  },

  setShuffle(on: boolean) {
    const s = get();
    const now = s.queue[s.index];
    if (!now) return set({ shuffle: on });
    spareKey = null;
    if (on) {
      const rest = shuffled(s.queue.filter((_, i) => i !== s.index));
      set({ shuffle: true, original: s.queue, queue: [now, ...rest], index: 0 });
    } else {
      const original = s.original ?? s.queue;
      set({ shuffle: false, original: null, queue: original, index: Math.max(0, original.indexOf(now)) });
    }
  },

  cycleRepeat() {
    const order: Repeat[] = ["off", "all", "one"];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
  },

  setVolume(v: number) {
    useSettings.getState().set({ volume: v });
    engine.setVolume(v, [el, spare]);
  },

  sleep(minutes: number | "track" | null) {
    if (minutes === null) return set({ sleepAt: null, sleepEndOfTrack: false });
    if (minutes === "track") return set({ sleepEndOfTrack: true, sleepAt: null });
    set({ sleepAt: Date.now() + minutes * 60_000, sleepEndOfTrack: false });
  },

  /** Re-applies equalizer and normalization after settings changed. */
  refreshSound() {
    const t = current();
    if (t) applySound(t);
  },

  updateTrack(key: string, patch: Partial<Track>) {
    set({ queue: get().queue.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  },
};

function stop() {
  el.pause();
  el.removeAttribute("src");
  el.load();
  set({ playing: false, buffering: false, position: 0 });
}

// Sleep timer.
setInterval(() => {
  const { sleepAt } = get();
  if (sleepAt && Date.now() >= sleepAt) {
    el.pause();
    set({ sleepAt: null });
    toast("Sleep timer: paused");
  }
}, 1000);

// MARK: Media Session

function updateSession(track: Track) {
  if (!("mediaSession" in navigator)) return;
  const art = artworkURL(track.serverId, track.artworkId, 512);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: art ? [{ src: art, sizes: "512x512" }] : [],
  });
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => player.toggle());
  ms.setActionHandler("pause", () => player.pause());
  ms.setActionHandler("nexttrack", () => player.next());
  ms.setActionHandler("previoustrack", () => player.previous());
  ms.setActionHandler("seekto", (d) => d.seekTime !== undefined && player.seek(d.seekTime));
  ms.setActionHandler("seekforward", null);
  ms.setActionHandler("seekbackward", null);
}

// MARK: Restoring the queue after a restart

function persist() {
  const s = get();
  try {
    localStorage.setItem(
      "ampli.queue",
      JSON.stringify({ queue: s.queue.slice(Math.max(0, s.index - 50), s.index + 500), index: Math.min(s.index, 50), shuffle: s.shuffle, repeat: s.repeat }),
    );
  } catch {
    /* full */
  }
}

let lastSaved = 0;
usePlayer.subscribe((s) => {
  if (Date.now() - lastSaved > 5000) {
    lastSaved = Date.now();
    localStorage.setItem("ampli.position", String(s.position));
  }
});

export function restoreQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem("ampli.queue") ?? "null");
    if (!saved?.queue?.length) return;
    set({ queue: saved.queue, index: saved.index, shuffle: saved.shuffle, repeat: saved.repeat, position: Number(localStorage.getItem("ampli.position") ?? 0), duration: saved.queue[saved.index]?.duration ?? 0 });
    const t = current();
    if (t) updateSession(t);
  } catch {
    /* ignore */
  }
  engine.setVolume(settings().volume, [el, spare]);
}

export const musicElement = () => el;
