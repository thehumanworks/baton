#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const withDevTools = args.includes("--with-dev-tools");
const forwarded = args.filter((arg) => arg !== "--with-dev-tools");

const env = { ...process.env };
if (withDevTools) env.BATON_DEVTOOLS = "1";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const cli = path.join(projectRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");

const child = spawn(process.execPath, [cli, "dev", ...forwarded], {
  env,
  stdio: "inherit",
  cwd: projectRoot,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
