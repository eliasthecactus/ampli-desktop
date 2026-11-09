export type ServerKind = "jellyfin" | "subsonic" | "audiobookshelf" | "amplicon";

export const serverKinds: { kind: ServerKind; name: string; detail: string }[] = [
  { kind: "jellyfin", name: "Jellyfin", detail: "Music, audiobooks and ebooks" },
  { kind: "subsonic", name: "Navidrome / Subsonic", detail: "Navidrome, Gonic, Airsonic and other (Open)Subsonic servers" },
  { kind: "audiobookshelf", name: "Audiobookshelf", detail: "Audiobooks and ebooks" },
  { kind: "amplicon", name: "Amplicon", detail: "YouTube Music through your own Amplicon server" },
];

export const kindName = (kind: ServerKind) => serverKinds.find((k) => k.kind === kind)!.name;
export const hasMusic = (kind: ServerKind) => kind === "jellyfin" || kind === "subsonic";
export const hasBooks = (kind: ServerKind) => kind === "jellyfin" || kind === "audiobookshelf";

export type LibraryKind = "music" | "books";

export interface RemoteLibrary {
  id: string;
  name: string;
  kind: LibraryKind;
}

export interface ServerAccount {
  id: string;
  kind: ServerKind;
  url: string;
  username: string;
  name: string;
  userId?: string;
  libraries: RemoteLibrary[];
  /** Libraries to sync; empty = all. */
  selectedLibraryIds: string[];
  lastSync?: number;
  lastSyncError?: string;
  songCount: number;
  albumCount: number;
  bookCount: number;
  /** SHA-256 of a self-signed certificate the user trusts. */
  pinnedCertificate?: string;
  allowsUnencrypted: boolean;
}

export interface Credential {
  jellyfinToken?: string;
  subsonic?: { t: string; s: string } | { p: string };
  audiobookshelf?: { access: string; refresh?: string };
  amplicon?: { token: string; secret: string; deviceId: number };
}

// Library items. `key` is "serverId|id" so ids of different servers never collide.

export interface Song {
  key: string;
  serverId: string;
  id: string;
  title: string;
  albumId?: string;
  albumName?: string;
  artistName: string;
  artistId?: string;
  albumArtistName?: string;
  track?: number;
  disc?: number;
  duration: number;
  suffix?: string;
  bitRate?: number;
  size?: number;
  artworkId?: string;
  genre?: string;
  year?: number;
  dateAdded?: number;
  favorite: 0 | 1;
  playCount: number;
  gain?: number;
  libraryId?: string;
}

export interface Album {
  key: string;
  serverId: string;
  id: string;
  name: string;
  artistName: string;
  artistId?: string;
  year?: number;
  genre?: string;
  artworkId?: string;
  songCount: number;
  duration: number;
  dateAdded?: number;
  favorite: 0 | 1;
}

export interface Artist {
  key: string;
  serverId: string;
  id: string;
  name: string;
  albumCount: number;
  artworkId?: string;
  favorite: 0 | 1;
}

export interface Playlist {
  key: string;
  serverId: string;
  id: string;
  name: string;
  songCount: number;
  duration: number;
  artworkId?: string;
  dateAdded?: number;
  songIds: string[];
  /** Jellyfin entry ids, by position. */
  entryIds?: (string | undefined)[];
}

export interface BookProgress {
  progress: number;
  currentTime: number;
  ebookProgress?: number;
  isFinished: boolean;
  updatedAt?: number;
}

export interface Book {
  key: string;
  serverId: string;
  id: string;
  libraryId: string;
  title: string;
  author: string;
  narrator?: string;
  series?: string;
  seriesSequence?: string;
  year?: number;
  overview?: string;
  artworkId?: string;
  ebookFormat?: string;
  hasAudio: boolean;
  duration: number;
  dateAdded?: number;
  progress?: BookProgress;
}

export interface AudiobookTrack {
  id: string;
  startOffset: number;
  duration: number;
  suffix?: string;
}

export interface AudiobookChapter {
  title: string;
  start: number;
  end: number;
}

export interface AudiobookDetail {
  tracks: AudiobookTrack[];
  chapters: AudiobookChapter[];
  overview?: string;
}

/** Something in the play queue: a library song or a song from an Amplicon catalog. */
export interface Track {
  key: string;
  serverId: string;
  id: string;
  title: string;
  artist: string;
  album: string;
  albumKey?: string;
  artistKey?: string;
  artworkId?: string;
  duration: number;
  suffix?: string;
  gain?: number;
  libraryId?: string;
  catalog?: boolean;
}

export function songToTrack(song: Song): Track {
  return {
    key: song.key,
    serverId: song.serverId,
    id: song.id,
    title: song.title,
    artist: song.artistName,
    album: song.albumName ?? "",
    albumKey: song.albumId ? `${song.serverId}|${song.albumId}` : undefined,
    artistKey: song.artistId ? `${song.serverId}|${song.artistId}` : undefined,
    artworkId: song.artworkId,
    duration: song.duration,
    suffix: song.suffix,
    gain: song.gain,
    libraryId: song.libraryId,
  };
}

export class ServerError extends Error {
  constructor(
    message: string,
    public kind: "unauthorized" | "http" | "network" | "certificate" | "insecure" | "decoding" | "unsupported" | "server" | "readonly" = "server",
    public status?: number,
  ) {
    super(message);
  }
}
