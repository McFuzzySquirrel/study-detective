# Browser harness

Use this reference for Playwright configuration and evidence mechanics.

## Projects

| Project | Viewport | Use |
|---------|----------|-----|
| `desktop` | 1440x900 | Full journeys, keyboard path |
| `tablet-landscape` | 1280x800 | Primary arranging target, board feel, touch paths |
| `phone` | 390x844 | Sheets, overflow, capture |
| `tablet-portrait` | 768x1024 | Responsive hardening |
| `firefox` / `webkit` | desktop | Smoke routes only |

Chromium runs the full journey matrix. Firefox and WebKit run `e2e/compat.spec.ts` to keep CI time bounded. A failing smoke route still blocks release.

## Base URL and build

`test:e2e` builds before running. For base-path and PWA claims, use `vite preview --base /notes-detective/` and the matching URL. The dev server is acceptable only for interaction checks that make no deployment claim.

## Fresh state

Use a new browser context per spec or `test.use({ storageState: undefined })`. Clear IndexedDB and service workers at the start when the journey expects first-run behavior. Never depend on a previous spec's seeded case.

## File input

```ts
const input = page.locator('input[type="file"]');
await input.setInputFiles("e2e/fixtures/note.png");
await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
```

If the input is hidden but reachable, target it directly. If the app uses a file chooser, use `page.waitForEvent("filechooser")` and `fileChooser.setFiles`. Do not click the OS dialog.

## Downloads

```ts
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "Export" }).click(),
]);
const path = await download.path();
```

Validate the file extension, non-empty bytes, ZIP entries, manifest, and checksums. For the restore journey, import the same saved path. Do not mock the archive.

## Offline

1. Load the production preview and wait for `navigator.serviceWorker.ready`.
2. Assert `navigator.serviceWorker.controller` is non-null after a reload if the app claims control.
3. Inspect `caches.keys()` and cache entries for the shell and OCR files.
4. `await context.setOffline(true)`.
5. Reload, assert the shelf and demo render.
6. Restore online and assert a waiting update prompts rather than reloading silently.

## Viewport overflow

Check `document.documentElement.scrollWidth <= document.documentElement.clientWidth` and the screen container. Exclude the board's own pan surface. Assert every primary action is reachable; a clipped action is a failure even without scroll.

## Axe

Use `@axe-core/playwright` with a shared config. Scan after each screen reaches a stable state. Open dialogs, sheets, the search panel, and the connection picker and scan again. Fail on `serious` and `critical`; document any `moderate` exclusion with a reason. Do not exclude interactive controls, focus indicators, or landmarks.

## Performance

Seed 150 cards via the IndexedDB schema helper, open the board, wait for an interactive marker, then sample frames during a scripted pan for five seconds. Record average FPS, p95 frame time, and the sample count. Enforce the documented CI floor (30 FPS headless) and defer the 45 FPS tablet claim to human review.

## Network audit

```ts
const external: string[] = [];
page.on("request", (request) => {
  const url = new URL(request.url());
  if (url.protocol.startsWith("http") && url.origin !== baseOrigin) external.push(request.url());
});
```

Allow `data:` and `blob:`. Fail on any external HTTP(S) host. Also scan the built HTML for remote preconnect/dns-prefetch hints.

## Evidence artifacts

On failure, attach a screenshot, the console log, and the relevant storage/network snapshot. On pass, record the command, project, viewport, fixture, and observed value in the task evidence. Screenshots never replace an assertion.

## Flake control

- Wait for observable state (`expect(...).toBeVisible()`, a saved marker, a service-worker state), not fixed sleeps.
- Use deterministic clocks and fixed fixture bytes.
- Avoid test order dependence; each spec seeds its own state.
- Retry only with a documented cause; a retry that hides a race is not a pass.
