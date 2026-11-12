// Mounts the small server-side endpoints on the Vite dev / preview server:
//   /rpc        NEAR RPC proxy (same-origin, rotates upstreams past rate limits)
//   /api/voice  the Totem's AI voice (NEAR AI Cloud; the key never reaches the browser)
//   /api/guest  zero-balance guest accounts (no wallet, no NEAR needed)
//   /api/relay  NEP-366 meta-transaction relayer: the game pays the gas
//   /api/propose  open a hatch vote / Keeper nomination for players without NEAR
//   /api/history  the contract's event log (every feed, burn, bite, life), from chain
import type { Plugin } from "vite";
import { rpcHandler } from "./rpc";
import { voiceHandler } from "./voice";
import { guestHandler, proposeHandler, relayHandler } from "./relay";
import { historyHandler } from "./history";
import { autoHatchHandler } from "./autohatch";

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
    },
    configurePreviewServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/api/propose", proposeHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/voice", voiceHandler);
      s.middlewares.use("/api/history", historyHandler);
      s.middlewares.use("/api/autohatch", autoHatchHandler);
    },
  };
}
