import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/engine/test/**/*.test.ts", "src/client/test/**/*.test.ts"],
    environment: "node",
  },
});
