// Mounts the small server-side endpoints on the Vite dev / preview server:
//   /rpc        NEAR RPC proxy (same-origin, rotates upstreams past rate limits)
//   /api/mochi  Mochi's AI voice (NEAR AI Cloud; the key never reaches the browser)
//   /api/guest  zero-balance guest accounts (no wallet, no NEAR needed)
//   /api/relay  NEP-366 meta-transaction relayer: the game pays the gas
//   /api/propose  open a hatch vote / Keeper nomination for players without NEAR
//   /api/history  the contract's event log (every feed, burn, bite, life), from chain
import type { Plugin } from "vite";
import { rpcHandler } from "./rpc";
import { mochiHandler } from "./mochi";
import { guestHandler, proposeHandler, relayHandler } from "./relay";
import { historyHandler } from "./history";

export function totemServer(): Plugin {
  return {
    name: "totem-server",
    configureServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/api/propose", proposeHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
      s.middlewares.use("/api/history", historyHandler);
    },
    configurePreviewServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/api/propose", proposeHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
      s.middlewares.use("/api/history", historyHandler);
    },
  };
}
