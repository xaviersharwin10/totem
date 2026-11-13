// Posts the big moments of BaoBao's life to X (@babaoOnNear): a hatch, a
// Rampage (with the rescue link, which unfurls into the Panda Island card), a
// rescue, an evolution, a death, and one daily update.
//
// Keys (OAuth 1.0a user context, "Read and write"), in web/.env or Render:
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// Posting is OFF unless X_POST=live. Without it the bot only logs
// "[x dry-run] …" lines, so the wording can be checked first.
//
// Each post costs money on X's pay-per-use plan, so it is capped: at most
// X_MAX_PER_DAY posts a day (default 12) and one every X_MIN_GAP_MIN minutes
// (default 20; deaths and hatches may skip the gap). Posts over the cap are
// dropped, not queued: a stale "RAMPAGE!" is worse than none.
import { createHmac, randomBytes } from "node:crypto";

const KEY = process.env.X_API_KEY ?? "";
const SECRET = process.env.X_API_SECRET ?? "";
const TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const TOKEN_SECRET = process.env.X_ACCESS_SECRET ?? "";
const CONFIGURED = !!(KEY && SECRET && TOKEN && TOKEN_SECRET);
const LIVE = CONFIGURED && process.env.X_POST === "live";
const MAX_PER_DAY = Number(process.env.X_MAX_PER_DAY ?? 12);
const MIN_GAP_MS = Number(process.env.X_MIN_GAP_MIN ?? 20) * 60_000;
const URL_POST = "https://api.x.com/2/tweets";

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** OAuth 1.0a HMAC-SHA1 header. A JSON body is not part of the signature. */
function authHeader(method: string, url: string): string {
  const o: Record<string, string> = {
    oauth_consumer_key: KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: TOKEN,
    oauth_version: "1.0",
  };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join("&");
  o.oauth_signature = createHmac("sha1", `${enc(SECRET)}&${enc(TOKEN_SECRET)}`).update(`${method}&${enc(url)}&${enc(params)}`).digest("base64");
  return "OAuth " + Object.keys(o).map((k) => `${enc(k)}="${enc(o[k])}"`).join(", ");
}

const sent: number[] = []; // timestamps of posts in the last 24 h
let queue: Promise<void> = Promise.resolve();

export const xMode = !CONFIGURED ? "off (no keys)" : LIVE ? "LIVE" : "dry-run (set X_POST=live to post)";

/**
 * Post `text` to X if the caps allow. `urgent` posts (a death, a hatch) skip
 * the minimum gap but still count toward the daily cap.
 */
export function xPost(text: string, urgent = false): void {
  if (!CONFIGURED) return;
  queue = queue.then(async () => {
    const now = Date.now();
    while (sent.length && now - sent[0] > 86_400_000) sent.shift();
    if (sent.length >= MAX_PER_DAY) return console.log(`[x] daily cap (${MAX_PER_DAY}) reached, dropped: ${text.split("\n")[0]}`);
    if (!urgent && sent.length && now - sent[sent.length - 1] < MIN_GAP_MS) return console.log(`[x] too soon after the last post, dropped: ${text.split("\n")[0]}`);
    sent.push(now);
    if (!LIVE) return console.log(`[x dry-run] would post:\n${text}\n`);
    try {
      const r = await fetch(URL_POST, {
        method: "POST",
        headers: { authorization: authHeader("POST", URL_POST), "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await r.text();
      if (!r.ok) {
        sent.pop();
        return console.error(`[x] post failed ${r.status}: ${body.slice(0, 300)}`);
      }
      console.log(`[x] posted ${JSON.parse(body)?.data?.id ?? ""}: ${text.split("\n")[0]}`);
    } catch (e) {
      sent.pop();
      console.error("[x] post failed:", e instanceof Error ? e.message : e);
    }
  });
}
