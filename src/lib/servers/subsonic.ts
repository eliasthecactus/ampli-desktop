// The (Open)Subsonic API: Navidrome, Gonic, Airsonic-Advanced, Ampache and others.
import { join, json, parseDate, query, type Connection } from "../http";
import { md5 } from "../md5";
import type { Album, Artist, Playlist, RemoteLibrary, Song } from "../types";
import { ServerError } from "../types";
import { isPlayable, type FavoriteTarget, type MusicClient, type PlaylistEntry } from "./client";

const API_VERSION = "1.16.1";
const PAGE = 500;

export type SubsonicAuth = { t: string; s: string } | { p: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export function tokenAuth(password: string): SubsonicAuth {
  const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return { t: md5(password + salt), s: salt };
}

export function passwordAuth(password: string): SubsonicAuth {
  const hex = Array.from(new TextEncoder().encode(password), (b) => b.toString(16).padStart(2, "0")).join("");
  return { p: "enc:" + hex };
}

export class SubsonicError extends ServerError {
  constructor(
    public code: number,
    message: string,
  ) {
    super(
      code === 40 || code === 44
        ? "Wrong username or password."
        : code === 50
          ? "This account isn't allowed to do that."
          : code === 70
            ? "Not found on the server."
            : message || `The server reported error ${code}.`,
      code === 40 || code === 44 ? "unauthorized" : "server",
    );
  }
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
const int = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Math.trunc(Number(v)) || 0);

export async function signInSubsonic(conn: Connection, username: string, password: string) {
  const token = tokenAuth(password);
  try {
    const name = await new SubsonicClient(conn, "", username, token).ping();
    return { auth: token, serverName: name };
  } catch (e) {
    // Token auth isn't available (LDAP): fall back to the password.
    if (e instanceof SubsonicError && (e.code === 41 || e.code === 42)) {
      const auth = passwordAuth(password);
      const name = await new SubsonicClient(conn, "", username, auth).ping();
      return { auth, serverName: name };
    }
    throw e;
  }
}

export class SubsonicClient implements MusicClient {
  constructor(
    readonly conn: Connection,
    readonly serverId: string,
    readonly username: string,
    readonly auth: SubsonicAuth,
  ) {}

  url(method: string, params: [string, string | number | undefined][] = []) {
    const authParams: [string, string][] = "t" in this.auth ? [["t", this.auth.t], ["s", this.auth.s]] : [["p", this.auth.p]];
    return join(this.conn.url, `rest/${method}.view`) + query([["u", this.username], ...authParams, ["v", API_VERSION], ["c", "Ampli"], ["f", "json"], ...params]);
  }

  async call(method: string, params: [string, string | number | undefined][] = []): Promise<Obj> {
    const body = await json<Obj>(this.conn, this.url(method, params));
    const response = body?.["subsonic-response"];
    if (!response) throw new ServerError("This isn't a Subsonic or Navidrome server.", "unsupported");
    if (response.status !== "ok") throw new SubsonicError(response.error?.code ?? 0, response.error?.message ?? "");
    return response;
  }

  async ping(): Promise<string | undefined> {
    const r = await this.call("ping");
    return r.type ? r.type[0].toUpperCase() + r.type.slice(1) : undefined;
  }

  private key(id: string) {
    return `${this.serverId}|${id}`;
  }

  private folders(libraries: string[]): [string, string][][] {
    return libraries.length ? libraries.map((l) => [["musicFolderId", l]]) : [[]];
  }

  async libraries(): Promise<RemoteLibrary[]> {
    const r = await this.call("getMusicFolders");
    return ((r.musicFolders?.musicFolder ?? []) as Obj[]).map((f) => ({ id: String(f.id), name: f.name ?? "Music", kind: "music" as const }));
  }

  async artists(libraries: string[]): Promise<Artist[]> {
    const result = new Map<string, Artist>();
    for (const folder of this.folders(libraries)) {
      const r = await this.call("getArtists", folder);
      for (const index of r.artists?.index ?? [])
        for (const a of index.artist ?? []) {
          const id = String(a.id);
          result.set(id, {
            key: this.key(id),
            serverId: this.serverId,
            id,
            name: a.name ?? "",
            albumCount: int(a.albumCount) ?? 0,
            artworkId: str(a.coverArt),
            favorite: a.starred ? 1 : 0,
          });
        }
    }
    return [...result.values()];
  }

  album(a: Obj): Album {
    const id = String(a.id);
    return {
      key: this.key(id),
      serverId: this.serverId,
      id,
      name: a.name ?? a.album ?? "",
      artistName: a.displayArtist ?? a.artist ?? "",
      artistId: str(a.artistId),
      year: int(a.year),
      genre: a.genre,
      artworkId: str(a.coverArt),
      songCount: int(a.songCount) ?? 0,
      duration: int(a.duration) ?? 0,
      dateAdded: parseDate(a.created),
      favorite: a.starred ? 1 : 0,
    };
  }

  song(s: Obj, libraryId?: string): Song {
    const id = String(s.id);
    const gain = s.replayGain?.trackGain;
    return {
      key: this.key(id),
      serverId: this.serverId,
      id,
      title: s.title ?? "",
      albumId: str(s.albumId),
      albumName: s.album,
      artistName: s.displayArtist ?? s.artist ?? "",
      artistId: str(s.artistId),
      albumArtistName: s.displayAlbumArtist,
      track: int(s.track),
      disc: int(s.discNumber),
      duration: int(s.duration) ?? 0,
      suffix: s.suffix,
      bitRate: int(s.bitRate),
      size: int(s.size),
      artworkId: str(s.coverArt),
      genre: s.genre,
      year: int(s.year),
      dateAdded: parseDate(s.created),
      favorite: s.starred ? 1 : 0,
      playCount: int(s.playCount) ?? 0,
      gain: gain ? Number(gain) : undefined,
      libraryId,
    };
  }

  async albums(libraries: string[]): Promise<Album[]> {
    const result = new Map<string, Album>();
    for (const folder of this.folders(libraries)) {
      for (let offset = 0; ; ) {
        const r = await this.call("getAlbumList2", [["type", "alphabeticalByName"], ["size", PAGE], ["offset", offset], ...folder]);
        const albums: Obj[] = r.albumList2?.album ?? [];
        for (const a of albums) result.set(String(a.id), this.album(a));
        offset += albums.length;
        if (albums.length < PAGE) break;
      }
    }
    return [...result.values()];
  }

  async songs(libraries: string[], progress: (loaded: number, total?: number) => void): Promise<Song[]> {
    const result = new Map<string, Song>();
    for (const folder of this.folders(libraries)) {
      for (let offset = 0; ; ) {
        const r = await this.call("search3", [["query", ""], ["songCount", PAGE], ["songOffset", offset], ["artistCount", 0], ["albumCount", 0], ...folder]);
        const songs: Obj[] = r.searchResult3?.song ?? [];
        for (const s of songs) result.set(String(s.id), this.song(s, folder[0]?.[1]));
        offset += songs.length;
        progress(result.size);
        if (songs.length < PAGE) break;
      }
    }
    if (result.size === 0) {
      // Servers that don't list everything for an empty search: go album by album.
      const albums = await this.albums(libraries);
      for (const [i, album] of albums.entries()) {
        const r = await this.call("getAlbum", [["id", album.id]]);
        for (const s of r.album?.song ?? []) result.set(String(s.id), this.song(s));
        progress(result.size, i === albums.length - 1 ? result.size : undefined);
      }
    }
    return [...result.values()];
  }

  async playlists(): Promise<Playlist[]> {
    const r = await this.call("getPlaylists");
    return ((r.playlists?.playlist ?? []) as Obj[]).map((p) => {
      const id = String(p.id);
      return {
        key: this.key(id),
        serverId: this.serverId,
        id,
        name: p.name ?? "",
        songCount: int(p.songCount) ?? 0,
        duration: int(p.duration) ?? 0,
        artworkId: str(p.coverArt),
        dateAdded: parseDate(p.created),
        songIds: [],
      };
    });
  }

  async playlistEntries(id: string): Promise<PlaylistEntry[]> {
    const r = await this.call("getPlaylist", [["id", id]]);
    return ((r.playlist?.entry ?? []) as Obj[]).map((e) => ({ songId: String(e.id) }));
  }

  readonly canEditPlaylists = true;

  private callMany(method: string, base: [string, string][], key: string, values: string[]) {
    // Repeated parameters: build the URL by hand.
    const extra = values.map((v) => `&${encodeURIComponent(key)}=${encodeURIComponent(v)}`).join("");
    const url = this.url(method, base) + extra;
    return json<Obj>(this.conn, url).then((body) => {
      const response = body?.["subsonic-response"];
      if (response?.status !== "ok") throw new SubsonicError(response?.error?.code ?? 0, response?.error?.message ?? "");
      return response;
    });
  }

  async createPlaylist(name: string, songIds: string[]) {
    const r = await this.callMany("createPlaylist", [["name", name]], "songId", songIds);
    if (r.playlist?.id != null) return String(r.playlist.id);
    // Servers before API 1.14 answer without the playlist: find the newest one with that name.
    const found = (await this.playlists()).filter((p) => p.name === name).sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0))[0];
    if (!found) throw new ServerError("The playlist was created, but the server didn't say where.");
    return found.id;
  }

  async renamePlaylist(id: string, name: string) {
    await this.call("updatePlaylist", [["playlistId", id], ["name", name]]);
  }

  async deletePlaylist(id: string) {
    await this.call("deletePlaylist", [["id", id]]);
  }

  async addToPlaylist(id: string, songIds: string[]) {
    await this.callMany("updatePlaylist", [["playlistId", id]], "songIdToAdd", songIds);
  }

  async removeFromPlaylist(id: string, _entries: PlaylistEntry[], indexes: number[]) {
    await this.callMany("updatePlaylist", [["playlistId", id]], "songIndexToRemove", [...indexes].sort((a, b) => a - b).map(String));
  }

  /** Subsonic can't move a song, so the playlist is written again in the new order. */
  async movePlaylistEntry(id: string, entries: PlaylistEntry[], from: number, to: number) {
    const songs = entries.map((e) => e.songId);
    if (from < 0 || from >= songs.length) return;
    const [moved] = songs.splice(from, 1);
    songs.splice(Math.min(Math.max(to, 0), songs.length), 0, moved);
    await this.callMany("createPlaylist", [["playlistId", id]], "songId", songs);
  }

  streamURL(songId: string, suffix: string | undefined, maxBitRate: number | undefined) {
    // No estimateContentLength: Navidrome then announces a size, sends fewer bytes and the connection breaks.
    if (maxBitRate) return this.url("stream", [["id", songId], ["maxBitRate", maxBitRate], ["format", "mp3"]]);
    if (isPlayable(suffix)) return this.url("stream", [["id", songId], ["format", "raw"]]);
    return this.url("stream", [["id", songId], ["maxBitRate", 320], ["format", "mp3"]]);
  }

  downloadURL(songId: string, suffix: string | undefined, maxBitRate: number | undefined) {
    if (!maxBitRate && isPlayable(suffix)) return this.url("download", [["id", songId]]);
    return this.streamURL(songId, suffix, maxBitRate);
  }

  artworkURL(id: string, size: number) {
    return this.url("getCoverArt", [["id", id], ["size", size]]);
  }

  async setFavorite(favorite: boolean, id: string, target: FavoriteTarget) {
    const key = target === "song" ? "id" : target === "album" ? "albumId" : "artistId";
    await this.call(favorite ? "star" : "unstar", [[key, id]]);
  }

  async reportNowPlaying(songId: string) {
    await this.call("scrobble", [["id", songId], ["submission", "false"]]).catch(() => {});
  }

  async reportPlayed(songId: string) {
    await this.call("scrobble", [["id", songId], ["submission", "true"], ["time", Date.now()]]).catch(() => {});
  }
}
