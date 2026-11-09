import type { Connection } from "../http";
import type {
  Album,
  Artist,
  AudiobookDetail,
  AudiobookTrack,
  Book,
  Playlist,
  RemoteLibrary,
  Song,
} from "../types";
import { ServerError } from "../types";

export type FavoriteTarget = "song" | "album" | "artist";

export interface PlaylistEntry {
  songId: string;
  entryId?: string;
}

/** File types the web view plays directly; everything else is transcoded by the server. */
export const playableFormats = new Set(["mp3", "aac", "m4a", "m4b", "mp4", "flac", "wav", "ogg", "oga", "opus", "webm"]);
export const isPlayable = (suffix?: string) => !suffix || playableFormats.has(suffix.toLowerCase());

export interface MusicClient {
  readonly conn: Connection;
  libraries(): Promise<RemoteLibrary[]>;
  artists(libraries: string[]): Promise<Artist[]>;
  albums(libraries: string[]): Promise<Album[]>;
  songs(libraries: string[], progress: (loaded: number, total?: number) => void): Promise<Song[]>;
  playlists(): Promise<Playlist[]>;
  playlistEntries(id: string): Promise<PlaylistEntry[]>;
  /** A URL the player can stream. `maxBitRate` in kbit/s, undefined = original file. */
  streamURL(songId: string, suffix: string | undefined, maxBitRate: number | undefined): string;
  downloadURL(songId: string, suffix: string | undefined, maxBitRate: number | undefined): string;
  artworkURL(id: string, size: number): string;
  setFavorite(favorite: boolean, id: string, target: FavoriteTarget): Promise<void>;
  reportNowPlaying(songId: string): Promise<void>;
  reportPlayed(songId: string, position: number, finished: boolean): Promise<void>;
  readonly canEditPlaylists: boolean;
  createPlaylist(name: string, songIds: string[]): Promise<string>;
  renamePlaylist(id: string, name: string): Promise<void>;
  deletePlaylist(id: string): Promise<void>;
  addToPlaylist(id: string, songIds: string[]): Promise<void>;
  removeFromPlaylist(id: string, entries: PlaylistEntry[], indexes: number[]): Promise<void>;
  movePlaylistEntry(id: string, entries: PlaylistEntry[], from: number, to: number): Promise<void>;
}

export interface BookClient {
  readonly conn: Connection;
  bookLibraries(): Promise<RemoteLibrary[]>;
  books(libraries: string[]): Promise<Book[]>;
  audiobookDetail(bookId: string): Promise<AudiobookDetail>;
  audioURL(bookId: string, track: AudiobookTrack): string;
  ebookURL(bookId: string): string;
  coverURL(id: string, size: number): string;
  /** Headers for API requests (ebook downloads). */
  readonly headers: Record<string, string>;
  saveAudioProgress(bookId: string, currentTime: number, duration: number, finished: boolean): Promise<void>;
  saveEbookProgress(bookId: string, progress: number, finished: boolean): Promise<void>;
}

export const readOnly = () => Promise.reject(new ServerError("Playlists on this server can't be changed from Ampli.", "readonly"));

export const changedOnServer = () =>
  new ServerError("The playlist changed on the server. Refresh and try again.", "server");
