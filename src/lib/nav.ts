// Navigation: a stack of pages with back and forward, like a browser.
import { create } from "zustand";

export type Route =
  | { name: "home" }
  | { name: "search"; query?: string }
  | { name: "library"; tab?: LibraryTab }
  | { name: "album"; key: string }
  | { name: "artist"; key: string }
  | { name: "playlist"; key: string }
  | { name: "genre"; genre: string }
  | { name: "books"; tab?: string }
  | { name: "book"; key: string }
  | { name: "radio"; country?: string }
  | { name: "downloads" }
  | { name: "settings"; section?: string }
  | { name: "amplicon"; serverId: string; tab?: "foryou" | "playlists" | "jobs" }
  | { name: "catalog-album"; serverId: string; id: string }
  | { name: "catalog-playlist"; serverId: string; id: string }
  | { name: "catalog-artist"; serverId: string; id: string };

export type LibraryTab = "playlists" | "artists" | "albums" | "songs" | "genres" | "favorites";

interface NavState {
  stack: Route[];
  index: number;
  overlay: "player" | "queue" | "lyrics" | null;
  reader: string | null;
  toast: { id: number; text: string; tone?: "error" | "ok" } | null;
  palette: boolean;
  go: (route: Route) => void;
  root: (route: Route) => void;
  back: () => void;
  forward: () => void;
  setOverlay: (o: NavState["overlay"]) => void;
  openReader: (bookKey: string | null) => void;
  setPalette: (open: boolean) => void;
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ name: "home" }],
  index: 0,
  overlay: null,
  reader: null,
  toast: null,
  palette: false,
  go: (route) => {
    const { stack, index } = get();
    if (JSON.stringify(stack[index]) === JSON.stringify(route)) return;
    set({ stack: [...stack.slice(0, index + 1), route].slice(-50), index: Math.min(index + 1, 49), overlay: null });
    document.querySelector(".content")?.scrollTo({ top: 0 });
  },
  root: (route) => {
    const { stack, index } = get();
    if (JSON.stringify(stack[index]) === JSON.stringify(route)) {
      document.querySelector(".content")?.scrollTo({ top: 0, behavior: "smooth" });
      set({ overlay: null });
      return;
    }
    set({ stack: [...stack.slice(0, index + 1), route].slice(-50), index: Math.min(index + 1, 49), overlay: null });
    document.querySelector(".content")?.scrollTo({ top: 0 });
  },
  back: () => {
    const { index, overlay } = get();
    if (overlay) return set({ overlay: null });
    if (index > 0) set({ index: index - 1 });
  },
  forward: () => {
    const { index, stack } = get();
    if (index < stack.length - 1) set({ index: index + 1 });
  },
  setOverlay: (overlay) => set({ overlay }),
  openReader: (reader) => set({ reader }),
  setPalette: (palette) => set({ palette }),
}));

export const nav = () => useNav.getState();
export const go = (route: Route) => useNav.getState().go(route);

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, tone?: "error" | "ok") {
  clearTimeout(toastTimer);
  useNav.setState({ toast: { id: ++toastId, text, tone } });
  toastTimer = setTimeout(() => useNav.setState({ toast: null }), tone === "error" ? 5000 : 3000);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
