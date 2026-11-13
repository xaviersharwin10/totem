// Production server: the built app (dist/) plus the same /api endpoints the
// Vite dev server mounts, on one port. With TELEGRAM_BOT_TOKEN set it also runs
// the Telegram bot in this process, so one always-on service hosts everything.
//
//   npm run build && npm start        (PORT defaults to 8080)
import "../bot/env";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { rpcHandler } from "./rpc";
import { voiceHandler } from "./voice";
import { guestHandler, proposeHandler, relayHandler } from "./relay";
import { historyHandler } from "./history";
import { autoHatchHandler, startAutoHatch } from "./autohatch";
import { denHandler } from "./den";
import { linkHandler } from "./link";
import { waitlistHandler } from "./waitlist";

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;
const routes: [string, Handler][] = [
  ["/api/guest", guestHandler],
  ["/api/relay", relayHandler],
  ["/api/propose", proposeHandler],
  ["/api/voice", voiceHandler],
  ["/api/history", historyHandler],
  ["/api/autohatch", autoHatchHandler],
  ["/api/den", denHandler],
  ["/api/link", linkHandler],
  ["/api/waitlist", waitlistHandler],
  ["/rpc", rpcHandler],
];

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wasm": "application/wasm",
};

// The page's link-preview tags need absolute URLs (X ignores relative ones), so
// the server writes this site's own address into index.html.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").replace(/\/$/, "");
function originOf(req: IncomingMessage): string {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers["x-forwarded-proto"] ?? "http").split(",")[0];
  return `${proto}://${req.headers.host ?? "localhost"}`;
}
let indexHtml: string | null = null;

function serveStatic(path: string, res: ServerResponse, req: IncomingMessage) {
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) file = join(DIST, "index.html");
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  const isIndex = file.endsWith("index.html");
  res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
  if (isIndex) {
    res.setHeader("cache-control", "no-cache");
    indexHtml ??= readFileSync(file, "utf8");
    return res.end(indexHtml.replaceAll("__ORIGIN__", originOf(req)));
  }
  // og.jpg keeps a stable name for link previews: cache it for a day, not forever
  res.setHeader("cache-control", file.endsWith("og.jpg") ? "public, max-age=86400" : "public, max-age=31536000, immutable");
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") return res.end("ok");
  for (const [prefix, h] of routes) {
    if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
      // the dev middlewares see the path with their mount prefix stripped
      req.url = url.pathname.slice(prefix.length) + url.search || "/";
      return Promise.resolve(h(req, res)).catch((e) => {
        console.error(prefix, e);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
    }
  }
  serveStatic(url.pathname, res, req);
});

const PORT = Number(process.env.PORT ?? 8080);
server.listen(PORT, () => console.log(`TOTEM app on :${PORT}`));
startAutoHatch();

if (process.env.TELEGRAM_BOT_TOKEN && process.env.RUN_BOT !== "0") {
  await import("../bot/bot");
}

// Free hosting sleeps after ~15 idle minutes, which would also stop the bot's
// watch loop. Ping our own public URL so the alarms keep ringing.
const SELF = process.env.RENDER_EXTERNAL_URL;
if (SELF) setInterval(() => fetch(`${SELF}/healthz`).catch(() => {}), 10 * 60 * 1000);
