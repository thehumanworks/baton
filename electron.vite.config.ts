import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const r = (path: string): string => resolve(root, path);

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rollupOptions: {
        external: ["electron", "node-pty"],
      },
    },
  },
  preload: {},
  renderer: {
    root: r("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@renderer": r("src/renderer/src"),
        "@shared": r("src/shared"),
      },
    },
  },
});
