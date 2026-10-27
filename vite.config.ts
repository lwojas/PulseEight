import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, fs: { allow: [".."] } },
  // webdsp resolves its AudioWorklet module with `new URL('./engine-processor.js', import.meta.url)`;
  // Vite's dev pre-bundling would move the module and break that lookup (see webdsp ARCHITECTURE.md).
  optimizeDeps: { exclude: ["webdsp", "webdsp/worklet-url", "webdsp/sequencing"] },
  test: { include: ["test/**/*.test.ts"] },
});
