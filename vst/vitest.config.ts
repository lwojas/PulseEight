import { defineConfig } from "vitest/config";

// The headless end-to-end test (needs the harness: `npm run vst:e2e` builds it). Real time, so generous timeouts, and one file at a
// time because the rig installs the page shim on `globalThis`.
export default defineConfig({
  test: { include: ["vst/test/**/*.e2e.ts"], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
});
