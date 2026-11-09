import { proxied } from "./native";
import { ServerError, type ServerAccount } from "./types";

/** What a request needs to know about its server: the pinned certificate and whether http is allowed. */
export interface Connection {
  url: string;
  pin?: string;
  allowsUnencrypted: boolean;
}

export const connectionOf = (a: ServerAccount): Connection => ({
  url: a.url,
  pin: a.pinnedCertificate,
  allowsUnencrypted: a.allowsUnencrypted,
});

/** Addresses at home, where plain http is allowed by default (like the iOS app). */
export function isLocalAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".lan") ||
      host.endsWith(".home") ||
      host.endsWith(".internal") ||
      !host.includes(".") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      host.startsWith("[fd") ||
      host.startsWith("[fe80")
    );
  } catch {
    return false;
  }
}

/** Accepts "music.example.com", "http://1.2.3.4:4533/" and similar, without a trailing slash. */
export function normalizeServerURL(text: string): string | null {
  let s = text.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  s = s.replace(/\/+$/, "");
  try {
    const url = new URL(s);
    if (!url.hostname) return null;
    return s;
  } catch {
    return null;
  }
}

/** RFC 3986 encoding for query values, so "&" and "+" survive. */
export function query(params: [string, string | number | undefined | null][]): string {
  const parts = params
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export function join(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

export function checkPolicy(conn: Connection, url: string) {
  if (url.toLowerCase().startsWith("http://") && !conn.allowsUnencrypted) {
    throw new ServerError(
      "This server uses an unencrypted connection (http), which is off for it. Turn on Allow Unencrypted Connection for this server, or use https.",
      "insecure",
    );
  }
}

/** The URL a stream, image or download is loaded from in the web view. */
export function mediaURL(conn: Connection, url: string, icy?: string): string {
  return proxied(url, { pin: conn.pin, icy });
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Keep error text from the server's JSON answer (`detail`). */
  detail?: boolean;
  timeout?: number;
}

export async function request(conn: Connection, url: string, opts: RequestOptions = {}): Promise<Response> {
  checkPolicy(conn, url);
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string") body = opts.body;
    else {
      body = JSON.stringify(opts.body);
      headers["Content-Type"] ??= "application/json";
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? 30_000);
  let res: Response;
  try {
    res = await fetch(proxied(url, { pin: conn.pin }), { method: opts.method ?? "GET", headers, body, signal: controller.signal });
  } catch (e) {
    throw new ServerError(
      controller.signal.aborted ? "The server took too long to answer." : "The server can't be reached. Check the address and your connection.",
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
  const proxyError = res.headers.get("x-ampli-error");
  if (proxyError === "certificate") throw new ServerError("The server's certificate isn't trusted.", "certificate");
  if (proxyError === "timeout") throw new ServerError("The server took too long to answer.", "network");
  if (proxyError) throw new ServerError("The server can't be reached. Check the address and your connection.", "network");
  if (res.ok) return res;
  if (opts.detail) {
    const detail = await res
      .json()
      .then((j: { detail?: unknown }) => (typeof j?.detail === "string" ? j.detail : null))
      .catch(() => null);
    if (detail) throw new ServerError(detail, res.status === 401 ? "unauthorized" : "server", res.status);
  }
  if (res.status === 401 || res.status === 403) throw new ServerError("Wrong username or password.", "unauthorized", res.status);
  throw new ServerError(`The server answered with error ${res.status}.`, "http", res.status);
}

export async function json<T>(conn: Connection, url: string, opts?: RequestOptions): Promise<T> {
  const res = await request(conn, url, opts);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ServerError("The server's answer couldn't be read.", "decoding");
  }
}

export const parseDate = (s?: string | null): number | undefined => {
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
};

/** A stable id for this installation (Jellyfin and Amplicon list devices by it). */
export function deviceId(): string {
  let id = localStorage.getItem("ampli.deviceId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ampli.deviceId", id);
  }
  return id;
}

export function deviceName(): string {
  const p = /Mac/i.test(navigator.userAgent) ? "Mac" : /Win/i.test(navigator.userAgent) ? "Windows" : "Linux";
  return `Ampli Desktop (${p})`;
}

export const appVersion = "1.0.0";
