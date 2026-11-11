import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { totemServer } from "./server/plugin";

export default defineConfig(({ mode }) => {
  // Server-only secrets (NEAR_AI_API_KEY, …) from web/.env, for /api/mochi.
  // Only VITE_* variables are ever exposed to the browser bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""), process.env);
  return {
    plugins: [react(), totemServer()],
    base: "./",
  };
});
