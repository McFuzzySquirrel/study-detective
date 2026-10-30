# Feature: Evidence Capture

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| CAP-FR-01 | This feature | owns |
| CAP-FR-02 | This feature | owns |
| CAP-FR-03 | This feature | owns |
| CAP-FR-04 | This feature | owns |
| CAP-FR-05 | This feature | owns |
| CAP-FR-06 | This feature | owns |
| VIS-CON-01 | [Vision](../PRD.md) | participates |
| VIS-CON-04 | [Vision](../PRD.md) | participates |

**PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** Evidence Capture
**ID Prefix:** CAP
**Summary:** Imports photos and animated GIFs through the native camera or library control, normalizes image derivatives, provides non-destructive crop and rotation for still images, and creates Study Note, Source, and Topic cards inside a case.
**Dependencies:** Local Data and Case Shelf
**Priority:** Must

---

## 2. User Stories

| ID | Persona | Priority |
|----|---------|----------|
| CAP-US-01 | Exam-focused university student | Must |
| CAP-US-02 | High-school student | Must |
| CAP-US-03 | Returning reviser | Must |

```forge-requirement
{"id":"CAP-US-01","kind":"story","text":"As a student, I want to photograph a page of notes and pin it to a case in a few taps so that capture does not become a separate chore."}
```

```forge-requirement
{"id":"CAP-US-02","kind":"story","text":"As a student, I want to crop and rotate a photo before saving it so that the board shows the part that matters."}
```

```forge-requirement
{"id":"CAP-US-03","kind":"story","text":"As a returning reviser, I want to fix a bad photo without losing the card's place or its future connections so that cleanup does not break the board."}
```

---

## 3. Functional Requirements

```forge-requirement
{"id":"CAP-FR-01","kind":"requirement","text":"Accept one JPEG, PNG, WebP, or GIF image up to 30 MB through a native file control that offers camera capture and photo-library selection; preserve all GIF animation frames and reject unsupported types, corrupt images, and oversized files with a clear error and create no card."}
```

```forge-requirement
{"id":"CAP-FR-02","kind":"requirement","text":"For still images, normalize EXIF orientation and store a display derivative at 2048px longest edge, a 320px thumbnail, and an original capped at 4096px longest edge at quality 0.9 by default, with a per-card opt-in to retain the imported full resolution; never upscale. GIFs retain their original animated image and receive a resized static thumbnail."}
```

```forge-requirement
{"id":"CAP-FR-03","kind":"requirement","text":"Offer non-destructive crop and 90-degree rotation for still images at import and later from card detail, store the normalized crop rectangle and rotation with the card, and regenerate derivatives from the retained original; do not crop or rotate GIFs because re-encoding would discard animation."}
```

```forge-requirement
{"id":"CAP-FR-04","kind":"requirement","text":"Create Study Note and Source cards from one image and Topic cards from text only, each with a required 1 to 80 character title and an initial board position based on the visible viewport."}
```

```forge-requirement
{"id":"CAP-FR-05","kind":"requirement","text":"Edit a card title, replace its photo, and re-crop or rotate it while preserving the card ID, so connections created later remain attached to the same card."}
```

```forge-requirement
{"id":"CAP-FR-06","kind":"requirement","text":"Show import progress with cancel and retry, and leave no orphan Blob or partial card when decoding, processing, storage, or navigation fails."}
```

```forge-requirement
{"id":"CAP-CON-01","kind":"constraint","text":"Process images locally with browser APIs; never upload an image, send it to an OCR service, or log its contents."}
```

```forge-requirement
{"id":"CAP-CON-02","kind":"constraint","text":"Preserve aspect ratio and never upscale; crop coordinates are normalized 0 to 1 so they survive derivative changes."}
```

```forge-requirement
{"id":"CAP-CON-03","kind":"constraint","text":"Commit a card and its original, display, and thumbnail attachments together; write replacement attachments before removing the old ones, and revoke object URLs on unmount."}
```

---

## 4. UI / Interaction Design

- Capture is a full-screen route reachable from a case: `/case/:caseId/capture`. It offers `Take photo` (input with `capture="environment"`), `Choose photo`, and `Add topic`. The first two use the same validation and processing path.
- After selection, the crop/rotate step shows the image on a dark mat, a square or free crop frame with touch handles, 90-degree rotate buttons, Reset, Back, and Save. The image is not written until Save.
- The card form asks for a type (Study Note or Source, fixed at creation), a title, and Save. The title may be prefilled later by OCR only if the student leaves it blank.
- Topic creation is a small text-only form with title and tags; it never asks for a photo.
- Import progress shows decoding, resizing, and saving states. Cancel aborts and returns to the case without a card. A failed decode or write shows Retry and Back and leaves no row.
- Card detail is reachable by tapping a card or selecting it in the list. It shows the full image, title, type, tags, OCR section later, Replace photo, Crop/rotate, and Delete card. Replacing the photo keeps the card ID.
- All controls are 44px, keyboard reachable, and announce errors; the crop editor offers numeric rotation buttons as the keyboard alternative to dragging handles.

---

## 5. Task Plan

| ID | Observable outcome | Owner | Key outputs | Check | Exclusions |
|----|--------------------|-------|-------------|-------|------------|
| CAP-1 | Validated, oriented derivatives and an atomic card import | capture-engineer | Validation, pipeline, card import, repository extension, tests | Unit tests and atomic failure test | No UI |
| CAP-2 | Touch and keyboard crop/rotate editor | capture-engineer | Crop math, editor, tests | Crop math and component tests | No persistence |
| CAP-3 | Capture route creates note, source, and topic cards | ui-engineer | Capture page, pickers, forms, route, tests | Capture flow tests | No card detail editing |
| CAP-4 | Card detail edits, replaces, and re-crops without changing ID | ui-engineer | Card detail, route, browser journey, fixture | Playwright capture journey | No OCR |

---

## 6. Implementation Tasks

### Phase 1: Image pipeline

```forge-task
{
  "id": "CAP-1",
  "title": "Implement validated image import and atomic card creation",
  "description": "Build imageValidation.ts to check the 30 MB limit, JPEG/PNG/WebP magic bytes, MIME compatibility, and decodability. Build imagePipeline.ts to decode with EXIF orientation, apply a normalized crop and 0/90/180/270 rotation, produce a 4096px quality-0.9 original by default or the full imported resolution when opted in, a 2048px display derivative, and a 320px thumbnail, never upscaling. Extend CaseRepository with createCardWithAttachments so the card and three Blobs commit in one transaction. Add cardImport.ts to orchestrate validation, processing, and persistence with abort and cleanup. Do not add the crop UI or capture route.",
  "ownerAgent": "capture-engineer",
  "dependencies": [
    "DATA-2"
  ],
  "expectedOutputs": [
    "src/features/capture/imageValidation.ts",
    "src/features/capture/imagePipeline.ts",
    "src/features/capture/cardImport.ts",
    "src/data/caseRepository.ts",
    "tests/capture/imageValidation.test.ts",
    "tests/capture/imagePipeline.test.ts",
    "tests/capture/cardImport.test.ts"
  ],
  "validationCommands": [
    "npm test -- tests/capture/imageValidation.test.ts tests/capture/imagePipeline.test.ts tests/capture/cardImport.test.ts",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/evidence-capture.md#CAP-FR-01",
      "docs/features/evidence-capture.md#CAP-FR-02",
      "docs/features/evidence-capture.md#CAP-FR-06"
    ],
    "acceptanceCriteria": [
      "Boundary tests cover 30 MB exactly, one byte over, spoofed MIME, corrupt bytes, and unsupported SVG or HEIC",
      "Default import emits dimensions no larger than 4096/2048/320 with no upscaling; full-resolution opt-in retains the decoded size",
      "Crop and rotation are applied to derivatives while the retained original remains available for re-cropping",
      "A storage failure leaves zero cards and zero attachments; a successful import commits all four rows together",
      "Cancel aborts processing and revokes object URLs without a write"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/evidence-capture.md#CAP-CON-01",
      "docs/features/evidence-capture.md#CAP-CON-02",
      "docs/features/evidence-capture.md#CAP-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "CAP-2",
  "title": "Build the touch and keyboard crop/rotate editor",
  "description": "Implement cropMath.ts as pure helpers for normalized crop rectangles, 90-degree rotation, rotation-aware preview dimensions, containment, reset, and output bounds. Build CropRotateEditor.tsx on react-easy-crop with a dark mat, touch handles, rotate left/right, reset, cancel, and save. Expose rotation buttons and crop nudge controls for keyboard users, 44px targets, and an announced summary of the crop. Do not persist anything from this component.",
  "ownerAgent": "capture-engineer",
  "dependencies": [
    "CAP-1",
    "FND-5"
  ],
  "expectedOutputs": [
    "src/features/capture/cropMath.ts",
    "src/features/capture/CropRotateEditor.tsx",
    "src/features/capture/crop.css",
    "tests/capture/cropMath.test.ts",
    "tests/capture/CropRotateEditor.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/capture/cropMath.test.ts tests/capture/CropRotateEditor.test.tsx",
    "npm run typecheck"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/evidence-capture.md#CAP-FR-03"
    ],
    "acceptanceCriteria": [
      "Crop math clamps rectangles to the image, preserves aspect ratio, and handles all four rotations",
      "Rotate left and right cycle through 0, 90, 180, and 270 without cumulative floating error",
      "The editor exposes keyboard rotation, reset, cancel, and save with visible focus and 44px targets",
      "Saving returns the normalized crop and rotation without mutating the source image"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/evidence-capture.md#CAP-CON-02",
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

### Phase 2: Capture and card detail

```forge-task
{
  "id": "CAP-3",
  "title": "Build the capture route for notes, sources, and topics",
  "description": "Create CapturePage at /case/:caseId/capture with separate Take photo, Choose photo, and Add topic actions. The photo inputs accept image/jpeg, image/png, and image/webp; one uses capture=environment and the other does not. After selection, run imageValidation, show progress, open CropRotateEditor, then NoteSourceForm with type, title, and a Keep full resolution toggle that defaults off and warns about storage. TopicForm creates a text-only topic. Compute an initial position from the case viewport center with a small stagger, call card import or repository create, and navigate back to the case. Wire the route in src/app/routes.tsx. Do not implement card detail editing or OCR.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "CAP-1",
    "CAP-2",
    "DATA-3"
  ],
  "expectedOutputs": [
    "src/features/capture/CapturePage.tsx",
    "src/features/capture/CaptureSourcePicker.tsx",
    "src/features/capture/NoteSourceForm.tsx",
    "src/features/capture/TopicForm.tsx",
    "src/features/capture/capture.css",
    "src/app/routes.tsx",
    "tests/capture/CaptureFlow.test.tsx",
    "tests/capture/TopicForm.test.tsx"
  ],
  "validationCommands": [
    "npm test -- tests/capture/CaptureFlow.test.tsx tests/capture/TopicForm.test.tsx",
    "npm run typecheck",
    "npm run build"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/evidence-capture.md#CAP-FR-04",
      "docs/features/evidence-capture.md#CAP-FR-06"
    ],
    "acceptanceCriteria": [
      "The capture route replaces its placeholder and returns to the case after a successful save",
      "Take photo and Choose photo both reach the same validation and crop path; Add topic never requests an image",
      "A saved note or source has one image and a valid title; a topic has no attachment",
      "The Keep full resolution toggle defaults off and opts the card into retaining the imported resolution",
      "The initial position is derived from the visible viewport and persisted",
      "Cancel, decode failure, and write failure create no card and offer Retry or Back"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/evidence-capture.md#CAP-CON-03",
      "docs/PRD.md#VIS-CON-14"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

```forge-task
{
  "id": "CAP-4",
  "title": "Build card detail with replace, re-crop, and a real browser import journey",
  "description": "Create CardDetailPage at /case/:caseId/card/:cardId showing the display image, type, title, tags slot, and actions Edit title, Replace photo, Crop/rotate, and Delete card. Replacing or re-cropping runs the image pipeline from the retained original and preserves the card ID; remove old attachments only after the new transaction succeeds. Add a Playwright journey that creates a case, imports e2e/fixtures/note.png through the native file input, rotates and crops, saves, reloads, opens card detail, edits the title, replaces the photo with e2e/fixtures/source.png, and verifies the card ID and both images after reload. Do not add OCR or connection actions.",
  "ownerAgent": "ui-engineer",
  "dependencies": [
    "CAP-3"
  ],
  "expectedOutputs": [
    "src/features/cards/CardDetailPage.tsx",
    "src/features/cards/CardDetail.css",
    "src/app/routes.tsx",
    "tests/cards/CardDetailPage.test.tsx",
    "e2e/capture.spec.ts",
    "e2e/fixtures/note.png",
    "e2e/fixtures/source.png"
  ],
  "validationCommands": [
    "npm test -- tests/cards/CardDetailPage.test.tsx",
    "npm run test:e2e -- e2e/capture.spec.ts"
  ],
  "contract": {
    "version": 2,
    "kind": "implementation",
    "requirements": [],
    "requirementRefs": [
      "docs/features/evidence-capture.md#CAP-FR-03",
      "docs/features/evidence-capture.md#CAP-FR-05"
    ],
    "acceptanceCriteria": [
      "Card detail is reachable by URL and from the case flow, shows the display image and title, and saves title edits",
      "Replace photo and re-crop preserve the card ID and leave exactly one original, display, and thumbnail attachment",
      "Old attachments are removed only after the replacement transaction succeeds",
      "The Playwright journey imports a real PNG, rotates and crops it, reloads, and verifies persistence",
      "Keyboard focus is visible and the destructive delete action requires confirmation"
    ],
    "constraints": [],
    "constraintRefs": [
      "docs/features/evidence-capture.md#CAP-CON-01",
      "docs/features/evidence-capture.md#CAP-CON-03"
    ],
    "references": [
      "docs/PRD.md#6. Technical Architecture"
    ]
  }
}
```

---

## 7. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit | Validation boundaries, crop math, derivative dimensions, atomic card creation | Vitest with mocked bitmaps and fake-indexeddb |
| Component | Crop editor, capture flow, note/source form, topic form, card detail | React Testing Library with file inputs and user-event |
| Browser | Real PNG decode, crop/rotate, save, reload, replace | Playwright with generated fixtures and assertions on persisted state |
| Manual | Touch crop handles and tablet capture | Board-feel human review |

Key scenarios:

1. Oversized, corrupt, and spoofed images are rejected before any write.
2. A 2048px display and 320px thumbnail are produced without upscaling.
3. A note save commits the card and three attachments atomically.
4. Cancel after decode leaves no orphan Blob.
5. Replace photo keeps the card ID and removes old attachments.

---

## 8. Acceptance Criteria

1. A student can create a note, source, or topic from the capture route on a tablet and phone.
2. Every imported image is validated, oriented, capped, and stored with display and thumbnail derivatives.
3. Crop and rotation are non-destructive and re-croppable from the retained original.
4. A failure never leaves a partial card or orphan image.
5. Replacing or re-cropping a photo preserves the card ID.

---

## 9. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Is 30 MB the right import limit? | Yes for v1; full-resolution retention is opt-in per card. |
| 2 | Should HEIC be supported? | No; JPEG, PNG, and WebP only. iOS users can use the camera's compatible format. |
| 3 | Should crop frames be free or fixed ratio? | Free crop with a square shortcut; the board card is 4:3 but shows the whole image. |
