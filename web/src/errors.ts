// Wallet / RPC / contract errors, in words a player can act on.

/** The contract's own refusal inside a wallet / RPC error ("Smart contract panicked: ..."). */
export function contractRefusal(msg: string): string | null {
  // Format A (near-sdk require!/assert!): "Smart contract panicked: <message>"
  // Format B (Rust panic, new Rust):      "Smart contract panicked: panicked at path:line:col:\n<message>"
  // Format C (Rust panic, old Rust):      "Smart contract panicked: panicked at '<message>', path:line:col"
  const m = msg.match(
    /Smart contract panicked: (?:panicked at [^\s:]+:\d+:\d+:[\s\S]*?\n)?([^\n"\\]+)/
  );
  if (m) {
    const text = m[1].trim();
    if (!/^panicked at /.test(text)) return text; // skip if we only captured a bare file location
  }
  return null;
}

const NOTHING_TAKEN = "Nothing left your wallet: a refused transaction is rolled back, only the gas is spent.";

const FAUCET_USED = "You already got your free $TOTEM today! Come back in a bit -- the faucet refills once per Totem-day (about 2 min in demo mode).";

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
    if (/once per Totem-day|faucet.*claimed/i.test(refusal)) return FAUCET_USED;
    if (/register storage first/i.test(refusal))
      return `You don't have any $TOTEM in this game yet: tap the faucet first (free). ${NOTHING_TAKEN}`;
    if (/doesn't have enough balance|not enough balance/i.test(refusal))
      return `Not enough $TOTEM for that: tap the faucet (free), or pick a smaller amount. ${NOTHING_TAKEN}`;
    if (/expired/i.test(refusal)) return `That Blessing expired: unclaimed shares went back to the Treasury. ${NOTHING_TAKEN}`;
    return `The contract refused: ${refusal}. ${NOTHING_TAKEN}`;
  }
  if (/NotEnoughBalance|LackBalanceForState|balance/i.test(msg) && !/TOTEM/.test(msg))
    return "Your account has no testnet NEAR for gas. Sign out and tap Play free, no wallet (the game pays the gas), or get NEAR at near-faucet.io.";
  if (/AccessKeyDoesNotExist|does not exist/i.test(msg)) return "Wallet key not found on-chain. Sign out and connect again.";
  if (/reject|cancel|denied|closed/i.test(msg)) return "Cancelled in the wallet.";
  if (/ERR_PERMISSION_DENIED/.test(msg)) return "Only Keepers can vote on that. Stake 1,000 $TOTEM (or earn Silver) and get nominated in the Tribe panel.";
  if (/ERR_ALREADY_VOTED/.test(msg)) return "You already voted on this proposal.";
  // Fallback: catch faucet "already used" even when the message text was not extracted cleanly
  if (/once per Totem-day|faucet.*claimed/i.test(msg)) return FAUCET_USED;
  if (/panicked at src\/game\.rs:129/.test(msg)) return FAUCET_USED;
  return msg.length > 140 ? msg.slice(0, 140) + "..." : msg;
}
