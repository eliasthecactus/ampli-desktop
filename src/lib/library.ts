// The synced library, kept in IndexedDB and in memory (browsing and search work offline and instantly).
import { create } from "zustand";
import { account, bookClient, musicClient, servers, useAccounts } from "./accounts";
import { clearServer, db, type PlayRecord } from "./db";
import { toast } from "./nav";
import type { FavoriteTarget } from "./servers/client";
import { settings } from "./settings";
import { hasBooks, hasMusic, type Album, type Artist, type Book, type Playlist, type Song } from "./types";

export interface SyncStatus {
  phase: string;
  loaded?: number;
  total?: number;
}

interface LibraryState {
  loaded: boolean;
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  books: Book[];
  plays: PlayRecord[];
  syncing: Record<string, SyncStatus>;
  /** Bumped when anything changes, for memoized views. */
  version: number;
}

export const useLibrary = create<LibraryState>(() => ({
  loaded: false,
  songs: [],
  albums: [],
  artists: [],
  playlists: [],
  books: [],
  plays: [],
  syncing: {},
  version: 0,
}));

// Indexes, rebuilt with the data.
export const index = {
  song: new Map<string, Song>(),
  album: new Map<string, Album>(),
  artist: new Map<string, Artist>(),
  playlist: new Map<string, Playlist>(),
  book: new Map<string, Book>(),
  albumSongs: new Map<string, Song[]>(),
  artistSongs: new Map<string, Song[]>(),
  artistAlbums: new Map<string, Album[]>(),
  genres: new Map<string, Song[]>(),
};

const bySongOrder = (a: Song, b: Song) => (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? 0) - (b.track ?? 0) || a.title.localeCompare(b.title);

function rebuild() {
  const s = useLibrary.getState();
  index.song = new Map(s.songs.map((x) => [x.key, x]));
  index.album = new Map(s.albums.map((x) => [x.key, x]));
  index.artist = new Map(s.artists.map((x) => [x.key, x]));
  index.playlist = new Map(s.playlists.map((x) => [x.key, x]));
  index.book = new Map(s.books.map((x) => [x.key, x]));
  const albumSongs = new Map<string, Song[]>();
  const artistSongs = new Map<string, Song[]>();
  const genres = new Map<string, Song[]>();
  const push = <K>(m: Map<K, Song[]>, k: K, v: Song) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const song of s.songs) {
    if (song.albumId) push(albumSongs, `${song.serverId}|${song.albumId}`, song);
    if (song.artistId) push(artistSongs, `${song.serverId}|${song.artistId}`, song);
    if (song.genre) push(genres, song.genre, song);
  }
  for (const list of albumSongs.values()) list.sort(bySongOrder);
  const artistAlbums = new Map<string, Album[]>();
  for (const album of s.albums) {
    if (album.artistId) {
      const k = `${album.serverId}|${album.artistId}`;
      artistAlbums.set(k, [...(artistAlbums.get(k) ?? []), album]);
    }
  }
  // Albums an artist only appears on (features, compilations).
  for (const [artistKey, songs] of artistSongs) {
    const known = new Set((artistAlbums.get(artistKey) ?? []).map((a) => a.key));
    for (const song of songs) {
      const albumKey = song.albumId ? `${song.serverId}|${song.albumId}` : undefined;
      const album = albumKey ? index.album.get(albumKey) : undefined;
      if (album && !known.has(album.key)) {
        known.add(album.key);
        artistAlbums.set(artistKey, [...(artistAlbums.get(artistKey) ?? []), album]);
      }
    }
  }
  for (const list of artistAlbums.values()) list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name));
  index.albumSongs = albumSongs;
  index.artistSongs = artistSongs;
  index.artistAlbums = artistAlbums;
  index.genres = genres;
}

function publish(patch: Partial<LibraryState>) {
  useLibrary.setState((s) => ({ ...patch, version: s.version + 1 }));
  rebuild();
}

export async function loadLibrary() {
  const known = new Set(servers().map((a) => a.id));
  const keep = <T extends { serverId: string }>(list: T[]) => list.filter((x) => known.has(x.serverId));
  const [songs, albums, artists, playlists, books, plays] = await Promise.all([
    db.songs.toArray(),
    db.albums.toArray(),
    db.artists.toArray(),
    db.playlists.toArray(),
    db.books.toArray(),
    db.plays.orderBy("at").reverse().limit(2000).toArray(),
  ]);
  publish({ loaded: true, songs: keep(songs), albums: keep(albums), artists: keep(artists), playlists: keep(playlists), books: keep(books), plays });
}

export const albumSongs = (albumKey: string) => index.albumSongs.get(albumKey) ?? [];
export const playlistSongs = (p: Playlist) => p.songIds.map((id) => index.song.get(`${p.serverId}|${id}`)).filter((s): s is Song => !!s);

function setStatus(serverId: string, status: SyncStatus | null) {
  useLibrary.setState((s) => {
    const syncing = { ...s.syncing };
    if (status) syncing[serverId] = status;
    else delete syncing[serverId];
    return { syncing };
  });
}

const running = new Set<string>();

/** Loads everything of one server and replaces what's stored. */
export async function syncServer(serverId: string): Promise<void> {
  const a = account(serverId);
  if (!a || running.has(serverId) || a.kind === "amplicon") return;
  running.add(serverId);
  const s = settings();
  const update = useAccounts.getState().update;
  try {
    setStatus(serverId, { phase: "Libraries" });
    const music = hasMusic(a.kind) && s.showMusic ? musicClient(serverId) : null;
    const books = hasBooks(a.kind) && (s.showBooks || s.showAudiobooks) ? bookClient(serverId) : null;
    if (!music && !books && !musicClient(serverId) && !bookClient(serverId)) throw new Error("Sign in to this server again.");

    const libraries = [
      ...(hasMusic(a.kind) ? ((await musicClient(serverId)?.libraries()) ?? []) : []),
      ...(hasBooks(a.kind) ? ((await bookClient(serverId)?.bookLibraries()) ?? []) : []),
    ];
    update(serverId, { libraries });
    const selected = a.selectedLibraryIds.filter((id) => libraries.some((l) => l.id === id));
    const musicLibs = selected.filter((id) => libraries.find((l) => l.id === id)?.kind === "music");
    const bookLibs = selected.filter((id) => libraries.find((l) => l.id === id)?.kind === "books");
    // Something selected, but none of this kind: that kind is off for this server.
    const musicOff = selected.length > 0 && musicLibs.length === 0;
    const booksOff = selected.length > 0 && bookLibs.length === 0;

    let songs: Song[] = [];
    let albums: Album[] = [];
    let artists: Artist[] = [];
    let playlists: Playlist[] = [];
    let bookList: Book[] = [];

    if (music && !musicOff && libraries.some((l) => l.kind === "music")) {
      setStatus(serverId, { phase: "Artists" });
      artists = await music.artists(musicLibs);
      setStatus(serverId, { phase: "Albums" });
      albums = await music.albums(musicLibs);
      setStatus(serverId, { phase: "Songs", loaded: 0 });
      songs = await music.songs(musicLibs, (loaded, total) => setStatus(serverId, { phase: "Songs", loaded, total }));
      setStatus(serverId, { phase: "Playlists" });
      playlists = await music.playlists();
      const songIds = new Set(songs.map((x) => x.id));
      for (const [i, p] of playlists.entries()) {
        setStatus(serverId, { phase: "Playlists", loaded: i, total: playlists.length });
        const entries = await music.playlistEntries(p.id).catch(() => []);
        // Songs of libraries that aren't synced stay out.
        const kept = entries.filter((e) => songIds.has(e.songId));
        p.songIds = kept.map((e) => e.songId);
        p.entryIds = entries.length === kept.length ? kept.map((e) => e.entryId) : undefined;
        p.songCount = p.songIds.length;
      }
    }
    if (books && !booksOff && libraries.some((l) => l.kind === "books")) {
      setStatus(serverId, { phase: "Books" });
      bookList = await books.books(bookLibs);
    }

    setStatus(serverId, { phase: "Saving" });
    await clearServer(serverId);
    await db.transaction("rw", [db.songs, db.albums, db.artists, db.playlists, db.books], async () => {
      await db.songs.bulkPut(songs);
      await db.albums.bulkPut(albums);
      await db.artists.bulkPut(artists);
      await db.playlists.bulkPut(playlists);
      await db.books.bulkPut(bookList);
    });
    const st = useLibrary.getState();
    const other = <T extends { serverId: string }>(list: T[]) => list.filter((x) => x.serverId !== serverId);
    publish({
      songs: [...other(st.songs), ...songs],
      albums: [...other(st.albums), ...albums],
      artists: [...other(st.artists), ...artists],
      playlists: [...other(st.playlists), ...playlists],
      books: [...other(st.books), ...bookList],
    });
    update(serverId, { lastSync: Date.now(), lastSyncError: undefined, songCount: songs.length, albumCount: albums.length, bookCount: bookList.length });
    void import("./downloads").then((d) => d.autoDownloadFavorites());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    update(serverId, { lastSyncError: message });
    toast(`${a.name}: ${message}`, "error");
  } finally {
    running.delete(serverId);
    setStatus(serverId, null);
  }
}

export async function syncAll() {
  if (settings().offlineMode) return;
  await Promise.all(servers().map((a) => syncServer(a.id)));
}

export async function forgetServer(serverId: string) {
  await clearServer(serverId);
  const st = useLibrary.getState();
  const other = <T extends { serverId: string }>(list: T[]) => list.filter((x) => x.serverId !== serverId);
  publish({ songs: other(st.songs), albums: other(st.albums), artists: other(st.artists), playlists: other(st.playlists), books: other(st.books) });
}

// MARK: Favourites, plays, playlists

export async function setFavorite(target: FavoriteTarget, key: string, favorite: boolean) {
  const [serverId, id] = splitKey(key);
  const client = musicClient(serverId);
  if (!client) return;
  const flag = favorite ? 1 : 0;
  const st = useLibrary.getState();
  if (target === "song") {
    publish({ songs: st.songs.map((s) => (s.key === key ? { ...s, favorite: flag } : s)) });
    await db.songs.update(key, { favorite: flag });
  } else if (target === "album") {
    publish({ albums: st.albums.map((s) => (s.key === key ? { ...s, favorite: flag } : s)) });
    await db.albums.update(key, { favorite: flag });
  } else {
    publish({ artists: st.artists.map((s) => (s.key === key ? { ...s, favorite: flag } : s)) });
    await db.artists.update(key, { favorite: flag });
  }
  try {
    await client.setFavorite(favorite, id, target);
    if (favorite && target === "song") void import("./downloads").then((d) => d.autoDownloadFavorites());
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function splitKey(key: string): [string, string] {
  const at = key.indexOf("|");
  return [key.slice(0, at), key.slice(at + 1)];
}

export async function recordPlay(key: string, serverId: string, albumKey?: string) {
  const record: PlayRecord = { key, serverId, albumKey, at: Date.now() };
  record.id = await db.plays.add(record);
  const st = useLibrary.getState();
  const song = index.song.get(key);
  useLibrary.setState({
    plays: [record, ...st.plays].slice(0, 2000),
    songs: song ? st.songs.map((s) => (s.key === key ? { ...s, playCount: s.playCount + 1 } : s)) : st.songs,
  });
  if (song) {
    song.playCount += 1;
    await db.songs.update(key, { playCount: song.playCount });
  }
}

async function refreshPlaylist(serverId: string, playlistId: string) {
  const client = musicClient(serverId);
  if (!client) return;
  const key = `${serverId}|${playlistId}`;
  const entries = await client.playlistEntries(playlistId);
  const st = useLibrary.getState();
  const existing = st.playlists.find((p) => p.key === key);
  const fresh = (await client.playlists()).find((p) => p.id === playlistId);
  const playlist: Playlist = {
    ...(existing ?? fresh ?? { key, serverId, id: playlistId, name: "Playlist", songCount: 0, duration: 0 }),
    ...(fresh ? { name: fresh.name, artworkId: fresh.artworkId, duration: fresh.duration } : {}),
    songIds: entries.map((e) => e.songId),
    entryIds: entries.map((e) => e.entryId),
    songCount: entries.length,
  };
  await db.playlists.put(playlist);
  publish({ playlists: existing ? st.playlists.map((p) => (p.key === key ? playlist : p)) : [...st.playlists, playlist] });
  return playlist;
}

const entriesOf = (p: Playlist) => p.songIds.map((songId, i) => ({ songId, entryId: p.entryIds?.[i] }));

export async function createPlaylist(serverId: string, name: string, songIds: string[]) {
  const client = musicClient(serverId)!;
  const id = await client.createPlaylist(name, songIds);
  const p = await refreshPlaylist(serverId, id);
  if (p && p.name !== name) {
    p.name = name;
    await db.playlists.put(p);
  }
  return id;
}

export async function renamePlaylist(p: Playlist, name: string) {
  await musicClient(p.serverId)!.renamePlaylist(p.id, name);
  const updated = { ...p, name };
  await db.playlists.put(updated);
  publish({ playlists: useLibrary.getState().playlists.map((x) => (x.key === p.key ? updated : x)) });
}

export async function deletePlaylist(p: Playlist) {
  await musicClient(p.serverId)!.deletePlaylist(p.id);
  await db.playlists.delete(p.key);
  publish({ playlists: useLibrary.getState().playlists.filter((x) => x.key !== p.key) });
}

export async function addToPlaylist(p: Playlist, songIds: string[]) {
  await musicClient(p.serverId)!.addToPlaylist(p.id, songIds);
  await refreshPlaylist(p.serverId, p.id);
}

export async function removeFromPlaylist(p: Playlist, indexes: number[]) {
  await musicClient(p.serverId)!.removeFromPlaylist(p.id, entriesOf(p), indexes);
  await refreshPlaylist(p.serverId, p.id);
}

export async function movePlaylistEntry(p: Playlist, from: number, to: number) {
  // Show the new order right away; the server's answer replaces it.
  const ids = [...p.songIds];
  const entries = [...(p.entryIds ?? ids.map(() => undefined))];
  ids.splice(to, 0, ...ids.splice(from, 1));
  entries.splice(to, 0, ...entries.splice(from, 1));
  publish({ playlists: useLibrary.getState().playlists.map((x) => (x.key === p.key ? { ...p, songIds: ids, entryIds: entries } : x)) });
  try {
    await musicClient(p.serverId)!.movePlaylistEntry(p.id, entriesOf(p), from, to);
  } finally {
    await refreshPlaylist(p.serverId, p.id);
  }
}

/** Updates a book's progress locally after the player or reader saved it. */
export async function setBookProgress(key: string, patch: Partial<NonNullable<Book["progress"]>>) {
  const st = useLibrary.getState();
  const book = st.books.find((b) => b.key === key);
  if (!book) return;
  const progress = { progress: 0, currentTime: 0, isFinished: false, ...book.progress, ...patch, updatedAt: Date.now() };
  const updated = { ...book, progress };
  await db.books.put(updated);
  publish({ books: st.books.map((b) => (b.key === key ? updated : b)) });
}
