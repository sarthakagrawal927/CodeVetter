import { test, expect } from "@playwright/test";

// These tests verify the CodeVetter desktop app UI against the Vite dev server.
// Since Tauri APIs aren't available in the browser, pages render their
// error/empty states — which still exercises layouts, components, and navigation.

test.describe("CodeVetter Desktop UI", () => {
  test("Test 1: App loads without crashing", async ({ page }) => {
    await page.goto("/");
    // Wait for the main content area to appear
    await page.waitForSelector("main", { timeout: 10000 });
    await page.screenshot({ path: "tests/screenshots/app-loaded.png" });

    // Verify no error boundary is showing
    const errorBoundary = await page.locator("text=Something went wrong").count();
    expect(errorBoundary).toBe(0);
    const uncaughtError = await page.locator("text=Uncaught").count();
    expect(uncaughtError).toBe(0);
  });

  test("Test 2: All pages render without errors", async ({ page }) => {
    const routes = [
      { path: "/", name: "home" },
      { path: "/workspaces", name: "workspaces" },
      { path: "/board", name: "board" },
      { path: "/history", name: "history" },
      { path: "/settings", name: "settings" },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await page.waitForTimeout(500);

      // Verify no error boundary text
      const errorCount = await page
        .locator("text=Something went wrong")
        .count();
      expect(errorCount).toBe(0);

      await page.screenshot({
        path: `tests/screenshots/page-${route.name}.png`,
      });
    }
  });

  test("Test 3: Floating nav bar", async ({ page }) => {
    await page.goto("/");
    // The nav auto-shows on load, wait a moment for it to be visible
    await page.waitForTimeout(300);

    // The floating nav is a <nav> element (not <aside>)
    const nav = page.locator("nav").first();
    await expect(nav).toBeVisible();

    // Check that 5 nav link icons exist (Home, Workspaces, Board, History, Settings)
    const navLinks = nav.locator("a");
    const linkCount = await navLinks.count();
    expect(linkCount).toBe(5);

    // Click each nav link and verify the URL changes
    const expectedRoutes = ["/", "/workspaces", "/board", "/history", "/settings"];
    for (let i = 0; i < expectedRoutes.length; i++) {
      // Mouse near top to keep nav visible
      await page.mouse.move(640, 10);
      await page.waitForTimeout(100);
      await navLinks.nth(i).click();
      await page.waitForTimeout(200);
      expect(page.url()).toContain(expectedRoutes[i] === "/" ? "localhost:1420" : expectedRoutes[i]);
    }

    await page.screenshot({ path: "tests/screenshots/floating-nav.png" });
  });

  test("Test 4: Board page", async ({ page }) => {
    await page.goto("/board");
    await page.waitForTimeout(800);

    // Verify the Agent Squad section exists
    const agentSquad = page.locator("text=Agent Squad");
    await expect(agentSquad.first()).toBeVisible();

    // Verify the Kanban board has 4 columns (To Do, In Progress, Review, Test)
    await expect(page.locator("text=To Do").first()).toBeVisible();
    await expect(page.locator("text=In Progress").first()).toBeVisible();
    await expect(page.locator("text=Review").first()).toBeVisible();
    await expect(page.locator("text=Test").first()).toBeVisible();

    // Click "+ Task" button, verify the dialog opens
    const addTaskBtn = page.locator('button:has-text("+ Task")');
    await expect(addTaskBtn).toBeVisible();
    await addTaskBtn.click();
    await page.waitForTimeout(300);

    // The dialog should show "New Task" title
    const dialogTitle = page.locator("text=New Task");
    await expect(dialogTitle.first()).toBeVisible();

    await page.screenshot({ path: "tests/screenshots/board-page.png" });
  });

  test("Test 5: History page", async ({ page }) => {
    await page.goto("/history");
    await page.waitForTimeout(800);

    // Verify the page title says "History"
    const heading = page.locator("h1");
    await expect(heading).toContainText("History");

    // Check that the search input exists (SearchBar component)
    const searchInput = page.locator("[data-search-input]");
    await expect(searchInput).toBeVisible();

    // Check filter buttons exist (All, Claude, Codex)
    await expect(page.locator('button:has-text("All")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Claude")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Codex")').first()).toBeVisible();

    await page.screenshot({ path: "tests/screenshots/history-page.png" });
  });

  test("Test 6: Settings page", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForTimeout(500);

    // Verify settings categories exist in the sidebar nav
    const settingsNav = page.locator("nav").last(); // Settings has its own <nav> sidebar
    const categoryButtons = settingsNav.locator("button");
    const categoryCount = await categoryButtons.count();
    expect(categoryCount).toBeGreaterThanOrEqual(5); // General, Appearance, Integrations, Agents, Notifications, Usage

    // Verify category labels are present
    await expect(settingsNav.locator("text=General")).toBeVisible();
    await expect(settingsNav.locator("text=Appearance")).toBeVisible();
    await expect(settingsNav.locator("text=Integrations")).toBeVisible();
    await expect(settingsNav.locator("text=Agents")).toBeVisible();
    await expect(settingsNav.locator("text=Notifications")).toBeVisible();

    // Click each category and verify content changes
    const categories = ["General", "Appearance", "Integrations", "Agents", "Notifications", "Usage"];
    for (const cat of categories) {
      await settingsNav.locator(`button:has-text("${cat}")`).click();
      await page.waitForTimeout(200);

      // Verify the category title appears in the content area
      const contentArea = page.locator(".flex-1.overflow-y-auto");
      await expect(contentArea.locator(`h2:has-text("${cat}")`).first()).toBeVisible();
    }

    await page.screenshot({ path: "tests/screenshots/settings-page.png" });
  });
});
