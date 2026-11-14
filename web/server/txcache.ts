// Shared ring buffer of transactions the server has submitted itself.
// relay.ts, autohatch.ts push hashes in; history.ts reads them to
// fetch on-chain events without depending on an external indexer.
const MAX = 400;

export interface TxRecord {
  hash: string;
  sender: string; // predecessor / signer — used as routing hint for the RPC tx call
  method: string; // human label (bite, hatch, feed, …)
  ts: number;     // Date.now() at submission (ms)
}

const cache: TxRecord[] = [];
const seen = new Set<string>();

export function recordTx(hash: string, sender: string, method: string) {
  if (seen.has(hash)) return;
  seen.add(hash);
  cache.push({ hash, sender, method, ts: Date.now() });
  if (cache.length > MAX) { seen.delete(cache.shift()!.hash); }
}

export function getTxCache(): ReadonlyArray<TxRecord> {
  return cache;
}
