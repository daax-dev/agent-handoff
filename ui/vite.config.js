import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const apiPort = process.env.VITE_API_PORT ?? "4000";
const uiPort = parseInt(process.env.VITE_UI_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: uiPort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      "/events": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
