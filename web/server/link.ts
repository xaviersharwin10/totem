// "🔔 Get BaoBao's alerts on Telegram": the one-tap link from the app to the bot.
//
// The player signs a free message proving the account is theirs (server/auth.ts),
// and we hand back a t.me deep link carrying a one-time code. Opening it starts
// the bot with `/start link_<code>`; the bot swaps the code for the account and
// watches it in that chat, as a *linked* account: one that asked for personal
// nudges ("I miss you"). Codes live 15 minutes, work once, and sit in a small
// file the bot reads (the bot may run in this process or its own).
//
//   POST /api/link  { accountId, publicKey?, signature, nonce, scheme? } -> { url }
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { verifyOwnership, type SignedProof } from "./auth";

export const LINK_RECIPIENT = "totem-telegram";
export const linkMessage = (accountId: string) => `Send BaoBao's Telegram alerts about ${accountId}`;
export const LINKS_FILE = process.env.BOT_LINKS_FILE ?? new URL("../bot/links.json", import.meta.url).pathname;
const CODE_MS = 15 * 60 * 1000;

type Codes = Record<string, { account: string; exp: number }>;
const readCodes = (): Codes => {
  try {
    return existsSync(LINKS_FILE) ? JSON.parse(readFileSync(LINKS_FILE, "utf8")) : {};
  } catch {
    return {};
  }
};
const writeCodes = (c: Codes) => {
  for (const [k, v] of Object.entries(c)) if (v.exp < Date.now()) delete c[k];
  writeFileSync(LINKS_FILE, JSON.stringify(c));
};

/** The bot's side: swap a code for its account (once). */
export function redeemLinkCode(code: string): string | null {
  const c = readCodes();
  const hit = c[code];
  if (!hit) return null;
  delete c[code];
  writeCodes(c);
  return hit.exp >= Date.now() ? hit.account : null;
}

let botName: string | null = process.env.TELEGRAM_BOT_USERNAME ?? null;
async function botUsername(): Promise<string | null> {
  if (botName) return botName;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const j = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()) as { ok: boolean; result?: { username: string } };
    botName = j.result?.username ?? null;
  } catch {}
  return botName;
}

function send(res: ServerResponse, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, bad) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 20_000) req.destroy();
    });
    req.on("end", () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch (e) {
        bad(e);
      }
    });
  });
}

export async function linkHandler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === "GET") {
      const name = await botUsername();
      return send(res, 200, { enabled: !!name, bot: name });
    }
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    const name = await botUsername();
    if (!name) return send(res, 503, { error: "Telegram alerts aren't set up on this server." });
    const b = await readJson(req);
    const proof = await verifyOwnership(b as unknown as SignedProof, linkMessage(String(b.accountId ?? "")), LINK_RECIPIENT);
    if (proof.ok === false) return send(res, proof.status, { error: proof.error });
    const code = randomBytes(12).toString("base64url"); // 16 chars, fits Telegram's start parameter
    const c = readCodes();
    c[code] = { account: proof.accountId, exp: Date.now() + CODE_MS };
    writeCodes(c);
    return send(res, 200, { url: `https://t.me/${name}?start=link_${code}`, bot: name });
  } catch (e) {
    return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}
