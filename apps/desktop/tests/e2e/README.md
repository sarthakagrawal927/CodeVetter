# E2E Tests (tauri-driver)

Real end-to-end tests that launch the built CodeVetter desktop app via tauri-driver's WebDriver protocol.

## Prerequisites

### 1. Install tauri-driver

```bash
cargo install tauri-driver
```

This compiles a Rust binary (~2-5 min first time). Verify with:

```bash
which tauri-driver
tauri-driver --version
```

### 2. Build the app

```bash
npm run tauri:build
```

This produces the `.app` bundle at:
```
src-tauri/target/{arch}-apple-darwin/release/bundle/macos/CodeVetter.app
```

## Running tests

```bash
npm run test:e2e
```

This will:
1. Start tauri-driver on port 4444
2. Create a WebDriver session that launches the app
3. Run assertions (window title, page content, sidebar, screenshot)
4. Clean up the session and stop tauri-driver

### Debug mode

```bash
DEBUG_TAURI_DRIVER=1 npm run test:e2e
```

## Architecture

```
tests/e2e/
  setup.ts          # tauri-driver lifecycle (start/stop) + app path resolution
  app.spec.ts       # Tests using Node's built-in test runner + raw WebDriver fetch
  README.md         # This file
```

### Why not Playwright directly?

tauri-driver implements the W3C WebDriver protocol, not Chrome DevTools Protocol (CDP).
On macOS, Tauri uses WKWebView which doesn't expose CDP. The tests use Node's
`node:test` runner with raw `fetch()` calls against the WebDriver endpoint -- zero
additional test dependencies beyond `tsx` for TypeScript execution.

## Limitations

- **Requires a built app**: `npm run tauri:build` must complete before running e2e tests
- **macOS only for now**: tauri-driver on macOS wraps safaridriver/WKWebView
- **No hot reload**: Tests run against the release build, not the dev server
- **App startup time**: The first test may be slow (~3s) as the app initializes
- **WebDriver subset**: Not all Playwright-style selectors work; use CSS selectors

## Adding new tests

Add new `it()` blocks in `app.spec.ts` or create new `*.spec.ts` files. The WebDriver
helpers (`findElement`, `getElementText`, etc.) in `app.spec.ts` can be extracted to
a shared utility as the test suite grows.

## CI integration

For GitHub Actions (macOS runners):

```yaml
- name: Install tauri-driver
  run: cargo install tauri-driver

- name: Build app
  run: npm run tauri:build

- name: Run e2e tests
  run: npm run test:e2e
```
