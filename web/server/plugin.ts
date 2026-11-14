// Mounts the small server-side endpoints on the Vite dev / preview server:
//   /rpc        NEAR RPC proxy (same-origin, rotates upstreams past rate limits)
//   /api/voice  the Totem's AI voice (NEAR AI Cloud; the key never reaches the browser)
//   /api/guest  zero-balance guest accounts (no wallet, no NEAR needed)
//   /api/relay  NEP-366 meta-transaction relayer: the game pays the gas
//   /api/propose  open a hatch vote / Keeper nomination for players without NEAR
//   /api/history  the contract's event log (every feed, burn, bite, life), from chain
//   /api/den    the badge holders' Den · /api/link  the Telegram alerts button
//   /api/leaderboard  wallets ranked by badge count
import type { Plugin } from "vite";
import { rpcHandler } from "./rpc";
import { voiceHandler } from "./voice";
import { guestHandler, proposeHandler, relayHandler } from "./relay";
import { historyHandler } from "./history";
import { autoHatchHandler } from "./autohatch";
import { denHandler } from "./den";
import { linkHandler } from "./link";
import { waitlistHandler } from "./waitlist";
import { leaderboardHandler } from "./leaderboard";

export function totemServer(): Plugin {
  return {
    name: "totem-server",
    configureServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/api/propose", proposeHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/voice", voiceHandler);
      s.middlewares.use("/api/history", historyHandler);
      s.middlewares.use("/api/autohatch", autoHatchHandler);
      s.middlewares.use("/api/den", denHandler);
      s.middlewares.use("/api/link", linkHandler);
      s.middlewares.use("/api/waitlist", waitlistHandler);
      s.middlewares.use("/api/leaderboard", leaderboardHandler);
    },
    configurePreviewServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/api/propose", proposeHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/voice", voiceHandler);
      s.middlewares.use("/api/history", historyHandler);
      s.middlewares.use("/api/autohatch", autoHatchHandler);
      s.middlewares.use("/api/den", denHandler);
      s.middlewares.use("/api/link", linkHandler);
      s.middlewares.use("/api/waitlist", waitlistHandler);
      s.middlewares.use("/api/leaderboard", leaderboardHandler);
    },
  };
}
