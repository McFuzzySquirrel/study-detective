# Deployment

Notes Detective ships as a static site on GitHub Pages. There is no backend, database,
authentication service, cloud function, or secret. GitHub Pages serves the contents of `dist/`
over HTTPS at a project-site URL, and every case, card, image, and OCR result stays in the
browser on the device.

This document covers the deploy workflow, the single base-path input, the exact local production
preview commands, and the failures that look like app bugs but are really hosting configuration.

Related documents: [PRD](PRD.md), [Release and Field Review](features/release-and-field-review.md),
and [README](../README.md).

## Deployed URL

The project-site pattern is:

```text
https://GITHUB-OWNER.github.io/REPOSITORY/
```

For this repository the base path is `/notes-detective/`, so a deployed page looks like the
following example, where `octocat` stands in for the GitHub owner:

```text
https://octocat.github.io/notes-detective/#/settings
https://octocat.github.io/notes-detective/#/case/01JABC123
```

Replace `octocat` with the GitHub user or organization that owns the repository. The workflow
derives the base path from `github.event.repository.name`, so a renamed repository gets the new
path automatically; no build configuration hard-codes the repository name.

Routing is hash-based (`HashRouter` in `src/app/App.tsx`). Everything after `#` stays in the
browser and is never sent to GitHub Pages. That is why a deep route needs no server rewrite, no
`404.html` shim, and no redirect rule. A path-style URL such as
`https://octocat.github.io/notes-detective/case/01JABC123` is not supported and will 404.

## What the deploy workflow does

`.github/workflows/deploy-pages.yml` runs on a push to `main` only. Pull requests run
`.github/workflows/ci.yml` and never deploy.

| Job | Step | Purpose |
| --- | --- | --- |
| `build` | Check out, set up Node 24, `npm ci` | Reproducible install from the lockfile |
| `build` | `npm run build` with `VITE_BASE_PATH` set to the repository base (`/notes-detective/` here) | Emit a project-site build with prefixed asset URLs |
| `build` | `node scripts/check-pages-build.mjs` | Fail before upload if the base path, manifest, or icons are wrong |
| `build` | `actions/configure-pages`, `actions/upload-pages-artifact` | Publish `dist/` as the Pages artifact |
| `deploy` | `actions/deploy-pages` in the `github-pages` environment | Publish the artifact and expose `page_url` |

Workflow permissions are deliberately narrow:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

`pages: write` publishes the artifact; `id-token: write` lets the deploy action prove the
workflow's identity to Pages. No repository secret or personal token is used.

### One-time repository setup

1. Open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Keep the default branch as `main`. The workflow does not deploy from any other branch.
4. Protect `main` and require the **Quality gate (Node 24)** status check from the CI workflow.
   The deploy workflow builds and publishes; the merge gate is what proves the commit passed
   lint, typecheck, coverage, build, and Playwright journeys before it lands on `main`.
5. Optionally add protection rules to the `github-pages` environment. The workflow creates the
   environment on first use and reports the deployed URL there.

The deploy workflow runs its own `npm ci` and build rather than reusing a CI artifact. That keeps
the deployed bytes tied to the exact `main` commit and avoids trusting an artifact from another
run, at the cost of one extra build.

## Base path behavior

`VITE_BASE_PATH` is the single base-path input. `vite.config.ts` normalizes it and passes it to
Vite:

| `VITE_BASE_PATH` | Vite `base` | Use |
| --- | --- | --- |
| unset | `./` | Portable local build and the root-served Playwright suite |
| `/notes-detective` or `notes-detective` | `/notes-detective/` | GitHub Pages project site |
| `/` | `/` | A domain-root deployment (not used by this repository) |

Rules that the build relies on:

- **The base path is build-time, not runtime.** Changing `VITE_BASE_PATH` after `vite build`
  does nothing. Rebuild before previewing or deploying.
- **Asset URLs are emitted with the prefix.** A Pages build references
  `/notes-detective/assets/index-<hash>.js`, never `/assets/index-<hash>.js`.
- **The manifest stays relative.** `start_url`, `scope`, and `id` are `./`, and icon sources are
  `icons/icon-192.png`, `icons/icon-512.png`, and `icons/maskable-512.png`. A browser resolves
  them against `/notes-detective/manifest.webmanifest`, so an installed app launches and scopes
  under `/notes-detective/` rather than the domain root.
- **Runtime asset URLs come from `import.meta.env.BASE_URL`.** OCR worker, wasm, and traineddata
  paths follow the same single input. Do not add a second hard-coded `/notes-detective/` string
  in application code.
- **Absolute URLs are rejected.** The app loads same-origin static assets only; there is no CDN
  font, analytics script, or external OCR endpoint.

### What the build check enforces

`scripts/check-pages-build.mjs` reads the emitted `dist/` and exits non-zero when:

- `index.html` is missing, empty, or references no assets;
- a script, stylesheet, preload, or other asset URL is not prefixed with the expected base;
- a root-absolute `/assets/...` path leaks outside the base path;
- any reference targets another origin (`http://`, `https://`, `//host`) or uses a `javascript:`
  URL;
- a referenced local file is missing or empty;
- the manifest link is missing, absolute, or points at a missing file;
- `start_url` or `scope` is missing; any of `start_url`, `scope`, or `id` is absolute or
  resolves outside the base path;
- an icon source is absolute, resolves outside the base path, is missing, is not a PNG, or does
  not match its declared `sizes`.

With no `--base`, the script infers the base from `index.html` so the same command checks a local
build and a Pages build. The deploy workflow passes `VITE_BASE_PATH`, which the script reads, so a
silent fallback to `./` fails the deployment instead of shipping.

## Local production preview

The Vite dev server (`npm run dev`) does not exercise base-path behavior. Preview the production
build instead.

### Root-relative preview (default build)

```bash
npm ci
npm run build
npm run preview
```

Open <http://localhost:4173/>. A hash route such as <http://localhost:4173/#/settings> loads the
settings screen directly.

### Pages base-path preview

Build and preview with the same base path. The build must run with `VITE_BASE_PATH`; the preview
server must be told to serve the files under that path.

```bash
VITE_BASE_PATH=/notes-detective/ npm run build
npx vite preview --base /notes-detective/
```

Open <http://localhost:4173/notes-detective/> and then a direct hash route such as
<http://localhost:4173/notes-detective/#/settings>. The equivalent npm script form is:

```bash
npm run preview -- --base /notes-detective/
```

Run the same checker the deploy workflow runs:

```bash
node scripts/check-pages-build.mjs --base /notes-detective/
```

Expected tail of a passing run:

```text
Pages build check passed.
base:     /notes-detective/ (explicit)
manifest: manifest.webmanifest (start_url "./", scope "./")
icon:     icons/icon-192.png 192x192 ...
icon:     icons/icon-512.png 512x512 ...
icon:     icons/maskable-512.png 512x512 ...
```

To confirm the production build behaves like the deployed site, keep the preview running,
open DevTools → Application → Manifest and Service Workers, and check that the manifest URL,
scope, and icon URLs all start with `/notes-detective/`. The service-worker install and offline
reload are verified separately by the release offline checks and the human acceptance journey;
this document does not claim offline readiness from the preview alone.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blank page; console 404s for `/notes-detective/assets/...` | The preview server is serving the build from the domain root | Re-run `npx vite preview --base /notes-detective/`, or rebuild with the base path the preview uses |
| Asset 404s for `/assets/...` on GitHub Pages | The build ran without `VITE_BASE_PATH`, or code hand-wrote `/assets/...` | Build with the repository base; replace hand-written asset URLs with imports or `import.meta.env.BASE_URL` |
| The installed app opens the domain root instead of `/notes-detective/` | The manifest has an absolute `start_url` or `scope` | Keep `start_url`, `scope`, and `id` at `./`; re-run the check script |
| An icon 404s after install | An icon file is missing, renamed, or the wrong pixel size | Regenerate `public/icons` with `scripts/generate-icons.mjs`, rebuild, and run the check script |
| A copied route URL returns 404 | The URL is path-based (`/case/01JABC123`) instead of hash-based (`/#/case/01JABC123`) | Use the hash URL; do not add a 404 rewrite shim |
| A direct hash route shows a blank page | The browser requested a missing asset before the app mounted, usually a base mismatch | Compare the network URL with the base path; rebuild and preview with the same base |
| An old version keeps loading after a deploy | A waiting service worker has not been activated | Use the in-app **Refresh** action, or close the tab and reopen; do not expect the update to activate silently |
| The deploy job fails with "Get Pages site failed" or a not-enabled error | Pages is not configured to deploy from GitHub Actions | Settings → Pages → Source: **GitHub Actions** |
| The deploy job fails with a permissions or environment error | `pages: write` / `id-token: write` missing, or the `github-pages` environment blocks the branch | Restore the workflow permissions and allow the `main` branch in the environment rules |
| `upload-pages-artifact` fails because no files were found | The build failed or wrote somewhere other than `dist` | Fix the build; keep `path: dist` and the check step in front of the upload |
| The deploy workflow does not run | The push was not to `main`, or the push was to a pull request branch | Merge to `main`; pull requests run CI only |
| Local preview 404s under `/notes-detective/` | `vite preview` was started without `--base` | Add `--base /notes-detective/` |
| The preview works but the deployment does not | The deploy build used a different base than the preview | Rebuild both with the same `VITE_BASE_PATH` |

## Hosting limits

GitHub Pages serves static files only. It cannot set custom response headers, so this project
does not claim a strict Content-Security-Policy, HSTS, or custom cache headers. It relies on
same-origin assets, no inline event handlers, no third-party scripts, and a service worker that
precaches the app shell. GitHub Pages provides HTTPS for the default `*.github.io` domain.

The deployment is not an acceptance gate for the product. A green deploy proves that the static
artifact was built with the right base path, passed the Pages build check, and was published. The
human acceptance journey in `docs/reviews/final-acceptance.json` is separate and cannot be
approved by CI or by an agent.

## Verification commands

```bash
# CI workflow contract
node scripts/validate-workflows.mjs

# Production build under the GitHub Pages base path, then the deploy gate
VITE_BASE_PATH=/notes-detective/ npm run build
node scripts/check-pages-build.mjs --base /notes-detective/

# Parser and workflow tests for the Pages check
npm test -- tests/release/pagesConfig.test.ts
```
