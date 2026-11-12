// Wallet / RPC / contract errors, in words a player can act on.

/** The contract's own refusal inside a wallet / RPC error ("Smart contract panicked: …"). */
export function contractRefusal(msg: string): string | null {
  const m = msg.match(/Smart contract panicked: (?:panicked at [^\s:]+:\d+:\d+:(?:\\n|\n|\s))?([^"\\]+)/);
  return m ? m[1].trim() : null;
}

const NOTHING_TAKEN = "Nothing left your wallet: a refused transaction is rolled back, only the gas is spent.";

/** Turn raw wallet / RPC errors into something a player can act on. */
export function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const refusal = contractRefusal(msg);
  if (refusal) {
    if (/totem is dead/i.test(refusal) && !/withdraw|stakes are released/i.test(refusal))
      return `Too late: it died before your transaction landed, so the feed was refused. ${NOTHING_TAKEN} The Keepers will vote a new egg in a moment.`;
    if (/totem is dead/i.test(refusal)) return `The Totem died, so stakes are released: use Withdraw to take yours. ${NOTHING_TAKEN}`;
    if (/is full/i.test(refusal)) return `Someone filled it first, it's full now. ${NOTHING_TAKEN}`;
    if (/still unbonding/i.test(refusal)) return `Still unbonding: wait for the countdown, then Withdraw. ${NOTHING_TAKEN}`;
    if (/once per Totem-day/i.test(refusal)) return "Free $TOTEM refills once per Totem-day (2 minutes here). Try again in a moment.";
    if (/expired/i.test(refusal)) return `That Blessing expired: unclaimed shares went back to the Hoard. ${NOTHING_TAKEN}`;
    return `The contract refused: ${refusal}. ${NOTHING_TAKEN}`;
  }
  if (/NotEnoughBalance|LackBalanceForState|balance/i.test(msg) && !/TOTEM/.test(msg))
    return "Your account has no testnet NEAR for gas. Sign out and tap “⚡ Play free, no wallet” (the game pays the gas), or get NEAR at near-faucet.io.";
  if (/AccessKeyDoesNotExist|does not exist/i.test(msg)) return "Wallet key not found on-chain. Sign out and connect again.";
  if (/reject|cancel|denied|closed/i.test(msg)) return "Cancelled in the wallet.";
  if (/ERR_PERMISSION_DENIED/.test(msg)) return "Only Keepers can vote on that. Stake 1,000 $TOTEM (or earn Silver) and get nominated in 🏛 Tribe.";
  if (/ERR_ALREADY_VOTED/.test(msg)) return "You already voted on this proposal.";
  if (/once per Totem-day/.test(msg)) return "Free $TOTEM refills once per Totem-day (2 minutes here). Try again in a moment.";
  return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
}
