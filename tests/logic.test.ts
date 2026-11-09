import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Modules that touch browser storage at import time get a small stand-in.
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal("navigator", { language: "en-US", userAgent: "Mac" });
vi.stubGlobal("window", { addEventListener: () => {} });
vi.stubGlobal(
  "Audio",
  class {
    addEventListener() {}
  },
);

const { md5 } = await import("../src/lib/md5");
const { sha256, hmacSha256 } = await import("../src/lib/sha256");
const { normalize, rank } = await import("../src/lib/search");
const { parseOnAir, monogram } = await import("../src/lib/radio");
const { authorFromFileName, headerSafe } = await import("../src/lib/servers/jellyfin");
const { AmpliconClient, resizedArtwork } = await import("../src/lib/servers/amplicon");
const { SubsonicClient } = await import("../src/lib/servers/subsonic");
const { isLocalAddress, normalizeServerURL } = await import("../src/lib/http");

const enc = new TextEncoder();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("hashes", () => {
  it("md5 matches node for short, long and unicode text", () => {
    for (const t of ["", "a", "test&pass1abcdef", "x".repeat(55), "y".repeat(56), "z".repeat(200), "Zürich – Björk"])
      expect(md5(t)).toBe(createHash("md5").update(t).digest("hex"));
  });
  it("sha256 and hmac match node", () => {
    for (const t of ["", "abc", "q".repeat(64), "w".repeat(119)]) expect(hex(sha256(enc.encode(t)))).toBe(createHash("sha256").update(t).digest("hex"));
    const key = "s3cret-key";
    expect(hex(hmacSha256(enc.encode(key), enc.encode("/api/stream/abc:1700000000")))).toBe(createHmac("sha256", key).update("/api/stream/abc:1700000000").digest("hex"));
    const long = "k".repeat(100);
    expect(hex(hmacSha256(enc.encode(long), enc.encode("m")))).toBe(createHmac("sha256", long).update("m").digest("hex"));
  });
});

describe("search", () => {
  it("ignores accents and Swiss spellings", () => {
    expect(normalize("Zürich")).toBe(normalize("zuerich"));
    expect(normalize("Björk")).toBe("bjork");
    expect(normalize("AC/DC")).toBe("ac dc");
  });
  it("ranks name starts first", () => {
    const items = ["The Beatles", "Beat It", "Heartbeat"];
    expect(rank("beat", items, (x) => x)).toEqual(["Beat It", "The Beatles", "Heartbeat"]);
  });
});

describe("radio", () => {
  const station = { id: "x", name: "Radio Pilatus", shortName: "Pilatus", country: "CH", genres: [], color: "#000", streams: [] };
  it("parses artist and title, drops station names and ads", () => {
    expect(parseOnAir("Daft Punk - One More Time", station)).toEqual({ artist: "Daft Punk", title: "One More Time" });
    expect(parseOnAir("ST. GERMAIN - ROSE ROUGE", station)).toEqual({ artist: "St. Germain", title: "Rose Rouge" });
    expect(parseOnAir("AC/DC - Thunderstruck", station)?.artist).toBe("AC/DC");
    expect(parseOnAir("Radio Pilatus", station)).toBeNull();
    expect(parseOnAir("www.pilatus.ch", station)).toBeNull();
    expect(parseOnAir("Werbung", station)).toBeNull();
    expect(parseOnAir("041 210 10 10", station)).toBeNull();
    expect(parseOnAir("LIVE", station)).toBeNull();
  });
  it("makes short monograms", () => {
    expect(monogram({ ...station, shortName: "SRF 3" })).toBe("SRF 3");
    expect(monogram({ ...station, shortName: undefined, name: "Radio Swiss Jazz" })).toBe("SJ");
  });
});

describe("servers", () => {
  it("reads authors from file names", () => {
    expect(authorFromFileName("Dune - Frank Herbert.epub", "Dune")).toBe("Frank Herbert");
    expect(authorFromFileName("Dune.epub", "Dune")).toBeUndefined();
  });
  it("keeps Jellyfin headers ASCII", () => {
    expect(headerSafe("Elias’s MacBook, \"Pro\"")).toBe("Elias's MacBook Pro");
    expect(headerSafe("Zürich")).toBe("Zurich");
  });
  it("signs Amplicon stream links like the server expects", () => {
    const c = new AmpliconClient({ url: "https://amp.example.com", allowsUnencrypted: false }, "s", { token: "t", secret: "sec", deviceId: 7 });
    const now = Date.UTC(2026, 10, 9, 9, 41);
    const url = new URL(c.signed("api/stream/vid1", now));
    const exp = Math.floor(now / 1000 / 3600) * 3600 + 86400;
    expect(url.pathname).toBe("/api/stream/vid1");
    expect(url.searchParams.get("d")).toBe("7");
    expect(url.searchParams.get("exp")).toBe(String(exp));
    expect(url.searchParams.get("sig")).toBe(createHmac("sha256", "sec").update(`/api/stream/vid1:${exp}`).digest("hex"));
  });
  it("resizes Google artwork", () => {
    expect(resizedArtwork("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", 300)).toBe("https://lh3.googleusercontent.com/abc=w300-h300-l90-rj");
  });
  it("builds Subsonic URLs with encoded values and no estimateContentLength", () => {
    const c = new SubsonicClient({ url: "https://music.example.com/", allowsUnencrypted: false }, "s", "a&b", { t: "tok", s: "salt" });
    const raw = new URL(c.streamURL("42", "flac", undefined));
    expect(raw.pathname).toBe("/rest/stream.view");
    expect(raw.searchParams.get("u")).toBe("a&b");
    expect(raw.searchParams.get("format")).toBe("raw");
    expect(raw.search).not.toContain("estimateContentLength");
    expect(new URL(c.streamURL("42", "wma", undefined)).searchParams.get("format")).toBe("mp3");
    expect(new URL(c.streamURL("42", "flac", 192)).searchParams.get("maxBitRate")).toBe("192");
  });
  it("normalizes addresses and knows home addresses", () => {
    expect(normalizeServerURL("music.example.com/")).toBe("https://music.example.com");
    expect(normalizeServerURL("http://192.168.1.4:4533")).toBe("http://192.168.1.4:4533");
    expect(isLocalAddress("http://192.168.1.4:4533")).toBe(true);
    expect(isLocalAddress("http://nas.local")).toBe(true);
    expect(isLocalAddress("http://music.example.com")).toBe(false);
  });
});
