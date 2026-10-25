# Feature: Release and Field Review

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| REL-FR-01 | This feature | owns |
| REL-FR-02 | This feature | owns |
| REL-FR-03 | This feature | owns |
| REL-FR-04 | This feature | owns |
| REL-FR-05 | This feature | owns |
| REL-FR-06 | This feature | owns |
| REL-FR-07 | This feature | owns |
| REL-FR-08 | This feature | owns |
| VIS-FR-01 | [Vision](../PRD.md) | participates |
| VIS-FR-05 | [Vision](../PRD.md) | participates |
| VIS-CON-02 | [Vision](../PRD.md) | participates |
| VIS-CON-10 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Release and Field Review
**ID Prefix:** REL
**Summary:** Makes the app shippable on GitHub Pages and locally, enforces CI and bundle budgets, verifies installable offline behavior and no third-party requests, documents support and release expectations, and gates v1 on a real human journey.
**Dependencies:** Responsive and Accessibility Hardening
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| REL-US-01 | Exam-focused university student | Must |
| REL-US-02 | Project owner | Must |

```forge-requirement
{"id":"REL-US-01","kind":"story","text":"As a student, I want to install the app on my tablet and use it offline on exam day so that a network failure cannot block revision."}
```

```forge-requirement
{"id":"REL-US-02","kind":"story","text":"As the project owner, I want an honest release check against a real exam board so that a green build is not mistaken for a useful product."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"REL-FR-01","kind":"requirement","text":"Run CI on every push and pull request with Node 24: install, lint, typecheck, unit and component tests, coverage thresholds of at least 85 percent lines on domain and data modules, production build, and Playwright journeys; any failure blocks merge."}
```

```forge-requirement
{"id":"REL-FR-02","kind":"requirement","text":"Deploy main to GitHub Pages over HTTPS with the repository base path, hash routing, correct asset URLs, Pages permissions, and a documented local production preview."}
```

```forge-requirement
{"id":"REL-FR-03","kind":"requirement","text":"Verify on the deployed build that the manifest and icons install, the app shell and OCR assets work offline after first load, and a waiting update prompts rather than activating silently."}
```

```forge-requirement
{"id":"REL-FR-04","kind":"requirement","text":"Enforce bundle budgets: initial app JavaScript at or below 300 KB gzip excluding lazy board and OCR chunks, and total service-worker precache at or below 25 MB; fail the check when exceeded."}
```

```forge-requirement
{"id":"REL-FR-05","kind":"requirement","text":"Document local setup, scripts, production preview, GitHub Pages deployment, supported browsers and devices, data and privacy behavior, backup and restore, known limitations, and the release checklist in README and docs/RELEASE.md."}
```

```forge-requirement
{"id":"REL-FR-06","kind":"requirement","text":"Gate v1 on a human acceptance journey against the deployed GitHub Pages build on a 10-inch tablet in landscape, a phone, and desktop: capture, pin, strings, close, recall, export, import, reopen, OCR, offline reload, and install."}
```

```forge-requirement
{"id":"REL-FR-07","kind":"requirement","text":"Verify that no telemetry, analytics, crash reporting, third-party script, or non-same-origin runtime request is present in the deployed build."}
```

```forge-requirement
{"id":"REL-FR-08","kind":"requirement","text":"Record the hard success signal: the reviewer would choose this board over re-reading their notes for a real exam; keep the 3–5 student reuse interviews as a post-v1 stretch, not a shipping gate."}
```

```forge-requirement
{"id":"REL-CON-01","kind":"constraint","text":"The deployed app loads only same-origin static assets; no API, CDN font, analytics, or external OCR endpoint is permitted."}
```

```forge-requirement
{"id":"REL-CON-02","kind":"constraint","text":"Use hash routing and relative manifest scope so GitHub Pages needs no server rewrite; local preview must exercise the production build, not only the dev server."}
```

```forge-requirement
{"id":"REL-CON-03","kind":"constraint","text":"Automated checks and human approval are separate gates; a passing CI run never substitutes for the human journey review."}
```

---

## 4. UI / Interaction Design

- There is no release UI beyond the app itself. The release artifacts are the GitHub Pages URL, the local preview command, the PWA install prompt, and the documentation.
- The PWA install path is browser-native. On iOS Safari, the README explains Add to Home Screen; on Android and desktop, the install prompt or browser menu is documented.
- Offline behavior is explicit: after the first successful load, the shelf, demo, board, recall, search, and OCR assets work without a network. A blocking first load without network is not possible and is documented.
- The update prompt is the existing `UpdatePrompt`; release verification confirms it appears for a waiting worker and does not activate during an open form.
- Release docs include a short `Known limitations` section: spatial editing is pointer-only; OCR is English and handwriting-dependent; archives are unencrypted; GitHub Pages cannot set custom security headers; browser storage may still be evicted.
- The final review is a checklist, not a demo. It records device, browser, URL, what was exercised, pass/fail per step, and the honest would-you-use-it answer.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| REL-1 | CI runs the full quality gate | release-engineer | CI workflow, scripts, coverage config, validator | Workflow validator, coverage, build | No deploy |
| REL-2 | GitHub Pages deploy and local preview | release-engineer | Deploy workflow, base config, deployment doc, check script | Pages build check | No PWA offline test |
| REL-3 | Installable offline PWA with no external requests and budget check | qa-engineer | PWA spec, precache budget, tests | Playwright PWA and budget check | No human review |
| REL-4 | Honest README and release documentation | release-engineer | README, RELEASE.md, docs checker | Docs checker | No implementation |
| REL-HR-1 | Human acceptance journey on three devices | human reviewer | Review JSON | Real deployed journey | Cannot be automated |

---

## 6. Implementation Tasks

### Phase 1: CI and deployment

```forge-task
{
  "id": "REL-1",
  "title": "Create the CI quality gate with coverage thresholds",
  "description": "Add .github/workflows/ci.yml for push and pull_request using Node 24, npm ci, lint, typecheck, unit/component tests with coverage, production build, Playwright browser installation with dependencies, and the E2E suite. Configure Vitest coverage thresholds of 85 percent lines for src/domain and src/data and fail on uncovered files. Add scripts/validate-workflows.mjs using yaml to assert the required jobs, steps, Node version, and absence of unconditional exit-zero or continue-on-error on required steps. Add tests/release/ciConfig.test.ts to exercise the validator. Do not add deployment.",
  "ownerAgent": "release-engineer",
  "dependencies": [
    "A11Y-6"
  ],
  "expectedOutputs": [
    ".github/workflows/ci.yml",
    "package.json",
    "vitest.config.ts",
    "scripts/validate-workflows.mjs",
    "tests/release/ciConfig.test.ts"
  ],
  "validationCommands": [
    "node scripts/validate-workflows.mjs",
    "npm test -- tests/release/ciConfig.test.ts",
    "npm run test:coverage",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/release-and-field-review.md#REL-FR-01"
    ],
    "acceptanceCriteria": [
      "CI triggers on push and pull_request and uses Node 24 with npm ci",
      "Lint, typecheck, coverage tests, build, and Playwright E2E are required steps with no bypass",
      "Coverage thresholds fail when domain or data line coverage drops below 85 percent",
      "Playwright installs Chromium, Firefox, and WebKit with dependencies",
      "The workflow validator fails on a missing step or an unconditional success step"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/release-and-field-review.md#REL-CON-03"
    ],
    "references": [
      "docs/PRD.md#7. Non-Functional Requirements"
    ]
  }
}
```

```forge-task
{
  "id": "REL-2",
  "title": "Deploy to GitHub Pages with a verified base path and local preview",
  "description": "Add .github/workflows/deploy-pages.yml for main with pages:write and id-token:write permissions, an environment, a VITE_BASE_PATH of the repository name, build, artifact upload, and deploy-pages. Update vite.config.ts to read the base path, keep hash routing, and emit relative manifest start_url and scope. Add scripts/check-pages-build.mjs to assert the built index references prefixed assets, the manifest and icons exist, start_url and scope are relative, and no absolute /assets path leaks. Add docs/DEPLOYMENT.md with the Pages URL pattern, base path behavior, permissions, local production preview commands, and troubleshooting. Add tests/release/pagesConfig.test.ts to exercise the check script. Do not add offline E2E.",
  "ownerAgent": "release-engineer",
  "dependencies": [
    "REL-1"
  ],
  "expectedOutputs": [
    ".github/workflows/deploy-pages.yml",
    "vite.config.ts",
    "scripts/check-pages-build.mjs",
    "docs/DEPLOYMENT.md",
    "tests/release/pagesConfig.test.ts"
  ],
  "validationCommands": [
    "node scripts/validate-workflows.mjs",
    "VITE_BASE_PATH=/notes-detective/ npm run build && node scripts/check-pages-build.mjs",
    "npm test -- tests/release/pagesConfig.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/release-and-field-review.md#REL-FR-02"
    ],
    "acceptanceCriteria": [
      "The deploy workflow runs on main with Pages permissions, an environment, artifact upload, and deploy-pages",
      "A build with VITE_BASE_PATH=/notes-detective/ references only prefixed assets and no absolute /assets path",
      "Manifest start_url and scope are relative and icons resolve under the base path",
      "Local production preview is documented with the exact build and preview commands",
      "Hash routing means a direct route loads without a server rewrite"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/release-and-field-review.md#REL-CON-02",
      "docs/PRD.md#VIS-CON-10"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Offline release verification

```forge-task
{
  "id": "REL-3",
  "title": "Verify installable offline PWA, same-origin requests, and precache budget",
  "description": "Add e2e/pwa.spec.ts to load the production preview, assert manifest and icons, wait for service-worker control, switch the context offline, reload the app shell, verify the shelf and demo case still render, and confirm the OCR worker, wasm, and traineddata URLs are present in the service-worker cache. Collect all runtime requests and fail on any non-same-origin request. Add scripts/check-bundle-budget.mjs to read the service-worker precache manifest and fail above 25 MB, and tests/release/bundleBudget.test.ts for its parser. Do not add the human review.",
  "ownerAgent": "qa-engineer",
  "dependencies": [
    "REL-2"
  ],
  "expectedOutputs": [
    "e2e/pwa.spec.ts",
    "scripts/check-bundle-budget.mjs",
    "tests/release/bundleBudget.test.ts"
  ],
  "validationCommands": [
    "npm run build && node scripts/check-bundle-budget.mjs",
    "npm test -- tests/release/bundleBudget.test.ts",
    "npm run test:e2e -- e2e/pwa.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/release-and-field-review.md#REL-FR-03",
      "docs/features/release-and-field-review.md#REL-FR-04",
      "docs/features/release-and-field-review.md#REL-FR-07",
      "docs/PRD.md#VIS-FR-01",
      "docs/PRD.md#VIS-FR-05"
    ],
    "acceptanceCriteria": [
      "The manifest, 192/512/maskable icons, and service worker are present in the production preview",
      "After first load, an offline reload renders the shelf and demo case from the app shell cache",
      "OCR worker, wasm, and English traineddata are precached and available offline",
      "No runtime request targets a different origin",
      "The precache manifest is at or below 25 MB or the check fails"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/release-and-field-review.md#REL-CON-01",
      "docs/PRD.md#VIS-CON-02",
      "docs/PRD.md#VIS-CON-07"
    ],
    "references": [
      "docs/PRD.md#7. Non-Functional Requirements"
    ]
  }
}
```

### Phase 3: Documentation and human gate

```forge-task
{
  "id": "REL-4",
  "title": "Write release documentation and support matrix",
  "description": "Replace README.md with the product summary, prerequisites, install, dev, test, coverage, E2E, production preview, GitHub Pages deployment, data and privacy model, backup and restore, supported browsers and devices, known limitations, and links to the PRD and features. Create docs/RELEASE.md with version, date, release checklist, CI and manual gates, hard success signal, post-v1 pilot plan, and a changelog section. Add scripts/check-release-docs.mjs to assert required headings, links, commands, and the absence of TODO, TBD, and example.com placeholders. Add tests/release/releaseDocs.test.ts to exercise the checker. Do not change product code.",
  "ownerAgent": "release-engineer",
  "dependencies": [
    "REL-3"
  ],
  "expectedOutputs": [
    "README.md",
    "docs/RELEASE.md",
    "scripts/check-release-docs.mjs",
    "tests/release/releaseDocs.test.ts"
  ],
  "validationCommands": [
    "node scripts/check-release-docs.mjs",
    "npm test -- tests/release/releaseDocs.test.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/release-and-field-review.md#REL-FR-05",
      "docs/features/release-and-field-review.md#REL-FR-08"
    ],
    "acceptanceCriteria": [
      "README covers setup, scripts, preview, deploy, privacy, backup, support matrix, and known limitations",
      "RELEASE.md covers the checklist, automated versus human gates, the hard success signal, and the post-v1 pilot",
      "The checker fails on missing headings, broken local links, missing commands, or placeholder text",
      "No claim of encryption, cloud sync, or screen-reader canvas parity appears"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/release-and-field-review.md#REL-CON-03"
    ],
    "references": [
      "docs/PRD.md#11. Analytics / Success Metrics"
    ]
  }
}
```

```forge-task
{
  "id": "REL-HR-1",
  "title": "Complete the human acceptance journey on tablet, phone, and desktop",
  "description": "Using the deployed GitHub Pages URL, complete the full journey on a 10-inch tablet in landscape, a phone, and desktop: install or add to home screen, open the demo, create a case, import real photos, crop/rotate, pin, draw associations and provenance, close the case, run recall and check, run OCR on one card, export the case, delete it, import it as a copy, reopen it, go offline and reload, and confirm no third-party requests appear in the network panel. Complete the keyboard path on desktop. Record device, browser, URL, each step's pass/fail, any defect, and the honest answer to whether you would choose this board over re-reading your notes for a real exam. This gate is separate from CI and cannot be approved by an agent.",
  "dependencies": [
    "REL-1",
    "REL-2",
    "REL-3",
    "REL-4"
  ],
  "expectedOutputs": [],
  "validationCommands": [],
  "contract": {
    "version": 2,
    "kind": "human-review",
    "requirements": [],
    "requirementRefs": [
      "docs/features/release-and-field-review.md#REL-FR-06",
      "docs/features/release-and-field-review.md#REL-FR-07",
      "docs/features/release-and-field-review.md#REL-FR-08",
      "docs/PRD.md#VIS-FR-05"
    ],
    "acceptanceCriteria": [
      "The full capture, pin, string, close, recall, OCR, export, import, reopen, offline, and install journey passed on the deployed build",
      "The journey was completed on a 10-inch tablet landscape, a phone, and desktop; the keyboard path was completed on desktop",
      "The network panel showed no third-party or telemetry request",
      "Every step has a recorded pass/fail and any defect includes reproduction notes",
      "The reviewer records whether they would choose the board over re-reading their notes for a real exam"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/release-and-field-review.md#REL-CON-01",
      "docs/features/release-and-field-review.md#REL-CON-03",
      "docs/PRD.md#VIS-CON-02"
    ],
    "references": [
      "docs/PRD.md#11. Analytics / Success Metrics"
    ],
    "reviewFile": "docs/reviews/final-acceptance.json"
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| CI | Lint, typecheck, coverage, build, E2E | GitHub Actions on Node 24 |
| Deploy | Base path, assets, manifest scope | Build with the Pages base and a scripted check |
| Browser | Offline reload, precache, same-origin requests, update prompt | Playwright against `vite preview` |
| Docs | Required sections, links, commands, placeholders | Node checker and Vitest |
| Human | Full journey on three devices | REL-HR-1 review JSON |

Key scenarios:

1. CI fails on a missing required step or a coverage drop.
2. The Pages build uses prefixed assets and relative manifest scope.
3. An offline reload renders the app and OCR assets are cached.
4. No non-same-origin request appears.
5. The human journey passes on tablet, phone, and desktop.

---

## 8. Acceptance Criteria

1. CI runs lint, typecheck, coverage, build, and E2E on every push and PR.
2. Main deploys to GitHub Pages with a verified base path and hash routing.
3. The installed app works offline after first load, including OCR assets.
4. Bundle and precache budgets pass; no external runtime request exists.
5. README and RELEASE.md are complete and checked.
6. A human completes the full journey on tablet, phone, and desktop and records the success answer.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Is GitHub Pages the only deploy target? | Yes, plus local production preview. |
| 2 | Should CI run the full three-browser journey matrix? | No; Chromium runs the full journey, Firefox and WebKit run a smoke path. |
| 3 | What happens if the reviewer would not use it? | Record the failure and the specific reason; do not treat the release as accepted. |
