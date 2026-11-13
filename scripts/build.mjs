/**
 * Build script: bundles the browser client and the Node server with esbuild.
 * No bundler configuration file to maintain, no dev-server to keep alive.
 */

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev") || watch;

await rm("dist", { recursive: true, force: true });
await mkdir("dist/client", { recursive: true });

const shared = {
  bundle: true,
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production"),
  },
};

await build({
  ...shared,
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/client/main.js",
  format: "esm",
  target: ["es2022"],
  platform: "browser",
});

await build({
  ...shared,
  entryPoints: ["src/server/Server.ts"],
  outfile: "dist/server/Server.mjs",
  format: "esm",
  platform: "node",
  target: ["node20"],
  external: ["ws", "bufferutil", "utf-8-validate"],
  sourcemap: false,
  minify: false,
});

await cp("src/client/index.html", "dist/client/index.html");
await cp("src/client/styles.css", "dist/client/styles.css");
if (existsSync("src/client/public")) {
  await cp("src/client/public", "dist/client", { recursive: true });
}

console.log("build complete -> dist/");
