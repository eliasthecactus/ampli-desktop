// The bridge to the Rust side. In a plain browser (vite dev without Tauri) everything falls back to
// direct requests and localStorage, so the interface can still be worked on.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const platform: "mac" | "windows" | "linux" = /Mac/i.test(navigator.userAgent)
  ? "mac"
  : /Win/i.test(navigator.userAgent)
    ? "windows"
    : "linux";

let proxy: { port: number; token: string } | null = null;

export async function initNative() {
  if (isTauri) proxy = await invoke<{ port: number; token: string }>("proxy_info");
}

const base = () => `http://127.0.0.1:${proxy!.port}/${proxy!.token}`;

/** The URL the web view uses for `url`: through the local proxy (CORS, pinned certificates, no mixed content). */
export function proxied(url: string, opts: { pin?: string; icy?: string } = {}): string {
  // Plain browser during development: the dev server's stand-in (see vite.config.ts).
  if (!proxy) return import.meta.env.DEV ? `/__ampli/f?u=${encodeURIComponent(url)}` : url;
  let out = `${base()}/f?u=${encodeURIComponent(url)}`;
  if (opts.pin) out += `&pin=${encodeURIComponent(opts.pin)}`;
  if (opts.icy) out += `&icy=${encodeURIComponent(opts.icy)}`;
  return out;
}

export function fileURL(fileName: string): string {
  return proxy ? `${base()}/files/${encodeURIComponent(fileName)}` : "";
}

export async function icyTitle(id: string): Promise<string | null> {
  if (!proxy) return null;
  try {
    const res = await fetch(`${base()}/icy?id=${encodeURIComponent(id)}`);
    return ((await res.json()) as { title: string | null }).title;
  } catch {
    return null;
  }
}

export async function downloadFile(id: string, url: string, fileName: string, pin?: string, headers?: Record<string, string>) {
  if (!isTauri) throw new Error("Downloads need the desktop app.");
  return invoke<number>("download_file", { id, url, fileName, pin: pin ?? null, headers: headers ?? null });
}

export const cancelDownload = (id: string) => (isTauri ? invoke("cancel_download", { id }) : Promise.resolve());
export const deleteFile = (fileName: string) => (isTauri ? invoke("delete_file", { fileName }) : Promise.resolve());
export const listFiles = () => (isTauri ? invoke<Record<string, number>>("list_files") : Promise.resolve({} as Record<string, number>));
export const downloadsFolder = () => (isTauri ? invoke<string>("downloads_folder") : Promise.resolve(""));
export const probeCertificate = (url: string) => invoke<string>("probe_certificate", { url });
export const setMiniPlayer = (enabled: boolean) => (isTauri ? invoke("set_mini_player", { enabled }) : Promise.resolve());

export function onDownloadProgress(handler: (p: { id: string; received: number; total: number | null }) => void) {
  if (!isTauri) return () => {};
  const un = listen<{ id: string; received: number; total: number | null }>("download-progress", (e) => handler(e.payload));
  return () => void un.then((f) => f());
}

// Secrets: the system keychain (macOS Keychain, Windows Credential Manager, Secret Service on Linux).
// If there is none (some Linux setups), they stay in local storage instead.
const fallbackKey = (key: string) => `ampli.secret.${key}`;

export async function secretGet(key: string): Promise<string | null> {
  if (isTauri) {
    try {
      const value = await invoke<string | null>("secret_get", { key });
      if (value != null) return value;
    } catch (e) {
      console.warn("Keychain unavailable", e);
    }
  }
  return localStorage.getItem(fallbackKey(key));
}

export async function secretSet(key: string, value: string) {
  if (isTauri) {
    try {
      await invoke("secret_set", { key, value });
      localStorage.removeItem(fallbackKey(key));
      return;
    } catch (e) {
      console.warn("Keychain unavailable, keeping the secret locally", e);
    }
  }
  localStorage.setItem(fallbackKey(key), value);
}

export async function secretDelete(key: string) {
  localStorage.removeItem(fallbackKey(key));
  if (isTauri) await invoke("secret_delete", { key }).catch(() => {});
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
