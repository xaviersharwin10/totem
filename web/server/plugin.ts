// Mounts the small server-side endpoints on the Vite dev / preview server:
//   /rpc        NEAR RPC proxy (same-origin, rotates upstreams past rate limits)
//   /api/mochi  Mochi's AI voice (NEAR AI Cloud; the key never reaches the browser)
//   /api/guest  zero-balance guest accounts (no wallet, no NEAR needed)
//   /api/relay  NEP-366 meta-transaction relayer: the game pays the gas
import type { Plugin } from "vite";
import { rpcHandler } from "./rpc";
import { mochiHandler } from "./mochi";
import { guestHandler, relayHandler } from "./relay";

export function totemServer(): Plugin {
  return {
    name: "totem-server",
    configureServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
    },
    configurePreviewServer(s) {
      s.middlewares.use("/api/guest", guestHandler);
      s.middlewares.use("/api/relay", relayHandler);
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
    },
  };
}
