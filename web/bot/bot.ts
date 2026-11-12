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
// Talks to the Bot API directly (long polling, no webhook), so it runs on any
// machine with outbound HTTPS. Reads the chain through the same RPC rotation as
// the web server; /ask uses the Totem's voice (NEAR AI Cloud, needs NEAR_AI_API_KEY).
import "./env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { rpcForward } from "../server/rpc";
import { history } from "../server/history";
import { voiceReply } from "../server/voice";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DRY = process.argv.includes("--dry-run") || !TOKEN;
const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
const DAO_ID = process.env.VITE_DAO_ID ?? "totem-tribe.sputnik-v2.testnet";
const APP_URL = (process.env.APP_URL ?? "http://127.0.0.1:5174").replace(/\/$/, "");
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
  if (!j.result?.result) throw new Error(j.error?.cause?.name ?? j.result?.error ?? "view failed");
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
  lines.push(`💰 Hoard ${tokens(t.hoard)} · 🔥 burned forever ${tokens(s.total_burned)}`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ state

interface ChatState {
  alerts: boolean;
  watch: string[];
  title?: string;
}
interface State {
  offset: number;
  chats: Record<string, ChatState>;
  /** keys of personal alerts already sent (dedupe across restarts) */
  sent: Record<string, number>;
}
const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { offset: 0, chats: {}, sent: {} };
const save = () => {
  // forget dedupe keys older than a day
  const cut = Date.now() - 86_400_000;
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
const broadcast = (html: string, buttons: Button[] = []) => {
  for (const [id, c] of Object.entries(state.chats)) if (c.alerts) send(id, html, buttons);
};

// ------------------------------------------------------------------ commands

const HELP = `🐼 <b>TOTEM</b>: one panda the whole tribe keeps alive on NEAR.
Feed it $TOTEM: half burns, half goes to its treasury. Starve it and it bites: every bite burns 15% of the treasury and slashes unshielded stakes. At Level 0 it dies, and the Keepers vote to hatch the next egg.

This chat now gets the alarms: starving, Rampage, every bite, rescues, death, hatch votes.

/status the Totem right now
/watch <i>account.testnet</i> personal alerts for an account (shield, Blessings, Keeper votes)
/unwatch <i>account</i> · /me your watched accounts
/lives the lineage · /ask <i>question</i> talk to the Totem
/alerts on|off · /rescue the one-tap rescue link`;

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

async function tick() {
  const { t, s, props, keepers } = await readWorld();
  const open = new Map(props.filter((p) => p.status === "InProgress").map((p) => [p.id, p]));
  const needed = Math.min(Math.floor(keepers.length / 2) + 1, keepers.length);

  if (prev) {
    const p = prev.t;
    const burnedNow = BigInt(s.total_burned) - BigInt(prev.s.total_burned);
    if (t.generation > p.generation) {
      broadcast(`🥚 <b>${esc(t.lineage_name)} hatched!</b> The Keepers voted it into the world. It's hungry already: be its first feeder.`, [links.farm]);
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
      else if (t.mood === "starving" && p.mood !== "starving" && p.mood !== "rampage")
        broadcast(`⚠️ <b>${esc(t.lineage_name)} is starving</b> (${Math.round(t.fullness_bp / 100)}%). Rampage in ${secs(t.seconds_until_rampage)}, then it starts eating its own treasury. ${tokens(t.fill_amount)} $TOTEM fills it.`, [links.rescue]);
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
    for (const [id, pr] of open)
      if (!prev.open.has(id))
        broadcast(`🗳 <b>Vote open #${id}:</b> ${proposalTitle(pr, t)}. ${keepers.length} Keepers, ${needed} yes votes needed. Proposed by ${esc(who(pr.proposer))}.`, [links.tribe]);
    for (const [id, pr] of prev.open) {
      if (open.has(id)) continue;
      const now = props.find((x) => x.id === id);
      if (now?.status === "Approved") broadcast(`✅ <b>Vote #${id} passed:</b> ${proposalTitle(pr, t)}.`);
      else if (now) broadcast(`❌ Vote #${id} ended: ${now.status.toLowerCase()}.`);
    }
  }
  prev = { t, s, open };

  await personalAlerts(t, open, keepers);
  save();
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
