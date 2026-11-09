import Dexie, { type Table } from "dexie";
import type { Album, Artist, Book, Playlist, Song, Track } from "./types";

/** A finished download on this computer. */
export interface DownloadRecord {
  /** Song key, or "book:<book key>:<file index>" / "ebook:<book key>". */
  key: string;
  kind: "song" | "audiobook" | "ebook";
  serverId: string;
  fileName: string;
  size: number;
  addedAt: number;
  track?: Track;
  bookKey?: string;
}

export interface PlayRecord {
  id?: number;
  key: string;
  serverId: string;
  albumKey?: string;
  at: number;
}

/** A bookmark or highlight in a book. */
export interface Annotation {
  id: string;
  bookKey: string;
  kind: "bookmark" | "highlight";
  /** EPUB CFI, or "page:<n>" for PDFs and comics. */
  location: string;
  text?: string;
  note?: string;
  color?: string;
  progress: number;
  createdAt: number;
}

/** Where the reader was in a book, locally (the server only keeps a percentage). */
export interface ReadingPosition {
  bookKey: string;
  location: string;
  progress: number;
  updatedAt: number;
}

class AmpliDB extends Dexie {
  songs!: Table<Song, string>;
  albums!: Table<Album, string>;
  artists!: Table<Artist, string>;
  playlists!: Table<Playlist, string>;
  books!: Table<Book, string>;
  downloads!: Table<DownloadRecord, string>;
  plays!: Table<PlayRecord, number>;
  annotations!: Table<Annotation, string>;
  positions!: Table<ReadingPosition, string>;

  constructor() {
    super("ampli");
    this.version(1).stores({
      songs: "&key, serverId",
      albums: "&key, serverId",
      artists: "&key, serverId",
      playlists: "&key, serverId",
      books: "&key, serverId",
      downloads: "&key, kind, serverId, bookKey",
      plays: "++id, key, at",
      annotations: "&id, bookKey",
      positions: "&bookKey",
    });
  }
}

export const db = new AmpliDB();

export async function clearServer(serverId: string) {
  await db.transaction("rw", [db.songs, db.albums, db.artists, db.playlists, db.books], async () => {
    for (const table of [db.songs, db.albums, db.artists, db.playlists, db.books] as Table<{ serverId: string }, string>[]) {
      await table.where("serverId").equals(serverId).delete();
    }
  });
}
