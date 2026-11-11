import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rpcProxy } from "./rpc-proxy";

export default defineConfig({
  plugins: [react(), rpcProxy()],
  base: "./",
});
