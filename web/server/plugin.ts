// Mounts the small server-side endpoints on the Vite dev / preview server:
//   /rpc        NEAR RPC proxy (same-origin, rotates upstreams past rate limits)
//   /api/mochi  Mochi's AI voice (NEAR AI Cloud; the key never reaches the browser)
import type { Plugin } from "vite";
import { rpcHandler } from "./rpc";
import { mochiHandler } from "./mochi";

export function totemServer(): Plugin {
  return {
    name: "totem-server",
    configureServer(s) {
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
    },
    configurePreviewServer(s) {
      s.middlewares.use("/rpc", rpcHandler);
      s.middlewares.use("/api/mochi", mochiHandler);
    },
  };
}
