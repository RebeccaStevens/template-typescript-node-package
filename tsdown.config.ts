import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  format: ["esm", "cjs"],
  dts: {
    // @ts-expect-error cjsReexport is in source but not in bundled types
    cjsReexport: true, // single build generates .d.ts + .d.cts
  },
  platform: "node", // tsdown default — targets Node.js runtime
  outDir: "dist", // default dist; explicit for clarity
  sourcemap: false, // tsdown default; matches previous rollup config
  clean: true, // tsdown default cleans dist/ before build
  tsconfig: "src/tsconfig.build.json", // explicitly point to build config
  fixedExtension: false, // override platform:'node' default; produce .js (ESM, type:module) + .cjs (CJS) + .d.ts + .d.cts
});
