/**
 * Development runner: rebuilds on change and restarts the server.
 * Production uses `npm run build && npm start`.
 */

import { context } from "esbuild";
import { spawn } from "node:child_process";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/client", { recursive: true });

const common = {
  bundle: true,
  sourcemap: "inline",
  minify: false,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"development"' },
};

const clientCtx = await context({
  ...common,
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/client/main.js",
  format: "esm",
  target: ["es2022"],
  platform: "browser",
});
const serverCtx = await context({
  ...common,
  entryPoints: ["src/server/Server.ts"],
  outfile: "dist/server/Server.mjs",
  format: "esm",
  platform: "node",
  target: ["node20"],
  external: ["ws", "bufferutil", "utf-8-validate"],
});

await clientCtx.watch();
await serverCtx.watch();
await cp("src/client/index.html", "dist/client/index.html");
await cp("src/client/styles.css", "dist/client/styles.css");

const server = spawn(process.execPath, ["--watch", "dist/server/Server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development" },
});

process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});
