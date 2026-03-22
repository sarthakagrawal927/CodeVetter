import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@code-reviewer/review-core": path.resolve(__dirname, "../../packages/review-core/src/index.ts"),
      "@code-reviewer/ai-gateway-client": path.resolve(__dirname, "../../packages/ai-gateway-client/src/index.ts"),
      "@code-reviewer/shared-types": path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
    },
  },
  server: {
    port: 1420,
    strictPort: false,
  },
  build: {
    outDir: "out",
    emptyOutDir: true,
  },
});
