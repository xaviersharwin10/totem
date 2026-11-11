// Where the live game lives. Override with VITE_CONTRACT_ID / VITE_DAO_ID in web/.env.
export const NETWORK = "testnet" as const;
export const CONTRACT_ID: string = import.meta.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
export const DAO_ID: string = import.meta.env.VITE_DAO_ID ?? "totem-tribe.sputnik-v2.testnet";
// rpc.testnet.near.org first: FastNEAR free tier returns 429 (seen in the browser as a CORS error) under our polling
export const RPC_URLS = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com"];
export const EXPLORER = "https://testnet.nearblocks.io";
// Zero-deposit methods the in-browser function-call key may sign without a wallet popup.
export const KEY_METHODS = ["feed", "poke", "faucet", "stake", "unstake", "withdraw", "claim_badge", "claim_blessing"];
export const ONE = 10n ** 18n; // $TOTEM has 18 decimals

export const toTokens = (yocto: string | bigint): number => {
  const v = BigInt(yocto);
  return Number(v / 10n ** 12n) / 1e6;
};
export const toYocto = (tokens: number): string => (BigInt(Math.round(tokens * 1e6)) * 10n ** 12n).toString();
