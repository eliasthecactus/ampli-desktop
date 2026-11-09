// Audiobooks: one or many files per book, chapters, 15/30 s skips, 0.5x to 3x with pitch kept, sleep timer
// (incl. end of chapter), progress saved to the server (and locally when it can't be reached).
import { create } from "zustand";
import { account, bookClient } from "./accounts";
import { coverURL } from "./artwork";
import { downloadedURL, isDownloaded } from "./downloads";
import { createAudio, engine } from "./engine";
import { connectionOf, mediaURL } from "./http";
import { index, setBookProgress } from "./library";
import { toast } from "./nav";
import { settings } from "./settings";
import type { AudiobookChapter, AudiobookDetail, Book } from "./types";

interface AudiobookState {
  book: Book | null;
  detail: AudiobookDetail | null;
  trackIndex: number;
  /** Position in the whole book, seconds. */
  position: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  rate: number;
  sleepAt: number | null;
  sleepEndOfChapter: boolean;
}

export const useAudiobook = create<AudiobookState>(() => ({
  book: null,
  detail: null,
  trackIndex: 0,
  position: 0,
  duration: 0,
  playing: false,
  buffering: false,
  rate: Number(localStorage.getItem("ampli.audiobookRate") ?? 1) || 1,
  sleepAt: null,
  sleepEndOfChapter: false,
}));

const get = () => useAudiobook.getState();
const set = (patch: Partial<AudiobookState>) => useAudiobook.setState(patch);

const el = createAudio();
el.preservesPitch = true;
engine.attach(el);
engine.register("audiobook", () => {
  if (!el.paused) el.pause();
});

export const chapterAt = (detail: AudiobookDetail | null, position: number): AudiobookChapter | undefined =>
  detail?.chapters.find((c) => position >= c.start && position < c.end) ?? detail?.chapters[detail.chapters.length - 1];

function trackURL(book: Book, i: number): string | null {
  const local = downloadedURL(`book:${book.key}:${i}`);
  if (local) return local;
  if (settings().offlineMode) return null;
  const a = account(book.serverId);
  const client = bookClient(book.serverId);
  const track = get().detail?.tracks[i];
  if (!a || !client || !track) return null;
  return mediaURL(connectionOf(a), client.audioURL(book.id, track));
}

function loadTrack(i: number, offset: number, autoplay: boolean) {
  const { book, detail } = get();
  if (!book || !detail?.tracks[i]) return;
  const url = trackURL(book, i);
  if (!url) return toast("This audiobook isn't downloaded.", "error");
  set({ trackIndex: i, buffering: autoplay });
  el.src = url;
  el.playbackRate = get().rate;
  const seekWhenReady = () => {
    el.currentTime = offset;
    el.removeEventListener("loadedmetadata", seekWhenReady);
  };
  if (offset > 0) el.addEventListener("loadedmetadata", seekWhenReady);
  if (autoplay) {
    engine.claim("audiobook");
    engine.setEqualizer(null);
    el.play().catch(() => set({ playing: false, buffering: false }));
  }
}

el.addEventListener("timeupdate", () => {
  const { detail, trackIndex, sleepEndOfChapter } = get();
  const track = detail?.tracks[trackIndex];
  if (!track) return;
  const position = track.startOffset + el.currentTime;
  const before = chapterAt(detail, get().position);
  set({ position });
  if (sleepEndOfChapter && before && position >= before.end - 0.3) {
    el.pause();
    set({ sleepEndOfChapter: false });
    toast("Sleep timer: paused at the end of the chapter");
  }
  maybeSave();
});
el.addEventListener("playing", () => set({ playing: true, buffering: false }));
el.addEventListener("pause", () => {
  set({ playing: false });
  void save();
});
el.addEventListener("waiting", () => set({ buffering: true }));
el.addEventListener("ended", () => {
  const { detail, trackIndex } = get();
  if (detail && trackIndex < detail.tracks.length - 1) loadTrack(trackIndex + 1, 0, true);
  else {
    set({ playing: false });
    void save(true);
  }
});
el.addEventListener("error", () => {
  if (!el.src) return;
  set({ playing: false, buffering: false });
  toast("The audiobook can't be played right now.", "error");
});

let lastSave = 0;
function maybeSave() {
  if (Date.now() - lastSave > 15_000) void save();
}

async function save(finished = false) {
  const { book, position, duration } = get();
  if (!book) return;
  lastSave = Date.now();
  const done = finished || (duration > 0 && position >= duration - 5);
  await setBookProgress(book.key, { currentTime: position, progress: duration ? Math.min(position / duration, 1) : 0, isFinished: done });
  localStorage.setItem("ampli.audiobook.last", book.key);
  try {
    await bookClient(book.serverId)?.saveAudioProgress(book.id, position, duration, done);
  } catch {
    // Offline: the local position stays and is sent with the next save.
  }
}

async function detailFor(book: Book): Promise<AudiobookDetail> {
  const stored = localStorage.getItem(`ampli.audiobook.${book.key}`);
  if (stored && (settings().offlineMode || isDownloaded(`book:${book.key}`))) return JSON.parse(stored);
  const client = bookClient(book.serverId);
  if (!client) throw new Error("Sign in to this server again.");
  try {
    return await client.audiobookDetail(book.id);
  } catch (e) {
    if (stored) return JSON.parse(stored);
    throw e;
  }
}

export const audiobook = {
  async open(book: Book, opts: { from?: number; autoplay?: boolean } = {}) {
    const autoplay = opts.autoplay ?? true;
    const s = get();
    if (s.book?.key === book.key && s.detail && opts.from === undefined) {
      if (autoplay && el.paused) audiobook.toggle();
      return;
    }
    if (s.book) await save();
    try {
      const detail = await detailFor(book);
      if (!detail.tracks.length) throw new Error("This audiobook has no audio files.");
      const duration = detail.tracks[detail.tracks.length - 1].startOffset + detail.tracks[detail.tracks.length - 1].duration;
      const fresh = index.book.get(book.key) ?? book;
      let from = opts.from ?? (fresh.progress?.isFinished ? 0 : (fresh.progress?.currentTime ?? 0));
      if (from >= duration - 2) from = 0;
      set({ book: fresh, detail, duration, position: from, sleepEndOfChapter: false });
      audiobook.seek(from, autoplay);
      updateSession();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  },

  toggle() {
    const { book, detail, trackIndex, position } = get();
    if (!book || !detail) return;
    if (el.paused) {
      if (!el.src) return audiobook.seek(position, true);
      engine.claim("audiobook");
      engine.setEqualizer(null);
      void el.play();
    } else el.pause();
    void trackIndex;
  },

  pause() {
    el.pause();
  },

  seek(position: number, autoplay = !el.paused) {
    const { detail, trackIndex, duration } = get();
    if (!detail) return;
    const p = Math.max(0, Math.min(position, duration - 0.5));
    let i = detail.tracks.findIndex((t) => p >= t.startOffset && p < t.startOffset + t.duration);
    if (i < 0) i = detail.tracks.length - 1;
    const offset = p - detail.tracks[i].startOffset;
    set({ position: p });
    if (i === trackIndex && el.src) {
      el.currentTime = offset;
      if (autoplay && el.paused) {
        engine.claim("audiobook");
        void el.play();
      }
    } else loadTrack(i, offset, autoplay);
  },

  skip(seconds: number) {
    audiobook.seek(get().position + seconds);
  },

  chapter(delta: 1 | -1) {
    const { detail, position } = get();
    if (!detail?.chapters.length) return audiobook.skip(delta * 30);
    const at = detail.chapters.findIndex((c) => position >= c.start && position < c.end);
    if (delta < 0 && at >= 0 && position - detail.chapters[at].start > 3) return audiobook.seek(detail.chapters[at].start);
    const target = detail.chapters[Math.max(0, Math.min(at + delta, detail.chapters.length - 1))];
    audiobook.seek(target.start);
  },

  setRate(rate: number) {
    el.playbackRate = rate;
    localStorage.setItem("ampli.audiobookRate", String(rate));
    set({ rate });
  },

  sleep(minutes: number | "chapter" | null) {
    if (minutes === null) return set({ sleepAt: null, sleepEndOfChapter: false });
    if (minutes === "chapter") return set({ sleepEndOfChapter: true, sleepAt: null });
    set({ sleepAt: Date.now() + minutes * 60_000, sleepEndOfChapter: false });
  },

  async markFinished(book: Book, finished: boolean) {
    await setBookProgress(book.key, { isFinished: finished, progress: finished ? 1 : 0, currentTime: finished ? book.duration : 0 });
    try {
      if (book.hasAudio) await bookClient(book.serverId)?.saveAudioProgress(book.id, finished ? book.duration : 0, book.duration, finished);
      else await bookClient(book.serverId)?.saveEbookProgress(book.id, finished ? 1 : 0, finished);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  },

  close() {
    void save();
    el.pause();
    el.removeAttribute("src");
    set({ book: null, detail: null, playing: false });
  },
};

setInterval(() => {
  const { sleepAt } = get();
  if (sleepAt && Date.now() >= sleepAt) {
    el.pause();
    set({ sleepAt: null });
    toast("Sleep timer: paused");
  }
}, 1000);

function updateSession() {
  const { book } = get();
  if (!book || !("mediaSession" in navigator)) return;
  const art = coverURL(book.serverId, book.artworkId, 512);
  navigator.mediaSession.metadata = new MediaMetadata({ title: book.title, artist: book.author, album: "Audiobook", artwork: art ? [{ src: art }] : [] });
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => audiobook.toggle());
  ms.setActionHandler("pause", () => audiobook.pause());
  ms.setActionHandler("seekbackward", () => audiobook.skip(-15));
  ms.setActionHandler("seekforward", () => audiobook.skip(30));
  ms.setActionHandler("previoustrack", () => audiobook.skip(-15));
  ms.setActionHandler("nexttrack", () => audiobook.skip(30));
  ms.setActionHandler("seekto", (d) => d.seekTime !== undefined && audiobook.seek(d.seekTime));
}

window.addEventListener("beforeunload", () => void save());
