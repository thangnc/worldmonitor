import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["packages/server/__tests__/**/*.test.ts"],
  },
});
