import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
    // Smoke tests share one app instance; serialize so DB state stays sane.
    fileParallelism: false,
  },
});
