---
name: accessible-case-ui
description: "React DOM patterns for the case-file UI: semantic dialogs and sheets, focus restoration, live announcements, 44 px targets, keyboard paths, and reduced motion."
---

# Accessible Case UI

Use this skill for every Notes Detective React DOM surface: shelf, case shell, capture forms, card detail, card list, connection picker, closure panel, recall results, search, backup dialog, OCR panel, settings, hints, and shared primitives. Accessibility is implemented with the feature, not audited in later; a screen that only works by pointer fails this skill.

Load `references/a11y-contracts.md` when building or reviewing dialogs, sheets, toasts, fields, focus, contrast, target sizes, motion, or plain-text rendering.

Load `references/keyboard-paths.md` when wiring the non-spatial route set, shortcuts, canvas alternatives, skip links, or a keyboard-only journey.

## Process

### Step 1: Choose the semantic surface first

Decide whether the interaction is a route, a dialog, a sheet, or an inline region. If it is a blocking decision, then use a dialog with a title, description, close action, Escape, initial focus, and focus return. If it is phone-only secondary content, then use a bottom sheet with the same semantics, not a visually similar div.

Use native elements before ARIA: `button`, `a`, `dialog`, `input`, `label`, `fieldset`, `legend`, `ul`. A click handler on a `div` is a defect. Every icon-only control needs an accessible name.

### Step 2: Preserve focus and reading order

Record the trigger element before opening an overlay and restore focus on close, cancel, Escape, and successful or failed submission. Trap focus only while the overlay is open. Move focus to the first meaningful control or the heading, not the close button by default.

Keep one `main` landmark and a logical heading order. Add a `Skip to case content` link on case screens. Announce async results, validation errors, OCR status, save success, delete/undo, result counts, and recall summaries with `aria-live`; do not rely on a color change or a toast that disappears silently.

### Step 3: Enforce target, contrast, and motion contracts

Every interactive target is at least 44x44 CSS pixels, including icon buttons, tag remove controls, crop nudges, and sheet handles. Body and control text is at least 4.5:1; large headings at least 3:1. Focus rings are visible on every surface and never removed without an equivalent.

Honor `prefers-reduced-motion` and the in-app motion toggle. Reduced motion removes pin drops, string draw, auto-pan, page transitions, pulsing indicators, and non-essential transforms while preserving the gesture and the final state.

### Step 4: Render user and imported text as text

Render titles, tags, OCR text, archive manifest strings, and filenames through React text nodes. Do not use `dangerouslySetInnerHTML` or build HTML from imported content. A malicious title must be inert.

Cap and wrap long content so a 24-character tag or an 80-character title does not force page-level horizontal scrolling at 390x844 or 1280x800.

### Step 5: Verify behavior, not just markup

Component tests assert focus, keyboard, target, name, and announcement behavior. Playwright proves the full keyboard journey and the viewport matrix.

```bash
npm test -- tests/components/primitives.test.tsx tests/a11y/keyboard.test.tsx
npm test -- tests/a11y/contrast.test.ts tests/a11y/targets.test.ts tests/a11y/reducedMotion.test.tsx
npm run test:e2e -- e2e/responsive.spec.ts e2e/keyboard-journey.spec.ts
npm run typecheck
```

If that doesn't work because a screen has no keyboard path yet, then add the route or control before adding the assertion; do not mark the test skipped.

## Gotchas

- **A sheet is not an excuse for weaker semantics.** Phone sheets still need a role, accessible name, focus trap, Escape, and focus restoration; otherwise the phone experience is keyboard-hostile.
- **Restoring focus to `document.body` loses the student's place.** Capture the actual trigger element and restore it after the overlay closes; a deleted trigger falls back to the nearest logical heading or action.
- **`aria-live` on an empty container announces nothing.** Keep the live region mounted and update its text; mounting the region with the message at the same time is unreliable in screen readers.
- **Color alone fails the legend and status badges.** Association/provenance, Orphan/Developing/Solved, and error states need text or an icon plus text.
- **44px is the target, not the icon.** A 20px icon button with a 44px hit area passes; a 40px visual button with no expanded area fails.
- **A hidden overflow container is not a layout fix.** Phone layouts must not require page-level horizontal scroll; wrap or stack instead of clipping controls.
- **Toast timing can erase the only feedback.** Errors and undo must remain reachable long enough and be announced; a 1.5-second toast for a destructive result is not accessible.
- **Focus traps leak on unmount.** Route changes and browser back must remove the trap and restore focus even if the overlay never called its close handler.
- **Imported text is untrusted.** A manifest title or tag rendered through HTML is an injection path, not a formatting convenience.
- **Reduced motion is not "no feedback".** The final state and focus changes still occur immediately; only the animation is removed.

## Validation

- [ ] Every overlay traps focus while open and restores it on close, cancel, Escape, and unmount.
- [ ] Every icon-only control has an accessible name and a 44x44 target.
- [ ] Validation errors, result counts, save/delete outcomes, OCR status, and recall summaries are announced.
- [ ] Keyboard tests complete card CRUD, provenance attach, connection CRUD, search, and recall entry/check/reset/exit without the canvas.
- [ ] The board exposes an accessible name, description, and visible `Open card list` action.
- [ ] Contrast tests pass 4.5:1 body/control and 3:1 large headings on all semantic pairs.
- [ ] Reduced motion removes the named animations and the motion toggle persists and applies without reload.
- [ ] No screen horizontally scrolls at 390x844, 768x1024, 1280x800, or 1440x900.
- [ ] No `dangerouslySetInnerHTML` receives user or imported text.

Self-check: navigate the changed screen with Tab only, then with a screen reader's virtual cursor, and confirm focus order, names, and announcements match the visual flow.
