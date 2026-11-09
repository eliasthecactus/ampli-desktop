// Amplicon: the user's own server (github.com/eliasthecactus/ampli-con). Search, albums, playlists and artists
// come from it live; songs play through its stream proxy with signed links; downloads land in the user's
// library on the server. It has no library to sync.
import { deviceId, deviceName, join, json, query, type Connection } from "../http";
import { toHex } from "../md5";
import { hmacSha256 } from "../sha256";
import type { Album, Artist, Playlist, RemoteLibrary, Song, Track } from "../types";
import { ServerError } from "../types";
import { type FavoriteTarget, type MusicClient, type PlaylistEntry } from "./client";

export interface AmpliconCredential {
  token: string;
  secret: string;
  deviceId: number;
}

export interface AmpliconProfile {
  id: number;
  name: string;
  format: string;
  location?: string;
  locationId?: number;
  isDefault: boolean;
}

export interface AmpliconLocation {
  id: number;
  name: string;
  online: boolean;
  freeBytes?: number;
  scans?: boolean;
}

export interface AmpliconInfo {
  name: string;
  version: string;
  youtube: { connected: boolean; name?: string; handle?: string; photo?: string; status?: string };
  profiles: AmpliconProfile[];
  locations: AmpliconLocation[];
  metadataReview?: boolean;
  aiAvailable?: boolean;
}

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration: number;
  thumbnail?: string;
  track?: number;
  setVideoId?: string;
  available: boolean;
  isVideo?: boolean;
}

export interface CatalogAlbumSummary {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  year?: string;
  type?: string;
  thumbnail?: string;
}

export interface CatalogPlaylist {
  id: string;
  title: string;
  author?: string;
  thumbnail?: string;
  trackCount?: number;
  editable?: boolean;
}

export interface CatalogArtistSummary {
  id: string;
  name: string;
  thumbnail?: string;
}

export interface CatalogSearch {
  songs: CatalogSong[];
  albums: CatalogAlbumSummary[];
  playlists: CatalogPlaylist[];
  artists: CatalogArtistSummary[];
  top?: { type: string };
}

export type CatalogItem =
  | { type: "song"; item: CatalogSong }
  | { type: "album"; item: CatalogAlbumSummary }
  | { type: "playlist"; item: CatalogPlaylist }
  | { type: "artist"; item: CatalogArtistSummary };

export interface CatalogHome {
  personalized: boolean;
  sections: { title: string; items: CatalogItem[] }[];
}

export interface CatalogAlbum {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  year?: string;
  type?: string;
  thumbnail?: string;
  tracks: CatalogSong[];
  trackCount: number;
  duration: number;
}

export interface CatalogPlaylistDetail {
  id: string;
  title: string;
  author?: string;
  thumbnail?: string;
  tracks: CatalogSong[];
  trackCount?: number;
  duration: number;
  editable: boolean;
}

export interface CatalogArtist {
  id: string;
  name: string;
  thumbnail?: string;
  songs: CatalogSong[];
  albums: CatalogAlbumSummary[];
  singles: CatalogAlbumSummary[];
}

export interface AmpliconJob {
  id: number;
  kind: string;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  profileName?: string;
  locationName?: string;
  status: string;
  total: number;
  done: number;
  skipped: number;
  failed: number;
  error?: string;
  progress: number;
  current: { id: number; title: string; artist?: string; progress: number }[];
  review?: boolean;
}

export const jobIsActive = (j: AmpliconJob) => ["preparing", "review", "queued", "running"].includes(j.status);
export const jobNeedsReview = (j: AmpliconJob) => j.status === "review";

export interface ReviewTags {
  title?: string | null;
  artist?: string | null;
  albumartist?: string | null;
  album?: string | null;
  track?: number | null;
  trackTotal?: number | null;
  disc?: number | null;
  discTotal?: number | null;
  year?: string | null;
  genre?: string | null;
  label?: string | null;
  isrc?: string | null;
  cover?: string | null;
}

export interface ReviewCandidate extends ReviewTags {
  source: string;
  id: string;
  score?: number;
}

export interface ReviewSong {
  itemId: number;
  position: number;
  original: ReviewTags;
  suggested: ReviewTags;
  candidates: ReviewCandidate[];
  covers: { source: string; url: string }[];
  confident: boolean;
  path?: string;
  exists: boolean;
  inLibrary?: { match: string; path: string; location: string };
}

export interface AmpliconReview {
  job: AmpliconJob;
  songs: ReviewSong[];
  albums: { source: string; id: string; title: string; artist: string; year?: string; cover?: string; songs: Record<string, ReviewTags> }[];
}

export interface ReviewDecision {
  itemId: number;
  fields: ReviewTags;
  skip: boolean;
  cover?: { url: string };
}

// snake_case on the wire, camelCase here.
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function convert(value: unknown, key: (s: string) => string, keepKeysOf?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => convert(v, key, keepKeysOf));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Dictionaries keyed by ids (review albums' songs, AI suggestions) keep their keys.
      const keepInner = keepKeysOf?.has(k);
      out[key(k)] = keepInner && v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).map(([ik, iv]) => [ik, convert(iv, key, keepKeysOf)]))
        : convert(v, key, keepKeysOf);
    }
    return out;
  }
  return value;
}

const fromWire = <T>(v: unknown) => convert(v, camel, new Set(["songs", "suggestions"])) as T;
const toWire = (v: unknown) => convert(v, snake);

/** lh3.googleusercontent.com/...=w544-h544-l90-rj → the size asked for. */
export function resizedArtwork(url: string, size: number): string {
  if (url.includes("googleusercontent.com")) return url.replace(/=w\d+-h\d+.*$/, `=w${size}-h${size}-l90-rj`);
  return url;
}

export async function signInAmplicon(conn: Connection, username: string, password: string) {
  const health = await json<{ app?: string }>(conn, join(conn.url, "api/health")).catch((e) => {
    if (e instanceof ServerError && (e.kind === "certificate" || e.kind === "insecure")) throw e;
    return null;
  });
  if (health?.app !== "amplicon") throw new ServerError("This isn't an Amplicon server.", "unsupported");
  const raw = await json<unknown>(conn, join(conn.url, "api/app/login"), {
    method: "POST",
    detail: true,
    body: toWire({ username, password, device: deviceName(), installId: deviceId() }),
  });
  const answer = fromWire<{ token: string; secret: string; deviceId: number } & AmpliconInfo>(raw);
  return { credential: { token: answer.token, secret: answer.secret, deviceId: answer.deviceId } as AmpliconCredential, info: answer as AmpliconInfo };
}

export class AmpliconClient implements MusicClient {
  constructor(
    readonly conn: Connection,
    readonly serverId: string,
    readonly credential: AmpliconCredential,
  ) {}

  private async call<T>(method: string, path: string, params: [string, string | number | undefined][] = [], body?: unknown): Promise<T> {
    const raw = await json<unknown>(this.conn, join(this.conn.url, path) + query(params), {
      method,
      detail: true,
      headers: { Authorization: `Bearer ${this.credential.token}` },
      body: body === undefined ? undefined : toWire(body),
    });
    return fromWire<T>(raw);
  }

  info() {
    return this.call<AmpliconInfo>("GET", "api/app/info");
  }

  // Nothing to sync.
  async libraries(): Promise<RemoteLibrary[]> {
    return [];
  }
  async artists(): Promise<Artist[]> {
    return [];
  }
  async albums(): Promise<Album[]> {
    return [];
  }
  async songs(): Promise<Song[]> {
    return [];
  }
  async playlists(): Promise<Playlist[]> {
    return [];
  }

  /** A signed link, valid for a day. The hour is rounded so the same song keeps the same link for a while. */
  signed(path: string, now = Date.now()) {
    const hour = Math.floor(now / 1000 / 3600) * 3600;
    const exp = hour + 24 * 3600;
    const enc = new TextEncoder();
    const sig = toHex(hmacSha256(enc.encode(this.credential.secret), enc.encode(`/${path}:${exp}`)));
    return join(this.conn.url, path) + query([["d", this.credential.deviceId], ["exp", exp], ["sig", sig]]);
  }

  streamURL(songId: string) {
    return this.signed(`api/stream/${songId}`);
  }

  downloadURL(songId: string) {
    return this.signed(`api/stream/${songId}`);
  }

  artworkURL(id: string, size: number) {
    return resizedArtwork(id, size);
  }

  async setFavorite(_f: boolean, _id: string, _t: FavoriteTarget) {}
  async reportNowPlaying() {}
  async reportPlayed() {}

  readonly canEditPlaylists = true;

  async playlistEntries(id: string): Promise<PlaylistEntry[]> {
    return (await this.playlist(id)).tracks.map((t) => ({ songId: t.id, entryId: t.setVideoId }));
  }

  async createPlaylist(name: string, songIds: string[]) {
    return (await this.call<{ id: string }>("POST", "api/library/playlists", [], { title: name, videoIds: songIds })).id;
  }

  async renamePlaylist(id: string, name: string) {
    await this.call("PATCH", `api/library/playlists/${id}`, [], { title: name });
  }

  async deletePlaylist(id: string) {
    await this.call("DELETE", `api/library/playlists/${id}`);
  }

  async addToPlaylist(id: string, songIds: string[]) {
    await this.call("POST", `api/library/playlists/${id}/items`, [], { videoIds: songIds });
  }

  async removeFromPlaylist(id: string, entries: PlaylistEntry[], indexes: number[]) {
    const items = indexes.filter((i) => entries[i]).map((i) => ({ id: entries[i].songId, setVideoId: entries[i].entryId ?? null }));
    await this.call("POST", `api/library/playlists/${id}/remove`, [], { items });
  }

  async movePlaylistEntry(id: string, entries: PlaylistEntry[], from: number, to: number) {
    const moving = entries[from]?.entryId;
    if (!moving) throw new ServerError("The playlist changed on the server. Refresh and try again.");
    const rest = entries.filter((_, i) => i !== from);
    const before = to < rest.length ? rest[to].entryId ?? null : null;
    await this.call("POST", `api/library/playlists/${id}/move`, [], { setVideoId: moving, beforeSetVideoId: before });
  }

  libraryPlaylists() {
    return this.call<CatalogPlaylist[]>("GET", "api/library/playlists");
  }

  search(q: string) {
    return this.call<CatalogSearch>("GET", "api/search", [["q", q], ["limit", 25]]);
  }

  async home(refresh = false): Promise<CatalogHome> {
    const home = await this.call<CatalogHome>("GET", "api/home", refresh ? [["refresh", "true"]] : []);
    const known = new Set(["song", "album", "playlist", "artist"]);
    return {
      personalized: !!home.personalized,
      sections: (home.sections ?? [])
        .map((s) => {
          const seen = new Set<string>();
          return {
            title: s.title,
            items: (s.items ?? []).filter((i) => i && known.has(i.type) && i.item && !seen.has(i.type + i.item.id) && seen.add(i.type + i.item.id)),
          };
        })
        .filter((s) => s.items.length),
    };
  }

  album(id: string) {
    return this.call<CatalogAlbum>("GET", `api/albums/${id}`);
  }

  playlist(id: string) {
    return this.call<CatalogPlaylistDetail>("GET", `api/playlists/${id}`);
  }

  artist(id: string) {
    return this.call<CatalogArtist>("GET", `api/artists/${id}`);
  }

  download(kind: "song" | "album" | "playlist", id: string, title: string, subtitle?: string, thumbnail?: string, profileId?: number, locationId?: number) {
    return this.call<AmpliconJob>("POST", "api/downloads", [], {
      kind,
      id,
      profileId: profileId ?? null,
      locationId: locationId ?? null,
      title,
      subtitle: subtitle ?? null,
      thumbnail: thumbnail ?? null,
      review: true,
    });
  }

  jobs(limit = 30) {
    return this.call<AmpliconJob[]>("GET", "api/jobs", [["active", "false"], ["limit", limit]]);
  }

  async cancel(job: number) {
    await this.call("POST", `api/jobs/${job}/cancel`);
  }
  async retry(job: number) {
    await this.call("POST", `api/jobs/${job}/retry`);
  }
  async remove(job: number) {
    await this.call("DELETE", `api/jobs/${job}`);
  }

  review(job: number) {
    return this.call<AmpliconReview>("GET", `api/jobs/${job}/review`);
  }

  confirm(job: number, songs: ReviewDecision[]) {
    return this.call<AmpliconJob>("POST", `api/jobs/${job}/confirm`, [], { songs });
  }

  async lookup(job: number, item: number, q: string) {
    return (await this.call<{ candidates: ReviewCandidate[] }>("POST", `api/jobs/${job}/review/lookup`, [], { itemId: item, query: q })).candidates;
  }

  reviewPath(job: number, item: number, fields: ReviewTags) {
    return this.call<{ path?: string; exists: boolean }>("POST", `api/jobs/${job}/review/path`, [], { itemId: item, fields });
  }
}

export function catalogTrack(song: CatalogSong, serverId: string): Track {
  return {
    key: `${serverId}|${song.id}`,
    serverId,
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album ?? "",
    artworkId: song.thumbnail,
    duration: song.duration,
    suffix: "m4a",
    catalog: true,
  };
}
