import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
  resolve: { alias: { obsidian: resolve(__dirname, "test/__mocks__/obsidian.ts") } },
});
