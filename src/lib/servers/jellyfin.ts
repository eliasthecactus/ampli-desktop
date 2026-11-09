// Jellyfin's REST API for music and book libraries. Tested against Jellyfin 10.9 to 12.
import { appVersion, deviceId, deviceName, join, json, parseDate, query, request, type Connection } from "../http";
import { md5 } from "../md5";
import type { Album, Artist, AudiobookChapter, AudiobookDetail, AudiobookTrack, Book, Playlist, RemoteLibrary, Song } from "../types";
import { ServerError } from "../types";
import { changedOnServer, type BookClient, type FavoriteTarget, type MusicClient, type PlaylistEntry } from "./client";

const PAGE = 500;
/** Containers the web view plays directly; everything else becomes MP3. */
const DIRECT = "mp3,aac,m4a|aac,m4b|aac,flac,wav,ogg,opus,webm|opus";
const BOOK_TICKS = 10_000_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Item = Record<string, any>;

const seconds = (ticks?: number) => (ticks ?? 0) / 10_000_000;
const hasPrimary = (item: Item) => Object.keys(item.ImageTags ?? {}).some((k) => k.toLowerCase() === "primary");

/** Jellyfin's header parser breaks on quotes, commas and non-ASCII characters. */
export function headerSafe(name: string): string {
  const safe = name
    .replace(/[\u2018\u2019]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]|["\\,]/g, "")
    .trim();
  return safe || "Device";
}

export function authorization(token?: string): string {
  let value = `MediaBrowser Client="Ampli", Device="${headerSafe(deviceName())}", DeviceId="${deviceId()}", Version="${appVersion}"`;
  if (token) value += `, Token="${token}"`;
  return value;
}

export async function signInJellyfin(conn: Connection, username: string, password: string) {
  const info = await json<Item>(conn, join(conn.url, "System/Info/Public"), { headers: { Authorization: authorization() } }).catch((e) => {
    if (e instanceof ServerError && (e.kind === "certificate" || e.kind === "insecure")) throw e;
    return null;
  });
  if (info && info.ProductName && !String(info.ProductName).toLowerCase().includes("jellyfin")) {
    throw new ServerError("This isn't a Jellyfin server.", "unsupported");
  }
  const result = await json<Item>(conn, join(conn.url, "Users/AuthenticateByName"), {
    method: "POST",
    headers: { Authorization: authorization() },
    body: { Username: username, Pw: password },
  }).catch((e) => {
    if (e instanceof ServerError && e.status === 400) throw new ServerError("Wrong username or password.", "unauthorized");
    throw e;
  });
  return { token: result.AccessToken as string, userId: result.User.Id as string, serverName: info?.ServerName as string | undefined };
}

/** Jellyfin lists every audiobook file as its own item; files in the same folder and album become one book. */
export function audiobookId(item: Item): string {
  if (!item.ParentId) return item.Id;
  const album = item.Album ?? item.Name ?? item.Id;
  return `folder:${item.ParentId}:${md5(album).slice(0, 12)}`;
}

function parseAudiobookId(id: string): string | null {
  const parts = id.split(":");
  return parts.length === 3 && parts[0] === "folder" ? parts[1] : null;
}

const sortTracks = (files: Item[]) =>
  [...files].sort(
    (a, b) =>
      (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) ||
      (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0) ||
      String(a.Path ?? "").localeCompare(String(b.Path ?? "")),
  );

/** "Title - Author.epub" → "Author". */
export function authorFromFileName(file: string, title: string): string | undefined {
  const name = file.replace(/\.[^.]+$/, "");
  const at = name.lastIndexOf(" - ");
  if (at < 0) return undefined;
  const author = name.slice(at + 3).trim();
  return !author || author === title ? undefined : author;
}

export class JellyfinClient implements MusicClient, BookClient {
  constructor(
    readonly conn: Connection,
    readonly serverId: string,
    readonly userId: string,
    readonly token: string,
  ) {}

  get headers() {
    return { Authorization: authorization(this.token) };
  }

  private url(path: string, params: [string, string | number | undefined][] = []) {
    return join(this.conn.url, path) + query(params);
  }

  private get<T = Item>(path: string, params: [string, string | number | undefined][] = []) {
    return json<T>(this.conn, this.url(path, params), { headers: this.headers });
  }

  private async send(method: string, path: string, params: [string, string | number | undefined][] = [], body?: unknown) {
    await request(this.conn, this.url(path, params), { method, headers: this.headers, body });
  }

  private async paged(path: string, params: [string, string | number | undefined][], handle: (items: Item[], total?: number) => void) {
    let start = 0;
    for (;;) {
      const page = await this.get(path, [...params, ["startIndex", start], ["limit", PAGE]]);
      const items: Item[] = page.Items ?? [];
      handle(items, page.TotalRecordCount);
      start += items.length;
      if (items.length < PAGE || start >= (page.TotalRecordCount ?? Infinity)) break;
    }
  }

  private async views() {
    return ((await this.get("UserViews", [["userId", this.userId]])).Items ?? []) as Item[];
  }

  async libraries(): Promise<RemoteLibrary[]> {
    return (await this.views()).filter((v) => v.CollectionType === "music").map((v) => ({ id: v.Id, name: v.Name ?? "Music", kind: "music" }));
  }

  private async resolve(libraries: string[]) {
    return libraries.length ? libraries : (await this.libraries()).map((l) => l.id);
  }

  private key(id: string) {
    return `${this.serverId}|${id}`;
  }

  async artists(libraries: string[]): Promise<Artist[]> {
    const result = new Map<string, Artist>();
    for (const library of await this.resolve(libraries)) {
      await this.paged("Artists/AlbumArtists", [["userId", this.userId], ["parentId", library], ["fields", "SortName"]], (items) => {
        for (const item of items)
          result.set(item.Id, {
            key: this.key(item.Id),
            serverId: this.serverId,
            id: item.Id,
            name: item.Name ?? "",
            albumCount: item.AlbumCount ?? 0,
            artworkId: hasPrimary(item) ? item.Id : undefined,
            favorite: item.UserData?.IsFavorite ? 1 : 0,
          });
      });
    }
    return [...result.values()];
  }

  album(item: Item): Album {
    return {
      key: this.key(item.Id),
      serverId: this.serverId,
      id: item.Id,
      name: item.Name ?? "",
      artistName: item.AlbumArtist ?? item.AlbumArtists?.[0]?.Name ?? item.Artists?.[0] ?? "",
      artistId: item.AlbumArtists?.[0]?.Id,
      year: item.ProductionYear,
      genre: item.Genres?.[0],
      artworkId: hasPrimary(item) ? item.Id : undefined,
      songCount: item.ChildCount ?? 0,
      duration: seconds(item.RunTimeTicks),
      dateAdded: parseDate(item.DateCreated),
      favorite: item.UserData?.IsFavorite ? 1 : 0,
    };
  }

  song(item: Item, libraryId?: string): Song {
    const artwork = hasPrimary(item) ? item.Id : item.AlbumPrimaryImageTag ? item.AlbumId : undefined;
    return {
      key: this.key(item.Id),
      serverId: this.serverId,
      id: item.Id,
      title: item.Name ?? "",
      albumId: item.AlbumId,
      albumName: item.Album,
      artistName: (item.Artists ?? []).join(", ") || item.AlbumArtist || "",
      artistId: item.ArtistItems?.[0]?.Id ?? item.AlbumArtists?.[0]?.Id,
      albumArtistName: item.AlbumArtist,
      track: item.IndexNumber,
      disc: item.ParentIndexNumber,
      duration: seconds(item.RunTimeTicks),
      suffix: item.Container,
      artworkId: artwork,
      genre: item.Genres?.[0],
      year: item.ProductionYear,
      dateAdded: parseDate(item.DateCreated),
      favorite: item.UserData?.IsFavorite ? 1 : 0,
      playCount: item.UserData?.PlayCount ?? 0,
      gain: item.NormalizationGain,
      libraryId,
    };
  }

  async albums(libraries: string[]): Promise<Album[]> {
    const result: Album[] = [];
    for (const library of await this.resolve(libraries)) {
      await this.paged(
        "Items",
        [["userId", this.userId], ["parentId", library], ["includeItemTypes", "MusicAlbum"], ["recursive", "true"], ["fields", "DateCreated,Genres,ChildCount"], ["sortBy", "SortName"], ["enableImageTypes", "Primary"]],
        (items) => result.push(...items.map((i) => this.album(i))),
      );
    }
    return result;
  }

  async songs(libraries: string[], progress: (loaded: number, total?: number) => void): Promise<Song[]> {
    const result: Song[] = [];
    for (const library of await this.resolve(libraries)) {
      await this.paged(
        "Items",
        [["userId", this.userId], ["parentId", library], ["includeItemTypes", "Audio"], ["recursive", "true"], ["fields", "DateCreated,Genres"], ["sortBy", "SortName"], ["enableImageTypes", "Primary"]],
        (items, total) => {
          result.push(...items.map((i) => this.song(i, library)));
          progress(result.length, total);
        },
      );
    }
    return result;
  }

  async playlists(): Promise<Playlist[]> {
    const result: Playlist[] = [];
    await this.paged("Items", [["userId", this.userId], ["includeItemTypes", "Playlist"], ["recursive", "true"], ["mediaTypes", "Audio"], ["fields", "ChildCount,DateCreated"]], (items) =>
      result.push(
        ...items.map((p) => ({
          key: this.key(p.Id),
          serverId: this.serverId,
          id: p.Id,
          name: p.Name ?? "",
          songCount: p.ChildCount ?? 0,
          duration: seconds(p.RunTimeTicks),
          artworkId: hasPrimary(p) ? p.Id : undefined,
          dateAdded: parseDate(p.DateCreated),
          songIds: [],
        })),
      ),
    );
    return result;
  }

  async playlistEntries(id: string): Promise<PlaylistEntry[]> {
    const res = await this.get(`Playlists/${id}/Items`, [["userId", this.userId]]);
    return ((res.Items ?? []) as Item[]).map((i) => ({ songId: i.Id, entryId: i.PlaylistItemId }));
  }

  readonly canEditPlaylists = true;

  async createPlaylist(name: string, songIds: string[]) {
    const res = await json<Item>(this.conn, this.url("Playlists"), {
      method: "POST",
      headers: this.headers,
      body: { Name: name, Ids: songIds, UserId: this.userId, MediaType: "Audio" },
    });
    return res.Id as string;
  }

  renamePlaylist(id: string, name: string) {
    return this.send("POST", `Playlists/${id}`, [], { Name: name });
  }

  deletePlaylist(id: string) {
    return this.send("DELETE", `Items/${id}`);
  }

  async addToPlaylist(id: string, songIds: string[]) {
    for (let i = 0; i < songIds.length; i += 100) {
      await this.send("POST", `Playlists/${id}/Items`, [["ids", songIds.slice(i, i + 100).join(",")], ["userId", this.userId]]);
    }
  }

  async removeFromPlaylist(id: string, entries: PlaylistEntry[], indexes: number[]) {
    const ids = indexes.map((i) => entries[i]?.entryId).filter((x): x is string => !!x);
    if (ids.length !== indexes.length) throw changedOnServer();
    await this.send("DELETE", `Playlists/${id}/Items`, [["entryIds", ids.join(",")]]);
  }

  async movePlaylistEntry(id: string, entries: PlaylistEntry[], from: number, to: number) {
    const entry = entries[from]?.entryId;
    if (!entry) throw changedOnServer();
    await this.send("POST", `Playlists/${id}/Items/${entry}/Move/${Math.max(to, 0)}`);
  }

  streamURL(songId: string, _suffix: string | undefined, maxBitRate: number | undefined) {
    return this.url(`Audio/${songId}/universal`, [
      ["UserId", this.userId],
      ["DeviceId", deviceId()],
      ["ApiKey", this.token],
      ["MaxStreamingBitrate", maxBitRate ? maxBitRate * 1000 : 999_999_999],
      ["Container", DIRECT],
      ["TranscodingContainer", "mp3"],
      ["TranscodingProtocol", "http"],
      ["AudioCodec", "mp3"],
      ["EnableRedirection", "true"],
      ["EnableRemoteMedia", "false"],
    ]);
  }

  downloadURL(songId: string, suffix: string | undefined, maxBitRate: number | undefined) {
    return this.streamURL(songId, suffix, maxBitRate);
  }

  artworkURL(id: string, size: number) {
    return this.url(`Items/${id}/Images/Primary`, [["fillWidth", size], ["fillHeight", size], ["quality", 90]]);
  }

  async setFavorite(favorite: boolean, id: string, _target: FavoriteTarget) {
    try {
      await this.send(favorite ? "POST" : "DELETE", `UserFavoriteItems/${id}`, [["userId", this.userId]]);
    } catch (e) {
      if (e instanceof ServerError && e.status === 404) {
        await this.send(favorite ? "POST" : "DELETE", `Users/${this.userId}/FavoriteItems/${id}`);
      } else throw e;
    }
  }

  async reportNowPlaying(songId: string) {
    await this.send("POST", "Sessions/Playing", [], { ItemId: songId, CanSeek: true, PlayMethod: "DirectStream" }).catch(() => {});
  }

  async reportPlayed(songId: string, position: number) {
    await this.send("POST", "Sessions/Playing/Stopped", [], { ItemId: songId, PositionTicks: Math.round(position * 10_000_000) }).catch(() => {});
  }

  // MARK: Books

  async bookLibraries(): Promise<RemoteLibrary[]> {
    return (await this.views()).filter((v) => v.CollectionType === "books").map((v) => ({ id: v.Id, name: v.Name ?? "Books", kind: "books" }));
  }

  async books(libraries: string[]): Promise<Book[]> {
    const selected = libraries.length ? libraries : (await this.bookLibraries()).map((l) => l.id);
    const result: Book[] = [];
    for (const library of selected) {
      const all: Item[] = [];
      await this.paged(
        "Items",
        [["userId", this.userId], ["parentId", library], ["includeItemTypes", "Book,AudioBook"], ["recursive", "true"], ["fields", "DateCreated,Overview,Path,ParentId,Genres"], ["sortBy", "SortName"], ["enableImageTypes", "Primary"]],
        (items) => all.push(...items),
      );
      result.push(...all.filter((i) => i.Type === "Book").map((i) => this.ebook(i, library)));
      const groups = new Map<string, Item[]>();
      for (const file of all.filter((i) => i.Type === "AudioBook")) {
        const id = audiobookId(file);
        groups.set(id, [...(groups.get(id) ?? []), file]);
      }
      for (const [id, files] of groups) result.push(this.audiobook(id, sortTracks(files), library));
    }
    return result;
  }

  private ebook(item: Item, library: string): Book {
    const file = String(item.Path ?? "").split(/[\\/]/).pop() ?? "";
    const format = file.split(".").pop()?.toLowerCase() ?? "";
    const title = item.Name ?? file;
    const book: Book = {
      key: this.key(item.Id),
      serverId: this.serverId,
      id: item.Id,
      libraryId: library,
      title,
      author: item.AlbumArtist ?? item.Artists?.[0] ?? authorFromFileName(file, title) ?? "",
      year: item.ProductionYear,
      overview: item.Overview,
      artworkId: hasPrimary(item) ? item.Id : undefined,
      ebookFormat: ["epub", "pdf", "cbz"].includes(format) ? format : undefined,
      hasAudio: false,
      duration: 0,
      dateAdded: parseDate(item.DateCreated),
    };
    const data = item.UserData;
    const ticks = data?.PlaybackPositionTicks ?? 0;
    if (data && (data.Played || (data.PlayedPercentage ?? 0) > 0 || ticks > 0)) {
      const fraction = data.Played
        ? 1
        : data.PlayedPercentage != null
          ? data.PlayedPercentage / 100
          : Math.min(ticks / Math.max(item.RunTimeTicks ?? BOOK_TICKS, 1), 1);
      book.progress = { progress: fraction, currentTime: 0, ebookProgress: fraction, isFinished: !!data.Played, updatedAt: parseDate(data.LastPlayedDate) };
    }
    return book;
  }

  private audiobook(id: string, files: Item[], library: string): Book {
    const first = files[0];
    const book: Book = {
      key: this.key(id),
      serverId: this.serverId,
      id,
      libraryId: library,
      title: first.Album ?? first.Name ?? "",
      author: first.AlbumArtist ?? first.Artists?.[0] ?? "",
      year: first.ProductionYear,
      overview: first.Overview,
      artworkId: files.find(hasPrimary)?.Id ?? first.ParentId,
      hasAudio: true,
      duration: files.reduce((s, f) => s + seconds(f.RunTimeTicks), 0),
      dateAdded: Math.min(...files.map((f) => parseDate(f.DateCreated) ?? Infinity)),
    };
    if (!Number.isFinite(book.dateAdded)) book.dateAdded = undefined;
    let position = 0;
    let any = false;
    for (const file of files) {
      if (file.UserData?.Played) {
        position += seconds(file.RunTimeTicks);
        any = true;
      } else if ((file.UserData?.PlaybackPositionTicks ?? 0) > 0) {
        position += seconds(file.UserData.PlaybackPositionTicks);
        any = true;
        break;
      } else break;
    }
    if (any) {
      book.progress = {
        progress: book.duration > 0 ? Math.min(position / book.duration, 1) : 0,
        currentTime: position,
        isFinished: files.every((f) => f.UserData?.Played),
      };
    }
    return book;
  }

  async audiobookDetail(bookId: string): Promise<AudiobookDetail> {
    const parent = parseAudiobookId(bookId);
    let files: Item[];
    if (parent) {
      const res = await this.get("Items", [["userId", this.userId], ["parentId", parent], ["includeItemTypes", "AudioBook"], ["recursive", "true"], ["fields", "Chapters,Path,ParentId"]]);
      files = sortTracks(((res.Items ?? []) as Item[]).filter((i) => audiobookId(i) === bookId));
    } else {
      files = (await this.get("Items", [["userId", this.userId], ["ids", bookId], ["fields", "Chapters,Path"]])).Items ?? [];
    }
    const tracks: AudiobookTrack[] = [];
    const chapters: AudiobookChapter[] = [];
    let offset = 0;
    for (const file of files) {
      const duration = seconds(file.RunTimeTicks);
      tracks.push({ id: file.Id, startOffset: offset, duration, suffix: String(file.Path ?? "").split(".").pop()?.toLowerCase() });
      const marks: Item[] = file.Chapters ?? [];
      if (marks.length > 1) {
        marks.forEach((mark, i) => {
          const start = offset + seconds(mark.StartPositionTicks);
          const end = i + 1 < marks.length ? offset + seconds(marks[i + 1].StartPositionTicks) : offset + duration;
          chapters.push({ title: mark.Name ?? String(i + 1), start, end });
        });
      } else if (files.length > 1) {
        chapters.push({ title: file.Name ?? String(tracks.length), start: offset, end: offset + duration });
      }
      offset += duration;
    }
    return { tracks, chapters };
  }

  audioURL(_bookId: string, track: AudiobookTrack) {
    return this.streamURL(track.id, track.suffix, undefined);
  }

  ebookURL(bookId: string) {
    return this.url(`Items/${bookId}/Download`, [["ApiKey", this.token]]);
  }

  coverURL(id: string, size: number) {
    return this.url(`Items/${id}/Images/Primary`, [["maxWidth", size], ["quality", 90]]);
  }

  async saveAudioProgress(bookId: string, currentTime: number, _duration: number, finished: boolean) {
    const detail = await this.audiobookDetail(bookId);
    const track = [...detail.tracks].reverse().find((t) => t.startOffset <= currentTime) ?? detail.tracks[0];
    if (!track) return;
    await this.send("POST", "Sessions/Playing/Progress", [], {
      ItemId: track.id,
      PositionTicks: Math.round(Math.max(currentTime - track.startOffset, 0) * 10_000_000),
      IsPaused: true,
      CanSeek: true,
    });
    if (finished) await this.send("POST", `UserPlayedItems/${bookId}`, [["userId", this.userId]]);
  }

  /** Jellyfin has no reading position, but keeps a played percentage per item; other devices read it back. */
  async saveEbookProgress(bookId: string, progress: number, finished: boolean) {
    const item = ((await this.get("Items", [["userId", this.userId], ["ids", bookId]])).Items ?? [])[0];
    const runtime = item?.RunTimeTicks ?? BOOK_TICKS;
    const fraction = Math.min(Math.max(progress, 0), 1);
    await this.send("POST", `UserItems/${bookId}/UserData`, [["userId", this.userId]], {
      PlaybackPositionTicks: Math.round(fraction * runtime),
      PlayedPercentage: fraction * 100,
      Played: finished,
      LastPlayedDate: new Date().toISOString(),
    });
  }
}
