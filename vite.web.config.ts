import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const r = (path: string): string => resolve(root, path);

export default defineConfig({
  root: r("src/renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@renderer": r("src/renderer/src"),
      "@shared": r("src/shared"),
    },
  },
  build: {
    outDir: r("dist-web"),
    emptyOutDir: true,
  },
});
