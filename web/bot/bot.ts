// The TOTEM Telegram bot: the tribe's alarm bell.
//
// The Totem starves on a clock while nobody is looking. This bot watches the
// chain and tells the tribe when it matters: starving, Rampage, every bite,
// the rescue (and who did it), death, the hatch vote, the new egg. Anyone can
// also watch their own account (public data, no login): shield running out,
// a stake left unshielded before a bite, a Blessing about to expire, a vote
// that needs them as a Keeper.
//
//   cd web
//   TELEGRAM_BOT_TOKEN=… npm run bot          (or put it in web/.env)
//   npm run bot -- --dry-run                  (no Telegram: prints what it would send;
//                                              type /status, /watch x.testnet … on stdin)
//
// It also cheers the tribe on: it thanks feeders by name (first feeds, comebacks,
// rescues, and a digest of everyone else), now and then reminds the quiet holders
// that BaoBao exists (as a crowd, never by name), and tells accounts that were
// *linked* from the app (🔔 button, a signed proof of ownership) when BaoBao
// misses them.
//
// Talks to the Bot API directly (long polling, no webhook), so it runs on any
// machine with outbound HTTPS. Reads the chain through the same RPC rotation as
// the web server; /ask uses the Totem's voice (NEAR AI Cloud, needs NEAR_AI_API_KEY).
import "./env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { rpcForward } from "../server/rpc";
import { history } from "../server/history";
import { voiceReply } from "../server/voice";
import { redeemLinkCode } from "../server/link";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DRY = process.argv.includes("--dry-run") || !TOKEN;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
const DAO_ID = process.env.VITE_DAO_ID ?? "totem-tribe.sputnik-v2.testnet";
const APP_URL = (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://127.0.0.1:5174").replace(/\/$/, "");
const EXPLORER = "https://testnet.nearblocks.io";
const STATE_FILE = process.env.BOT_STATE_FILE ?? new URL("./state.json", import.meta.url).pathname;
const POLL_MS = Number(process.env.BOT_POLL_MS ?? 8000);
const MAX_WATCH = 3;
const ONE = 10n ** 18n;

// ------------------------------------------------------------------ chain

interface Totem {
  lineage_name: string;
  generation: number;
  alive: boolean;
  fullness_bp: number;
  mood: string;
  level: number;
  max_level: number;
  bites_until_death: number;
  form: string;
  reserve: string;
  hoard: string;
  treasury?: string;
  fill_amount: string;
  seconds_until_starving: string | null;
  seconds_until_rampage: string | null;
  seconds_until_next_bite: string | null;
  seconds_until_death: string | null;
}
interface Stats {
  total_burned: string;
  total_supply: string;
}
interface Life {
  generation: number;
  lineage_name: string;
  alive: boolean;
  max_level: number;
  lifespan_sec: string | null;
  cause_of_death: string | null;
  top_feeders: [string, string][];
  stats: { fed: string; burned: string };
}
interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: Record<string, any>;
  status: string;
  votes: Record<string, string>;
}
interface StakeView {
  generation: number;
  staked: string;
  unbonding: string;
  shielded: boolean;
  seconds_shield_left: string | null;
  released: boolean;
}

async function viewAt<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "bot",
    method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
  });
  const out = await rpcForward(body);
  const j = JSON.parse(out.body);
  if (!j.result?.result) throw new Error(`${method}: ${j.error?.cause?.name ?? j.error?.message ?? j.result?.error ?? "view failed"}`.slice(0, 200));
  return JSON.parse(Buffer.from(j.result.result).toString());
}
const view = <T>(m: string, a: object = {}) => viewAt<T>(CONTRACT_ID, m, a);

// ------------------------------------------------------------------ formatting

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tokens = (y: string | bigint) => {
  const v = BigInt(y || 0);
  const whole = v / ONE;
  const frac = Number((v % ONE) / 10n ** 16n);
  return whole >= 100n || frac === 0 ? whole.toLocaleString("en-US") : `${whole}.${String(frac).padStart(2, "0")}`;
};
const secs = (s: string | number | null | undefined) => {
  if (s === null || s === undefined) return "—";
  const n = Math.max(0, Math.floor(Number(s)));
  if (n >= 2 * 86400) return `${Math.floor(n / 86400)} days`;
  if (n >= 3600) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  if (n >= 60) return `${Math.floor(n / 60)}m ${n % 60}s`;
  return `${n}s`;
};
const who = (a: string) =>
  a.endsWith(".totem-grumbo-relay.testnet") ? `guest ${a.split(".")[0]}` : a.length > 30 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
const MOOD: Record<string, string> = { happy: "😊 happy", content: "🙂 content", hungry: "🥺 hungry", starving: "😫 starving", rampage: "🔥 RAMPAGE", dead: "🪦 dead" };
const bar = (bp: number) => {
  const n = Math.round(bp / 1000);
  return "█".repeat(n) + "░".repeat(10 - n);
};
const publicUrl = /^https:\/\//.test(APP_URL);

type Button = { text: string; url: string };
const links = {
  rescue: { text: "🦸 Rescue it (free, no wallet)", url: `${APP_URL}/?rescue=1` },
  farm: { text: "🐼 Open the farm", url: `${APP_URL}/` },
  tribe: { text: "🏛 Vote in the Tribe", url: `${APP_URL}/?tribe=1` },
  treasury: (t: Totem) => ({ text: "🏦 Treasury on the explorer", url: `${EXPLORER}/address/${t.treasury}` }),
};

function statusText(t: Totem, s: Stats): string {
  const pct = Math.round(t.fullness_bp / 100);
  const lines = [`<b>${esc(t.lineage_name)}</b> · Level ${t.level} ${esc(t.form)} · ${MOOD[t.mood] ?? esc(t.mood)}`];
  if (!t.alive) {
    lines.push("It starved. Only the tribe's Keepers can vote to hatch the next egg.");
  } else {
    lines.push(`Belly <code>${bar(t.fullness_bp)}</code> ${pct}%`);
    if (t.mood === "rampage") lines.push(`⚔️ Next bite in <b>${secs(t.seconds_until_next_bite)}</b> · ${t.bites_until_death} bite${t.bites_until_death === 1 ? "" : "s"} from death`);
    else if (t.seconds_until_rampage) lines.push(`Rampage in ${secs(t.seconds_until_rampage)} if nobody feeds it`);
    lines.push(`To fill it: ${tokens(t.fill_amount)} $TOTEM`);
  }
  lines.push(`💰 Treasury ${tokens(t.hoard)} · 🔥 burned forever ${tokens(s.total_burned)}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ state

interface ChatState {
  alerts: boolean;
  watch: string[];
  /** accounts linked from the app (signed proof): they asked for personal nudges */
  linked?: string[];
  title?: string;
}
interface State {
  offset: number;
  chats: Record<string, ChatState>;
  /** keys of personal alerts already sent (dedupe across restarts) */
  sent: Record<string, number>;
  /** newest feed event already celebrated (ms) */
  cheeredUpTo?: number;
}
const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { offset: 0, chats: {}, sent: {} };
const save = () => {
  // forget dedupe keys older than a day
  const cut = Date.now() - 3 * 86_400_000;
  for (const [k, v] of Object.entries(state.sent)) if (v < cut) delete state.sent[k];
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};
const chat = (id: string): ChatState => (state.chats[id] ??= { alerts: true, watch: [] });

// ------------------------------------------------------------------ telegram

async function tg<T = any>(method: string, body: object, attempt = 0): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // network blips (ECONNRESET, DNS, timeouts): back off and retry
    if (attempt >= 5) throw e;
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    return tg(method, body, attempt + 1);
  }
  const j = (await r.json()) as { ok: boolean; result: T; description?: string; parameters?: { retry_after?: number } };
  if (!j.ok) {
    if (j.parameters?.retry_after) {
      await new Promise((res) => setTimeout(res, (j.parameters!.retry_after! + 1) * 1000));
      return tg(method, body);
    }
    throw new Error(`${method}: ${j.description}`);
  }
  return j.result;
}

// One queue per chat so alerts arrive in order and within Telegram's limits.
const queues = new Map<string, Promise<void>>();
function send(chatId: string, html: string, buttons: Button[] = []) {
  let text = html;
  // Telegram refuses non-public URLs in buttons; put them in the text instead.
  if (buttons.length && !publicUrl) text += "\n\n" + buttons.map((b) => `${b.text}: ${b.url}`).join("\n");
  if (DRY) {
    console.log(`\n── to ${chatId} ──\n${text.replace(/<[^>]+>/g, "")}${publicUrl && buttons.length ? `\n[${buttons.map((b) => b.text).join("] [")}]` : ""}`);
    return;
  }
  const prev = queues.get(chatId) ?? Promise.resolve();
  const next = prev
    .then(() =>
      tg("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(publicUrl && buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [b]) } } : {}),
      })
    )
    .then(() => new Promise<void>((r) => setTimeout(r, 1100)))
    .catch((e) => {
      console.error(`send to ${chatId} failed:`, e.message);
      // blocked or kicked: stop alerting that chat
      if (/blocked|kicked|not found|deactivated/i.test(e.message)) delete state.chats[chatId];
    });
  queues.set(chatId, next);
}
const broadcastAll = (html: string, buttons: Button[] = []) => {
  for (const [id, c] of Object.entries(state.chats)) if (c.alerts) send(id, html, buttons);
};
const broadcast = broadcastAll;

// ------------------------------------------------------------------ commands

const HELP = `🐼 <b>TOTEM</b>: one panda the whole tribe keeps alive on NEAR.
Feed it $TOTEM: half burns, half goes to its treasury. Starve it and it bites: every bite burns 15% of the treasury and slashes unshielded stakes. At Level 0 it dies, and the Keepers vote to hatch the next egg.

This chat now gets the alarms: starving, Rampage, every bite, rescues, death, hatch votes.

/status the Totem right now
/watch <i>account.testnet</i> personal alerts for an account (shield, Blessings, Keeper votes)
/unwatch <i>account</i> · /me your watched accounts
/lives the lineage · /ask <i>question</i> talk to the Totem
/alerts on|off · /rescue the one-tap rescue link

🔔 <b>Your own alerts in one tap:</b> open the farm, connect your wallet and press 🔔. No typing account names.`;

const asked = new Map<string, number>();

async function command(chatId: string, raw: string, title?: string) {
  const [cmd0, ...rest] = raw.trim().split(/\s+/);
  const cmd = cmd0.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();
  const c = chat(chatId);
  if (title) c.title = title;
  try {
    switch (cmd) {
      case "/start":
        if (arg.startsWith("link_")) {
          await linkChat(chatId, c, arg.slice(5));
          break;
        }
        c.alerts = true;
        send(chatId, HELP, [links.farm]);
        break;
      case "/help":
        c.alerts = true;
        send(chatId, HELP, [links.farm]);
        break;
      case "/status": {
        const [t, s] = await Promise.all([view<Totem>("get_totem"), view<Stats>("get_stats")]);
        send(chatId, statusText(t, s), t.alive ? (t.mood === "rampage" || t.mood === "starving" ? [links.rescue] : [links.farm, links.treasury(t)]) : [links.tribe]);
        break;
      }
      case "/rescue":
        send(chatId, "One tap, no wallet, no NEAR: the game makes you a free account and pays the gas.", [links.rescue]);
        break;
      case "/alerts":
        c.alerts = arg !== "off";
        send(chatId, c.alerts ? "🔔 Alerts on for this chat." : "🔕 Alerts off. /alerts on to turn them back on.");
        break;
      case "/stop":
        delete state.chats[chatId];
        send(chatId, "👋 This chat won't get alerts or watches any more. /start to come back.");
        break;
      case "/watch": {
        const a = arg.toLowerCase();
        if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a) || a.length < 2 || a.length > 64) {
          send(chatId, "Usage: /watch <i>your-account.testnet</i>");
          break;
        }
        if (!c.watch.includes(a)) {
          if (c.watch.length >= MAX_WATCH) {
            send(chatId, `This chat already watches ${MAX_WATCH} accounts. /unwatch one first.`);
            break;
          }
          c.watch.push(a);
        }
        send(chatId, `👀 Watching <b>${esc(who(a))}</b>. I'll tell you when its shield is about to end, when a bite is coming for an unshielded stake, when a Blessing is about to expire, and when a vote needs it as a Keeper. All public on-chain data; no login.\n\n${await meText(a)}`);
        break;
      }
      case "/unwatch":
        c.watch = c.watch.filter((x) => x !== arg.toLowerCase());
        c.linked = (c.linked ?? []).filter((x) => x !== arg.toLowerCase());
        send(chatId, `Stopped watching ${esc(arg)}.`);
        break;
      case "/me":
        if (!c.watch.length) send(chatId, "Nothing watched yet. /watch <i>your-account.testnet</i>");
        else for (const a of c.watch) send(chatId, await meText(a));
        break;
      case "/lives": {
        const lives = (await view<Life[]>("get_lineage", { limit: 100 })).slice(-6).reverse();
        send(
          chatId,
          "<b>The lineage</b>\n" +
            lives
              .map(
                (l) =>
                  `${l.alive ? "🐼" : "🪦"} <b>${esc(l.lineage_name)}</b>: ${l.alive ? "alive" : esc(l.cause_of_death ?? "dead")}, best Level ${l.max_level}` +
                  `${l.lifespan_sec ? `, lived ${secs(l.lifespan_sec)}` : ""}, fed ${tokens(l.stats.fed)}` +
                  (l.top_feeders[0] ? `, top feeder ${esc(who(l.top_feeders[0][0]))}` : "")
              )
              .join("\n")
        );
        break;
      }
      case "/ask": {
        if (!arg) {
          send(chatId, "Ask the Totem something: /ask <i>who feeds you the most?</i>");
          break;
        }
        const last = asked.get(chatId) ?? 0;
        if (Date.now() - last < 8000) break;
        asked.set(chatId, Date.now());
        const r = await voiceReply({ messages: [{ role: "user", content: arg.slice(0, 300) }] });
        send(chatId, `🐼 ${esc(r.reply)}`);
        break;
      }
      default:
        if (cmd.startsWith("/")) send(chatId, HELP);
    }
  } catch (e) {
    send(chatId, `Couldn't read the chain just now (${esc(e instanceof Error ? e.message : e)}). Try again in a moment.`);
  } finally {
    save();
  }
}

/** `/start link_<code>` from the app's 🔔 button: watch that account here, as linked. */
async function linkChat(chatId: string, c: ChatState, code: string) {
  const a = redeemLinkCode(code);
  if (!a) {
    send(chatId, "That link has expired or was already used. Tap 🔔 in the app again to get a fresh one.", [links.farm]);
    return;
  }
  c.alerts = true;
  c.watch = [a, ...c.watch.filter((x) => x !== a)].slice(0, MAX_WATCH);
  c.linked = [a, ...(c.linked ?? []).filter((x) => x !== a)].slice(0, MAX_WATCH);
  send(
    chatId,
    `🔔 <b>Linked: ${esc(who(a))}</b>\nYou'll hear from me here when I'm starving or on a Rampage, when your shield is running out, when a Blessing is waiting for you, and (only because you asked) when I miss you. /unwatch ${esc(a)} to stop.\n\n${await meText(a)}`,
    [links.farm]
  );
}

async function meText(a: string): Promise<string> {
  const [st, claims, k] = await Promise.all([
    view<StakeView | null>("get_stake", { account_id: a }).catch(() => null),
    view<{ period_id: number; amount: string }[]>("get_claimable", { account_id: a }).catch(() => []),
    view<{ eligible: boolean; badge_earned: string }>("get_keeper", { account_id: a }).catch(() => null),
  ]);
  const lines = [`<b>${esc(who(a))}</b>`];
  if (!st || (BigInt(st.staked) === 0n && BigInt(st.unbonding) === 0n)) lines.push("No stake in the belly.");
  else if (st.released) lines.push(`↩️ ${tokens(BigInt(st.staked) + BigInt(st.unbonding))} released from a dead Totem: withdraw or re-stake it.`);
  else lines.push(`🛡 ${tokens(st.staked)} staked · ${st.shielded ? `shielded for ${secs(st.seconds_shield_left)}` : "⚠️ NOT shielded: feed 5 to protect it"}`);
  if (claims.length) lines.push(`🎁 ${claims.length} Blessing${claims.length > 1 ? "s" : ""} to claim (${tokens(claims.map((c) => BigInt(c.amount)).reduce((x, y) => x + y, 0n))} $TOTEM)`);
  if (k?.eligible) lines.push("🏛 Qualifies as a Keeper");
  return lines.join("\n");
}

// ------------------------------------------------------------------ the watcher

let prev: { t: Totem; s: Stats; open: Map<number, Proposal> } | null = null;

const kindOf = (p: Proposal) => {
  const fc = p.kind.FunctionCall;
  if (fc?.receiver_id === CONTRACT_ID) return fc.actions?.[0]?.method_name as string;
  if (p.kind.AddMemberToRole) return "add_keeper";
  if (p.kind.RemoveMemberFromRole) return "remove_keeper";
  if (p.kind.ChangePolicy) return "policy";
  return "other";
};
const proposalTitle = (p: Proposal, t: Totem) => {
  switch (kindOf(p)) {
    case "hatch":
      return "🥚 Hatch the next egg";
    case "rename":
      return "✏️ Rename the Totem";
    case "choose_evolution":
      return "🐉 Choose its evolution";
    case "add_keeper":
      return `🛡 Make ${esc(who(p.kind.AddMemberToRole.member_id))} a Keeper`;
    case "remove_keeper":
      return `🚪 Remove Keeper ${esc(who(p.kind.RemoveMemberFromRole.member_id))}`;
    case "policy":
      return "📜 Change the tribe's constitution";
    default:
      return esc(p.description.slice(0, 60)) + ` (${t.lineage_name})`;
  }
};

async function readWorld() {
  const [t, s, last, policy] = await Promise.all([
    view<Totem>("get_totem"),
    view<Stats>("get_stats"),
    viewAt<number>(DAO_ID, "get_last_proposal_id"),
    viewAt<{ roles: { name: string; kind: any }[]; proposal_period: string }>(DAO_ID, "get_policy"),
  ]);
  const props = await viewAt<Proposal[]>(DAO_ID, "get_proposals", { from_index: Math.max(0, last - 10), limit: 10 });
  const keepers: string[] = policy.roles.find((r) => r.name === "keepers")?.kind?.Group ?? [];
  // an expired proposal stays "InProgress" until finalized: not open for voting
  const period = Number(policy.proposal_period) / 1e6;
  const live = props.filter((p) => p.status !== "InProgress" || Number((p as Proposal & { submission_time: string }).submission_time) / 1e6 + period > Date.now());
  return { t, s, props: live, keepers };
}

// Quiet lives: on testnet a Totem-day is 2 minutes and the Keepers' bot hatches
// a new egg ~90 s after each death, so an untouched panda would page the group
// every few minutes forever. Life alarms (starving, Rampage, bites, death) go out
// only for a life someone has fed or staked in; hatches and hatch votes after an
// untouched life are announced at most once an hour.
const touchedGens = new Set<number>();
async function touched(t: Totem & { living_staked?: string }): Promise<boolean> {
  if (touchedGens.has(t.generation)) return true;
  let yes = BigInt(t.living_staked ?? "0") > 0n;
  if (!yes) {
    try {
      yes = (await history()).events.some((e) => e.kind === "feed" && e.generation === t.generation);
    } catch {
      yes = true; // can't tell: better one alarm too many than a silent death
    }
  }
  if (yes) touchedGens.add(t.generation);
  return yes;
}
let lastQuietStarve = 0;
// an untouched life may still call for a rescue now and then: that's the invitation
const quietStarveOk = () => {
  if (Date.now() - lastQuietStarve < 3_600_000) return false;
  lastQuietStarve = Date.now();
  return true;
};
let lastQuietHatch = 0;
const quietHatchOk = () => {
  if (Date.now() - lastQuietHatch < 3_600_000) return false;
  lastQuietHatch = Date.now();
  return true;
};

async function tick() {
  const { t, s, props, keepers } = await readWorld();
  const open = new Map(props.filter((p) => p.status === "InProgress").map((p) => [p.id, p]));
  const needed = Math.min(Math.floor(keepers.length / 2) + 1, keepers.length);

  if (prev) {
    const p = prev.t;
    const burnedNow = BigInt(s.total_burned) - BigInt(prev.s.total_burned);
    // was the life we were watching (p) one anybody cared about?
    // life alarms only for the life we watched, and only if someone cared about it
    const sameGen = t.generation === p.generation;
    const cared = await touched(p);
    const broadcast = (html: string, buttons: Button[] = []) => (sameGen && cared ? broadcastAll(html, buttons) : undefined);
    if (t.generation > p.generation && (cared || quietHatchOk())) {
      broadcastAll(`🥚 <b>${esc(t.lineage_name)} hatched!</b> The Keepers voted it into the world. It's hungry already: be its first feeder.`, [links.farm]);
    } else if (p.alive && !t.alive) {
      const life = (await view<Life[]>("get_lineage", { limit: 100 })).find((l) => l.generation === t.generation);
      broadcast(
        `🪦 <b>${esc(t.lineage_name)} starved.</b> It reached Level ${t.max_level}${life?.lifespan_sec ? ` and lived ${secs(life.lifespan_sec)}` : ""}. Its treasury burned with it; the stakes are released. A gravestone NFT keeps its story forever.` +
          (life?.top_feeders[0] ? `\nTop feeder of this life: ${esc(who(life.top_feeders[0][0]))}. The top 3 shape the next egg.` : "") +
          `\n\nOnly the Keepers can hatch the next one.`,
        [links.tribe]
      );
    } else if (t.alive) {
      if (t.level < p.level)
        broadcast(
          `⚔️ <b>BITE!</b> ${esc(t.lineage_name)} burned ${tokens(burnedNow > 0n ? burnedNow : 0n)} $TOTEM of its treasury and slashed every unshielded stake. Down to Level ${t.level}: <b>${t.bites_until_death} bite${t.bites_until_death === 1 ? "" : "s"} from death</b>. Next bite in ${secs(t.seconds_until_next_bite)}.`,
          [links.rescue]
        );
      else if (t.mood === "rampage" && p.mood !== "rampage")
        broadcast(
          `🔥 <b>RAMPAGE!</b> ${esc(t.lineage_name)}'s belly is empty. In ${secs(t.seconds_until_next_bite)} it bites: ${BigInt(t.reserve) > 0n ? `−15% of its ${tokens(t.reserve)} $TOTEM treasury, ` : ""}−15% of every unshielded stake, −1 level. ${t.bites_until_death} bite${t.bites_until_death === 1 ? "" : "s"} and it's gone.`,
          [links.rescue]
        );
      else if (t.mood === "starving" && p.mood !== "starving" && p.mood !== "rampage" && (cared || quietStarveOk()))
        broadcastAll(`⚠️ <b>${esc(t.lineage_name)} is starving</b> (${Math.round(t.fullness_bp / 100)}%). Rampage in ${secs(t.seconds_until_rampage)}, then it starts eating its own treasury. ${tokens(t.fill_amount)} $TOTEM fills it.`, [links.rescue]);
      if (p.mood === "rampage" && t.mood !== "rampage") {
        let hero = "";
        try {
          const ev = (await history()).events.find((e) => e.kind === "rampage_end");
          if (ev && Date.now() - ev.ts < 10 * 60_000) hero = who(String(ev.data.by));
        } catch {
          /* name stays unknown */
        }
        broadcast(`🦸 <b>Rescued!</b> ${hero ? `<b>${esc(hero)}</b> fed` : "Someone fed"} ${esc(t.lineage_name)} and ended the Rampage${hero ? ", and earned the Hero badge" : ""}. Belly at ${Math.round(t.fullness_bp / 100)}%.`);
      }
      if (t.level > p.level) broadcast(`⬆️ ${esc(t.lineage_name)} reached <b>Level ${t.level}</b>. Bigger meals, bigger treasury${t.level >= 3 ? ", and Blessings now pay its feeders" : ""}.`);
      if (t.form !== p.form) broadcast(`🐉 ${esc(t.lineage_name)} evolved into a <b>${esc(t.form)}</b>!`);
    }
    // DAO votes
    const quietVote = (pr: Proposal) => kindOf(pr) === "hatch" && !cared && !t.alive;
    for (const [id, pr] of open)
      if (!prev.open.has(id) && !quietVote(pr))
        broadcastAll(`🗳 <b>Vote open #${id}:</b> ${proposalTitle(pr, t)}. ${keepers.length} Keepers, ${needed} yes votes needed. Proposed by ${esc(who(pr.proposer))}.`, [links.tribe]);
    for (const [id, pr] of prev.open) {
      if (open.has(id)) continue;
      const now = props.find((x) => x.id === id);
      if (kindOf(pr) === "hatch" && !cared) continue; // an untouched life's auto-hatch
      if (now?.status === "Approved") broadcastAll(`✅ <b>Vote #${id} passed:</b> ${proposalTitle(pr, t)}.`);
      else if (now) broadcastAll(`❌ Vote #${id} ended: ${now.status.toLowerCase()}.`);
    }
  }
  prev = { t, s, open };

  await personalAlerts(t, open, keepers);
  await cheer(t).catch((e) => console.error("cheer:", e instanceof Error ? e.message : e));
  await quietCrowd(t).catch((e) => console.error("crowd:", e instanceof Error ? e.message : e));
  await missYou(t).catch((e) => console.error("miss-you:", e instanceof Error ? e.message : e));
  save();
}

// ------------------------------------------------------------------ cheering the tribe on
//
// Celebrate the feeders instead of shaming the holders. Specials (a first feed
// ever, a comeback, a rescue from starving) get their own message, at most one a
// minute; every other feed goes into a thank-you digest, at most every 30 min.

interface Caretaker {
  lifetime_points: string;
  last_fed_ns?: string | null;
}
const caretaker = (a: string) => view<Caretaker>("get_caretaker", { account_id: a });
let lastSpecial = 0;
let lastDigest = Date.now();
const digest = new Map<string, bigint>(); // account -> tokens fed since the last digest

async function cheer(t: Totem) {
  const since = state.cheeredUpTo ?? Date.now(); // never replay old feeds on first run
  const feeds = (await history()).events.filter((e) => e.kind === "feed" && e.ts > since).sort((a, b) => a.ts - b.ts);
  if (feeds.length) state.cheeredUpTo = feeds[feeds.length - 1].ts;
  else state.cheeredUpTo ??= since;

  const ended = (await history()).events.filter((e) => e.kind === "rampage_end");
  for (const e of feeds) {
    const a = String(e.data.account);
    // a feed that ended a Rampage already got its own "Rescued!" message
    if (ended.some((r) => r.tx === e.tx)) continue;
    const amount = BigInt(String(e.data.amount ?? "0"));
    const pts = BigInt(String(e.data.points ?? "0"));
    let special = "";
    if (e.data.welcome_back) special = `🤗 <b>Welcome back, ${esc(who(a))}!</b> You fed me ${tokens(amount)} $TOTEM after a long break: bonus points and a Welcome Back badge for you.`;
    else if (e.data.rescue && t.alive) special = `🦸 <b>${esc(who(a))}</b> fed me ${tokens(amount)} $TOTEM when my belly was almost empty. Thank you, I was so hungry!`;
    else {
      // first feed ever: all their lifetime points came from this one
      const c = await caretaker(a).catch(() => null);
      if (c && BigInt(c.lifetime_points) === pts && pts > 0n) special = `🎉 <b>${esc(who(a))}</b> just fed me for the first time ever (${tokens(amount)} $TOTEM). Welcome to the tribe!`;
    }
    if (special && Date.now() - lastSpecial > 60_000) {
      lastSpecial = Date.now();
      broadcast(special);
    } else digest.set(a, (digest.get(a) ?? 0n) + amount);
  }

  if (digest.size && Date.now() - lastDigest > 30 * 60_000) {
    lastDigest = Date.now();
    const top = [...digest.entries()].sort((x, y) => (y[1] > x[1] ? 1 : -1));
    const names = top.slice(0, 3).map(([a]) => `<b>${esc(who(a))}</b>`);
    const more = top.length - names.length;
    const total = top.reduce((s, [, v]) => s + v, 0n);
    broadcast(`🙏 Thank you ${names.join(", ")}${more > 0 ? ` and ${more} other${more === 1 ? "" : "s"}` : ""}: ${tokens(total)} $TOTEM in my belly since my last thank-you. You keep me alive.`);
    digest.clear();
  }
}

// The quiet holders: accounts that got $TOTEM and never fed. Addressed as a
// crowd, never by name, at most every 6 hours, and only while BaoBao is hungry.
async function quietCrowd(t: Totem) {
  if (!t.alive || !["hungry", "starving", "rampage"].includes(t.mood)) return;
  const slot = `crowd-${Math.floor(Date.now() / (6 * 3_600_000))}`;
  if (state.sent[slot]) return;
  const candidates = new Set<string>();
  for (const e of (await history()).events) {
    if (e.kind === "ft_mint") candidates.add(String(e.data.owner_id));
    if (e.kind === "ft_transfer") candidates.add(String(e.data.new_owner_id));
  }
  try {
    const r = await fetch(`https://api-testnet.nearblocks.io/v3/fts/${CONTRACT_ID}/holders?per_page=50`);
    for (const h of ((await r.json()) as { data?: { account: string }[] }).data ?? []) candidates.add(h.account);
  } catch {}
  let quiet = 0;
  for (const a of [...candidates].slice(0, 120)) {
    if (a === CONTRACT_ID || a.endsWith(`.${CONTRACT_ID}`)) continue; // the game's own accounts
    const [bal, c] = await Promise.all([view<string>("ft_balance_of", { account_id: a }).catch(() => "0"), caretaker(a).catch(() => null)]);
    if (BigInt(bal) > 0n && c && BigInt(c.lifetime_points) === 0n) quiet++;
  }
  state.sent[slot] = Date.now();
  if (!quiet) return;
  broadcast(
    `🥺 ${quiet} wallet${quiet === 1 ? " holds" : "s hold"} $TOTEM but ${quiet === 1 ? "has" : "have"} never fed me… Even one bamboo would make my day. Every feed earns points, and the first one makes you part of the tribe.`,
    [links.farm]
  );
}

// "I miss you": only for accounts linked from the app (they asked for it).
// Idle = no feed for 3 Totem-days (at least an hour); at most every 12 hours.
let dayMs = 0;
async function missYou(t: Totem) {
  if (!t.alive) return;
  const linked = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.chats)) for (const a of c.linked ?? []) linked.set(a, [...(linked.get(a) ?? []), id]);
  if (!linked.size) return;
  if (!dayMs) dayMs = Number((await view<{ day_length_ns: string | number }>("get_config")).day_length_ns) / 1e6;
  const idleMs = Math.max(3 * dayMs, 3_600_000);
  const feeds = (await history()).events.filter((e) => e.kind === "feed");
  for (const [a, chats] of linked) {
    const key = `miss-${a}-${Math.floor(Date.now() / (12 * 3_600_000))}`;
    if (state.sent[key]) continue;
    const c = await caretaker(a).catch(() => null);
    // the contract knows (last_fed_ns); before that, the event log does
    const last = c?.last_fed_ns ? Number(BigInt(c.last_fed_ns) / 1_000_000n) : feeds.find((e) => e.data.account === a)?.ts ?? 0;
    const never = !c || BigInt(c.lifetime_points) === 0n;
    if (!never && (!last || Date.now() - last < idleMs)) continue; // fed recently, or the log is too short to tell
    state.sent[key] = Date.now();
    const text = never
      ? `🐼 Hi <b>${esc(who(a))}</b>, you haven't fed me yet. Even 1 $TOTEM counts, and your first feed makes you part of the tribe.`
      : `🥺 <b>${esc(who(a))}</b>, it's been ${secs(Math.floor((Date.now() - last) / 1000))} since you last fed me. I miss you! Come back: a feed after a long break earns bonus points and a Welcome Back badge.`;
    for (const id of chats) send(id, text, [t.mood === "rampage" || t.mood === "starving" ? links.rescue : links.farm]);
  }
}

/** Alerts for watched accounts. Each fires once (dedupe key in state.sent). */
async function personalAlerts(t: Totem, open: Map<number, Proposal>, keepers: string[]) {
  const watchers = new Map<string, string[]>();
  for (const [id, c] of Object.entries(state.chats)) for (const a of c.watch) watchers.set(a, [...(watchers.get(a) ?? []), id]);
  for (const [a, chats] of watchers) {
    const once = (key: string, html: string, buttons: Button[] = []) => {
      const k = `${a}|${key}`;
      if (state.sent[k]) return;
      state.sent[k] = Date.now();
      for (const id of chats) send(id, html, buttons);
    };
    const [st, claims] = await Promise.all([
      view<StakeView | null>("get_stake", { account_id: a }).catch(() => null),
      view<{ period_id: number; amount: string; periods_left: number | null }[]>("get_claimable", { account_id: a }).catch(() => []),
    ]);
    if (st && !st.released && t.alive && BigInt(st.staked) > 0n) {
      const left = Number(st.seconds_shield_left ?? 0);
      if (st.shielded && left > 0 && left < 60)
        once(`shield-${t.generation}-${Math.floor(Date.now() / 120_000)}`, `🛡 <b>${esc(who(a))}</b>: your shield ends in ${secs(left)}. Feed 5 to keep your ${tokens(st.staked)} $TOTEM stake safe from bites.`, [links.farm]);
      if (!st.shielded && (t.mood === "rampage" || t.mood === "starving"))
        once(
          `exposed-${t.generation}-${t.level}`,
          `⚠️ <b>${esc(who(a))}</b>: your ${tokens(st.staked)} $TOTEM stake is <b>not shielded</b> and ${esc(t.lineage_name)} ${t.mood === "rampage" ? `bites in ${secs(t.seconds_until_next_bite)}` : "is starving"}. A bite takes 15% of it. Feed 5 to shield it (and save the Totem).`,
          [links.rescue]
        );
    }
    if (st?.released && BigInt(st.staked) + BigInt(st.unbonding) > 0n)
      once(`released-${st.generation}`, `↩️ <b>${esc(who(a))}</b>: ${tokens(BigInt(st.staked) + BigInt(st.unbonding))} $TOTEM of your stake was released when the Totem died. Withdraw it, or re-stake into the next egg.`, [links.farm]);
    for (const c of claims) {
      once(`bless-${c.period_id}`, `🎁 <b>${esc(who(a))}</b>: a Blessing of ${tokens(c.amount)} $TOTEM is waiting for you (period #${c.period_id}).`, [links.farm]);
      if (c.periods_left === 1) once(`bless-last-${c.period_id}`, `⏳ <b>${esc(who(a))}</b>: last period to claim your ${tokens(c.amount)} $TOTEM Blessing #${c.period_id}. After that it returns to the treasury.`, [links.farm]);
    }
    if (keepers.includes(a))
      for (const [id, p] of open)
        if (!p.votes[a]) once(`vote-${id}`, `🏛 <b>${esc(who(a))}</b>, you're a Keeper and vote #${id} needs you: ${proposalTitle(p, t)}.`, [links.tribe]);
  }
}

// ------------------------------------------------------------------ run

async function pollTelegram() {
  for (;;) {
    try {
      const updates = await tg<any[]>("getUpdates", { offset: state.offset, timeout: 30, allowed_updates: ["message", "my_chat_member"] });
      for (const u of updates) {
        state.offset = u.update_id + 1;
        const m = u.message;
        if (m?.text?.startsWith("/")) await command(String(m.chat.id), m.text, m.chat.title ?? m.chat.username);
        // added to a group: introduce ourselves and subscribe
        const mc = u.my_chat_member;
        if (mc && ["member", "administrator"].includes(mc.new_chat_member?.status) && mc.old_chat_member?.status === "left")
          await command(String(mc.chat.id), "/start", mc.chat.title);
      }
      save();
    } catch (e) {
      console.error("telegram:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function main() {
  console.log(`TOTEM bot · ${CONTRACT_ID} · DAO ${DAO_ID} · app ${APP_URL} · ${DRY ? "DRY RUN (no Telegram)" : "live"}`);
  if (!DRY) {
    const me = await tg<{ username: string }>("getMe", {});
    console.log(`signed in as @${me.username}; add it to the tribe's group, or DM it /start`);
    try {
      await tg("setMyCommands", {
        commands: [
          { command: "status", description: "The Totem right now" },
          { command: "watch", description: "Personal alerts for an account" },
          { command: "me", description: "Your watched accounts" },
          { command: "lives", description: "The lineage" },
          { command: "ask", description: "Talk to the Totem" },
          { command: "rescue", description: "One-tap rescue link" },
          { command: "alerts", description: "on / off" },
        ],
      });
    } catch (e) {
      console.error("setMyCommands:", e instanceof Error ? e.message : e);
    }
    pollTelegram();
  } else {
    // the console is one chat: type commands on stdin
    chat("console");
    createInterface({ input: process.stdin }).on("line", (l) => l.trim() && command("console", l.trim()));
    console.log("type /status, /watch account.testnet, /lives, /ask hi …");
  }
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("watch:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

process.on("unhandledRejection", (e) => console.error("unhandled:", e instanceof Error ? e.message : e));
main().catch((e) => {
  console.error("bot stopped:", e);
  process.exit(1);
});
