import { account, bookClient, musicClient } from "./accounts";
import { connectionOf, mediaURL } from "./http";
import { proxied } from "./native";
import { resizedArtwork } from "./servers/amplicon";

/** Picks the nearest of a few sizes, so the image cache sees the same URLs. */
const bucket = (size: number) => [64, 128, 300, 600, 1000].find((s) => s >= size * (window.devicePixelRatio || 1)) ?? 1000;

export function artworkURL(serverId: string | undefined, artworkId: string | undefined, size: number): string | undefined {
  if (!serverId || !artworkId) return undefined;
  const a = account(serverId);
  if (!a) return undefined;
  const px = bucket(size);
  if (a.kind === "amplicon") return /^https?:/.test(artworkId) ? proxied(resizedArtwork(artworkId, px)) : undefined;
  const client = musicClient(serverId);
  if (!client) return undefined;
  try {
    return mediaURL(connectionOf(a), client.artworkURL(artworkId, px));
  } catch {
    return undefined;
  }
}

export function coverURL(serverId: string, artworkId: string | undefined, size: number): string | undefined {
  if (!artworkId) return undefined;
  const a = account(serverId);
  const client = bookClient(serverId);
  if (!a || !client) return undefined;
  return mediaURL(connectionOf(a), client.coverURL(artworkId, bucket(size)));
}

/** The average colour of an image, a bit saturated, for backgrounds behind covers. */
const colorCache = new Map<string, string>();
export async function dominantColor(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  if (colorCache.has(url)) return colorCache.get(url)!;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        let r = 0, gr = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          // Colourful pixels count more than grey ones.
          const w = 1 + ((max - min) / 255) * 4;
          r += d[i] * w; gr += d[i + 1] * w; b += d[i + 2] * w; n += w;
        }
        const color = `rgb(${Math.round(r / n)}, ${Math.round(gr / n)}, ${Math.round(b / n)})`;
        colorCache.set(url, color);
        resolve(color);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
