// Songs, audiobooks and ebooks saved on this computer for offline listening and reading.
import { create } from "zustand";
import { account, bookClient, musicClient } from "./accounts";
import { db, type DownloadRecord } from "./db";
import { cancelDownload, deleteFile, downloadFile, fileURL, isTauri, listFiles, onDownloadProgress } from "./native";
import { toast } from "./nav";
import { index, useLibrary } from "./library";
import { settings } from "./settings";
import { songToTrack, type Book, type Song, type Track } from "./types";

interface Job {
  key: string;
  title: string;
  subtitle: string;
  received: number;
  total?: number;
  state: "queued" | "running" | "failed";
  error?: string;
}

interface DownloadsState {
  records: Map<string, DownloadRecord>;
  jobs: Job[];
}

export const useDownloads = create<DownloadsState>(() => ({ records: new Map(), jobs: [] }));

type Task = { job: Job; run: () => Promise<void> };
const queue: Task[] = [];
let active = 0;
const MAX = 3;

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

export async function loadDownloads() {
  const records = await db.downloads.toArray();
  // Files deleted outside Ampli are forgotten.
  const files = await listFiles();
  const kept = isTauri ? records.filter((r) => r.fileName in files) : records;
  const gone = records.filter((r) => !kept.includes(r));
  if (gone.length) await db.downloads.bulkDelete(gone.map((r) => r.key));
  useDownloads.setState({ records: new Map(kept.map((r) => [r.key, r])) });
  onDownloadProgress(({ id, received, total }) =>
    useDownloads.setState((s) => ({ jobs: s.jobs.map((j) => (j.key === id ? { ...j, received, total: total ?? undefined } : j)) })),
  );
}

export const isDownloaded = (key: string) => useDownloads.getState().records.has(key);
export const downloadedURL = (key: string) => {
  const r = useDownloads.getState().records.get(key);
  return r ? fileURL(r.fileName) : null;
};

function enqueue(job: Job, run: () => Promise<void>) {
  const st = useDownloads.getState();
  if (st.records.has(job.key) || st.jobs.some((j) => j.key === job.key && j.state !== "failed")) return;
  useDownloads.setState({ jobs: [...st.jobs.filter((j) => j.key !== job.key), job] });
  queue.push({ job, run });
  pump();
}

function pump() {
  while (active < MAX && queue.length) {
    const task = queue.shift()!;
    active++;
    setJob(task.job.key, { state: "running" });
    task
      .run()
      .then(() => useDownloads.setState((s) => ({ jobs: s.jobs.filter((j) => j.key !== task.job.key) })))
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        if (message === "cancelled") useDownloads.setState((s) => ({ jobs: s.jobs.filter((j) => j.key !== task.job.key) }));
        else setJob(task.job.key, { state: "failed", error: message });
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

function setJob(key: string, patch: Partial<Job>) {
  useDownloads.setState((s) => ({ jobs: s.jobs.map((j) => (j.key === key ? { ...j, ...patch } : j)) }));
}

async function save(record: DownloadRecord) {
  await db.downloads.put(record);
  useDownloads.setState((s) => ({ records: new Map(s.records).set(record.key, record) }));
}

export function downloadTracks(tracks: Track[]) {
  if (!isTauri) return toast("Downloads need the desktop app.", "error");
  const quality = settings().downloadQuality || undefined;
  let added = 0;
  for (const track of tracks) {
    if (track.catalog) continue;
    const client = musicClient(track.serverId);
    const a = account(track.serverId);
    if (!client || !a) continue;
    const ext = quality ? "mp3" : (track.suffix ?? "audio");
    const fileName = safe(`song-${track.serverId}-${track.id}`) + "." + safe(ext);
    added++;
    enqueue({ key: track.key, title: track.title, subtitle: track.artist, received: 0, state: "queued" }, async () => {
      const size = await downloadFile(track.key, client.downloadURL(track.id, track.suffix, quality), fileName, a.pinnedCertificate);
      await save({ key: track.key, kind: "song", serverId: track.serverId, fileName, size, addedAt: Date.now(), track });
    });
  }
  if (added > 1) toast(`Downloading ${added} songs`);
}

export const downloadSongs = (songs: Song[]) => downloadTracks(songs.map(songToTrack));

export function downloadAudiobook(book: Book) {
  if (!isTauri) return toast("Downloads need the desktop app.", "error");
  const client = bookClient(book.serverId);
  const a = account(book.serverId);
  if (!client || !a) return;
  enqueue({ key: `book:${book.key}`, title: book.title, subtitle: book.author, received: 0, state: "queued" }, async () => {
    const detail = await client.audiobookDetail(book.id);
    for (const [i, track] of detail.tracks.entries()) {
      const key = `book:${book.key}:${i}`;
      if (isDownloaded(key)) continue;
      const fileName = safe(`book-${book.serverId}-${book.id}-${i}`) + "." + safe(track.suffix ?? "audio");
      const size = await downloadFile(`book:${book.key}`, client.audioURL(book.id, track), fileName, a.pinnedCertificate);
      await save({ key, kind: "audiobook", serverId: book.serverId, fileName, size, addedAt: Date.now(), bookKey: book.key });
    }
    // Remembers the chapters too, for listening without the server.
    localStorage.setItem(`ampli.audiobook.${book.key}`, JSON.stringify(detail));
    await save({ key: `book:${book.key}`, kind: "audiobook", serverId: book.serverId, fileName: "", size: 0, addedAt: Date.now(), bookKey: book.key });
  });
}

export function downloadEbook(book: Book) {
  if (!isTauri) return toast("Downloads need the desktop app.", "error");
  const client = bookClient(book.serverId);
  const a = account(book.serverId);
  if (!client || !a) return;
  const fileName = safe(`ebook-${book.serverId}-${book.id}`) + "." + safe(book.ebookFormat ?? "epub");
  enqueue({ key: `ebook:${book.key}`, title: book.title, subtitle: book.author, received: 0, state: "queued" }, async () => {
    const size = await downloadFile(`ebook:${book.key}`, client.ebookURL(book.id), fileName, a.pinnedCertificate, client.headers);
    await save({ key: `ebook:${book.key}`, kind: "ebook", serverId: book.serverId, fileName, size, addedAt: Date.now(), bookKey: book.key });
  });
}

export async function removeDownload(key: string) {
  const st = useDownloads.getState();
  const keys = key.startsWith("book:") ? [...st.records.keys()].filter((k) => k === key || k.startsWith(key + ":")) : [key];
  for (const k of keys) {
    const r = st.records.get(k);
    if (r?.fileName) await deleteFile(r.fileName);
    await db.downloads.delete(k);
  }
  useDownloads.setState((s) => {
    const records = new Map(s.records);
    keys.forEach((k) => records.delete(k));
    return { records };
  });
}

export async function removeAllDownloads() {
  for (const key of [...useDownloads.getState().records.keys()]) await removeDownload(key);
}

export function cancelJob(key: string) {
  const at = queue.findIndex((t) => t.job.key === key);
  if (at >= 0) queue.splice(at, 1);
  void cancelDownload(key);
  useDownloads.setState((s) => ({ jobs: s.jobs.filter((j) => j.key !== key) }));
}

export function retryFailed() {
  const failed = useDownloads.getState().jobs.filter((j) => j.state === "failed");
  useDownloads.setState((s) => ({ jobs: s.jobs.filter((j) => j.state !== "failed") }));
  downloadTracks(failed.map((j) => index.song.get(j.key)).filter((s): s is Song => !!s).map(songToTrack));
}

/** With "Download Favourites" on, favourite songs are kept on this computer. */
export function autoDownloadFavorites() {
  if (!settings().downloadFavorites || !isTauri) return;
  const missing = useLibrary.getState().songs.filter((s) => s.favorite && !isDownloaded(s.key));
  if (missing.length) downloadSongs(missing);
}

export function totalSize() {
  let total = 0;
  for (const r of useDownloads.getState().records.values()) total += r.size;
  return total;
}
