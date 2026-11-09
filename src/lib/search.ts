/** Lowercase, no accents, Swiss spellings without umlauts ("zuerich" finds "Zürich"), only letters and digits. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Ranks `items` for `query`: names starting with the words first, then names containing them, then other fields. */
export function rank<T>(query: string, items: T[], name: (t: T) => string, extra?: (t: T) => string, limit = 50): T[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const scored: [T, number][] = [];
  for (const item of items) {
    const n = " " + normalize(name(item));
    const hay = extra ? n + " " + normalize(extra(item)) : n;
    if (!tokens.every((t) => hay.includes(t))) continue;
    const score = tokens.every((t) => n.includes(" " + t)) ? 0 : tokens.every((t) => n.includes(t)) ? 1 : 2;
    scored.push([item, score]);
  }
  scored.sort((a, b) => a[1] - b[1] || name(a[0]).localeCompare(name(b[0])));
  return scored.slice(0, limit).map((s) => s[0]);
}
