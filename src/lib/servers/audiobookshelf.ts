// Audiobookshelf: book libraries with audiobooks and ebooks, chapters and progress.
// Current servers return a long-lived token; newer ones may only hand out short-lived access tokens with a
// refresh token, so a 401 triggers one refresh and the new tokens are saved.
import { join, json, query, request, type Connection, type RequestOptions } from "../http";
import type { AudiobookDetail, AudiobookTrack, Book, BookProgress, RemoteLibrary } from "../types";
import { ServerError } from "../types";
import type { BookClient } from "./client";

export interface AbsTokens {
  access: string;
  refresh?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export async function signInAudiobookshelf(conn: Connection, username: string, password: string) {
  const status = await json<Obj>(conn, join(conn.url, "status")).catch((e) => {
    if (e instanceof ServerError && (e.kind === "certificate" || e.kind === "insecure")) throw e;
    return null;
  });
  if (status && status.app && status.app !== "audiobookshelf") throw new ServerError("This isn't an Audiobookshelf server.", "unsupported");
  let login: Obj;
  try {
    login = await json<Obj>(conn, join(conn.url, "login"), {
      method: "POST",
      headers: { "x-return-tokens": "true" },
      body: { username, password },
    });
  } catch (e) {
    if (e instanceof ServerError && (e.status === 400 || e.status === 401)) throw new ServerError("Wrong username or password.", "unauthorized");
    throw e;
  }
  const user = login.user ?? {};
  const tokens: AbsTokens = user.token ? { access: user.token } : { access: user.accessToken ?? "", refresh: user.refreshToken };
  if (!tokens.access) throw new ServerError("Wrong username or password.", "unauthorized");
  return { tokens, serverName: "Audiobookshelf" };
}

export class AudiobookshelfClient implements BookClient {
  constructor(
    readonly conn: Connection,
    readonly serverId: string,
    private tokens: AbsTokens,
    private onRefresh: (t: AbsTokens) => void = () => {},
  ) {}

  get token() {
    return this.tokens.access;
  }

  get headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async perform(path: string, params: [string, string | number | undefined][], opts: RequestOptions = {}) {
    const go = () => request(this.conn, join(this.conn.url, path) + query(params), { ...opts, headers: { ...opts.headers, ...this.headers } });
    try {
      return await go();
    } catch (e) {
      if (e instanceof ServerError && e.kind === "unauthorized" && (await this.refresh())) return go();
      throw e;
    }
  }

  private async get<T = Obj>(path: string, params: [string, string | number | undefined][] = []): Promise<T> {
    const res = await this.perform(path, params);
    return (await res.json()) as T;
  }

  private async send(method: string, path: string, body: unknown) {
    await this.perform(path, [], { method, body });
  }

  private async refresh(): Promise<boolean> {
    if (!this.tokens.refresh) return false;
    const login = await json<Obj>(this.conn, join(this.conn.url, "auth/refresh"), {
      method: "POST",
      headers: { "x-refresh-token": this.tokens.refresh },
    }).catch(() => null);
    const access = login?.user?.accessToken;
    if (!access) return false;
    this.tokens = { access, refresh: login.user.refreshToken ?? this.tokens.refresh };
    this.onRefresh(this.tokens);
    return true;
  }

  async bookLibraries(): Promise<RemoteLibrary[]> {
    const r = await this.get("api/libraries");
    return ((r.libraries ?? []) as Obj[]).filter((l) => l.mediaType === "book").map((l) => ({ id: l.id, name: l.name, kind: "books" as const }));
  }

  async mediaProgress(): Promise<Map<string, BookProgress>> {
    const me = await this.get("api/me");
    const result = new Map<string, BookProgress>();
    for (const e of (me.mediaProgress ?? []) as Obj[]) {
      if (e.episodeId) continue;
      result.set(e.libraryItemId, {
        progress: e.progress ?? 0,
        currentTime: e.currentTime ?? 0,
        ebookProgress: e.ebookProgress ?? undefined,
        isFinished: !!e.isFinished,
        updatedAt: e.lastUpdate,
      });
    }
    return result;
  }

  async books(libraries: string[]): Promise<Book[]> {
    const selected = libraries.length ? libraries : (await this.bookLibraries()).map((l) => l.id);
    const progress = await this.mediaProgress();
    const result: Book[] = [];
    for (const library of selected) {
      for (let page = 0; ; page++) {
        const r = await this.get(`api/libraries/${library}/items`, [["limit", 200], ["page", page], ["minified", 1], ["sort", "media.metadata.title"]]);
        const items: Obj[] = r.results ?? [];
        for (const item of items) if (item.mediaType === "book") result.push(this.book(item, library, progress.get(item.id)));
        if (items.length < 200 || (page + 1) * 200 >= (r.total ?? 0)) break;
      }
    }
    return result;
  }

  book(item: Obj, library: string, progress?: BookProgress): Book {
    const m = item.media?.metadata ?? {};
    const book: Book = {
      key: `${this.serverId}|${item.id}`,
      serverId: this.serverId,
      id: item.id,
      libraryId: library,
      title: m.title ?? "",
      author: m.authorName ?? "",
      narrator: m.narratorName || undefined,
      year: m.publishedYear ? parseInt(String(m.publishedYear).slice(0, 4)) || undefined : undefined,
      overview: m.description,
      artworkId: item.media?.coverPath ? item.id : undefined,
      ebookFormat: item.media?.ebookFormat?.toLowerCase(),
      hasAudio: (item.media?.numTracks ?? item.media?.numAudioFiles ?? 0) > 0,
      duration: item.media?.duration ?? 0,
      dateAdded: item.addedAt,
      progress,
    };
    const series: string | undefined = m.seriesName || undefined;
    if (series) {
      const at = series.lastIndexOf(" #");
      if (at >= 0) {
        book.series = series.slice(0, at);
        book.seriesSequence = series.slice(at + 2);
      } else book.series = series;
    }
    return book;
  }

  async audiobookDetail(bookId: string): Promise<AudiobookDetail> {
    const item = await this.get(`api/items/${bookId}`, [["expanded", 1]]);
    const tracks: AudiobookTrack[] = ((item.media?.tracks ?? []) as Obj[]).map((t) => ({
      id: t.contentUrl,
      startOffset: t.startOffset ?? 0,
      duration: t.duration ?? 0,
      suffix: t.metadata?.ext?.replace(/^\./, "").toLowerCase(),
    }));
    const chapters = ((item.media?.chapters ?? []) as Obj[]).map((c) => ({ title: c.title ?? "", start: c.start ?? 0, end: c.end ?? 0 }));
    return { tracks, chapters, overview: item.media?.metadata?.description };
  }

  /** `track.id` is the content URL, e.g. /api/items/<id>/file/<ino>. */
  audioURL(_bookId: string, track: AudiobookTrack) {
    return this.conn.url.replace(/\/+$/, "") + track.id + query([["token", this.token]]);
  }

  ebookURL(bookId: string) {
    return join(this.conn.url, `api/items/${bookId}/ebook`) + query([["token", this.token]]);
  }

  coverURL(id: string, size: number) {
    return join(this.conn.url, `api/items/${id}/cover`) + query([["width", size], ["format", "jpeg"], ["token", this.token]]);
  }

  async saveAudioProgress(bookId: string, currentTime: number, duration: number, finished: boolean) {
    const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
    await this.send("PATCH", `api/me/progress/${bookId}`, { currentTime, duration, progress: finished ? 1 : progress, isFinished: finished });
  }

  async saveEbookProgress(bookId: string, progress: number, finished: boolean) {
    await this.send("PATCH", `api/me/progress/${bookId}`, { ebookProgress: Math.min(Math.max(progress, 0), 1), isFinished: finished });
  }
}
