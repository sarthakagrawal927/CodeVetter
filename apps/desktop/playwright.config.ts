import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev",
    port: 1420,
    reuseExistingServer: true,
    timeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
