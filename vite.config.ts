import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { Readable } from "node:stream";

const host = process.env.TAURI_DEV_HOST;

/**
 * In a plain browser (npm run dev, no Tauri) there is no Rust proxy. This stands in for it during development,
 * so the interface can be worked on against real servers: `/__ampli/f?u=<url>` forwards with CORS.
 */
function devProxy(): Plugin {
  return {
    name: "ampli-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/__ampli/f", async (req, res) => {
        const target = new URL(req.url ?? "", "http://x").searchParams.get("u");
        if (req.method === "OPTIONS") {
          res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
          return res.end();
        }
        if (!target || !/^https?:\/\//.test(target)) {
          res.statusCode = 400;
          return res.end("bad url");
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string" && !["host", "origin", "referer", "connection", "content-length"].includes(k) && !k.startsWith("sec-")) headers[k] = v;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          const upstream = await fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "follow" });
          const out: Record<string, string> = { "access-control-allow-origin": "*", "access-control-expose-headers": "*" };
          upstream.headers.forEach((v, k) => {
            if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k) && !k.startsWith("access-control-")) out[k] = v;
          });
          res.writeHead(upstream.status, out);
          if (upstream.body) Readable.fromWeb(upstream.body as never).pipe(res);
          else res.end();
        } catch (e) {
          res.writeHead(502, { "x-ampli-error": "network", "access-control-allow-origin": "*", "access-control-expose-headers": "*" });
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProxy()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
});
