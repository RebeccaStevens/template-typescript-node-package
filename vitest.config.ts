import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },

  test: {
    include: ["./**/*.test.ts"],
    exclude: ["dist", "node_modules"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["dist"],
      reporter: ["lcov", "text"],
      watermarks: {
        lines: [80, 95],
        functions: [80, 95],
        branches: [80, 95],
        statements: [80, 95],
      },
    },
  },
});
