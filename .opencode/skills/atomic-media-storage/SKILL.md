---
name: atomic-media-storage
description: "Validated image ingestion, EXIF-aware derivative generation, attachment replacement, and failure-safe multi-table Blob transactions in local IndexedDB."
---

# Atomic Media Storage

Use this skill for every path that turns a student photo into stored evidence: file validation, EXIF orientation, crop and rotation, derivative generation, card creation, attachment replacement, deletion, and object URL cleanup. The success condition is a card whose original, display, and thumbnail Blobs all exist or no card at all; a partial card or orphan Blob is a defect.

Load `references/media-pipeline.md` when implementing validation, decoding, orientation, crop math, rotation, resizing, encoding, or derivative dimensions.

Load `references/atomic-writes.md` when implementing card creation, attachment replacement, abort, cleanup, or a failure-injection test.

## Process

### Step 1: Validate before decoding

Accept one JPEG, PNG, WebP, or GIF image up to 30 MB. Check the size boundary, magic bytes, MIME compatibility, and decodability in that order. Reject SVG, HEIC, a spoofed MIME, a truncated file, and one byte over the limit with a visible error and no write. Preserve GIF frames; do not crop, rotate, or re-encode animated GIFs. Do not trust the file extension or the browser-reported type alone.

If validation fails, then stop before any bitmap, canvas, transaction, or object URL exists.

### Step 2: Normalize orientation once

Decode with EXIF orientation applied exactly once. If the decoder applies orientation automatically, then request un-oriented pixels or strip the tag before canvas drawing; applying it twice rotates portrait photos onto their side. Then apply the student's normalized crop and integer 90-degree rotation.

Keep crop coordinates normalized 0-1 and a rotation in `{0, 90, 180, 270}`. Cycling left/right must return to the same rotation without cumulative floating error. Compute output dimensions after rotation so a landscape crop of a portrait source is not letterboxed or squashed.

### Step 3: Generate bounded derivatives

For still images, default original: longest edge at most 4096px, quality 0.9. Display: longest edge 2048px. Thumbnail: longest edge 320px. Preserve aspect ratio and never upscale; a 900px source produces a 900px original, not a 4096px one. A per-card full-resolution opt-in retains the decoded size and defaults off with a storage warning. GIF original and display attachments preserve the animated source bytes; make only a bounded static PNG thumbnail.

Derive all three outputs from the retained original so a later re-crop regenerates them without the original import file. Do not mutate or overwrite the retained original when cropping.

### Step 4: Commit card and Blobs together

Call the repository's atomic card-with-attachments method so the card row and three attachment rows commit in one IndexedDB transaction. On replacement, write the new original/display/thumbnail and update the card in one transaction, keep the card ID, then delete the previous attachment rows and Blobs only after success.

If storage, decoding, or navigation fails at any point, then leave zero cards and zero attachments. Cancel is an abort, not a silent success; check an abort signal between stages and before the transaction.

### Step 5: Verify the real browser path

Write unit tests with mocked bitmaps and `fake-indexeddb` for boundaries and rollback, then a Playwright journey with real PNG fixtures that imports, rotates, crops, saves, reloads, replaces, and re-crops.

```bash
npm test -- tests/capture/imageValidation.test.ts tests/capture/imagePipeline.test.ts tests/capture/cardImport.test.ts
npm test -- tests/capture/cropMath.test.ts tests/cards/CardDetailPage.test.tsx
npm run test:e2e -- e2e/capture.spec.ts
npm run typecheck
```

If that doesn't work because the fixture or test file is missing, then add the fixture under `e2e/fixtures/` and keep the command unchanged. Do not replace the browser journey with a mocked File object.

## Gotchas

- **EXIF orientation is applied twice in the common pipeline.** `createImageBitmap(file, { imageOrientation: "from-image" })` already rotates the pixels; drawing that bitmap after a manual EXIF transform produces sideways portraits. Pick one owner for orientation and test with an EXIF-tagged fixture.
- **Magic bytes beat the MIME string.** A `.svg` renamed to `.png` or a HEIC with `image/jpeg` spoofing must fail on bytes, not on the browser's `file.type`.
- **Replacement order is not optional.** Deleting old attachments before the new transaction commits turns a failed replace into a card with no image.
- **A replacement must preserve the card ID.** Creating a new card and copying fields silently detaches every existing connection.
- **Never upscale a small import.** A 320px thumbnail from a 200px source must stay 200px; enforcing a target size creates blurry, larger-than-original blobs.
- **Object URLs belong to the view, not storage.** Store Blobs, create URLs on render, and revoke on unmount, cancel, replacement success, and error. An object URL written into a record is unrecoverable after reload.
- **Crop rectangles are normalized.** Persist 0-1 coordinates plus rotation, not pixel rectangles tied to one derivative; otherwise a 2048px display re-crop drifts from the original.
- **Abort after decode still needs cleanup.** Closing the bitmap and revoking URLs is part of cancel; otherwise a cancelled 30 MB import stays resident.
- **One image per card.** Multi-image cards are out of scope for v1; reject a second file rather than merging it.

## Validation

- [ ] Boundary tests cover 30 MB exactly, one byte over, spoofed MIME, corrupt bytes, SVG, HEIC, and a zero-byte file.
- [ ] Orientation tests prove an EXIF-rotated photo lands upright with a single transform.
- [ ] Derivative tests assert 4096/2048/320 caps, no upscaling, quality 0.9, and full-resolution opt-in behavior.
- [ ] Crop and rotation tests cover all four rotations, normalized containment, reset, and rotation-aware dimensions.
- [ ] A forced transaction failure leaves zero cards and zero attachments; a successful import commits all four rows.
- [ ] Replacement keeps the card ID and leaves exactly one original, display, and thumbnail after reload.
- [ ] Cancel and unmount revoke object URLs and close bitmaps.

Self-check: trace every error and cancel branch to a cleanup call and a repository state with no partial rows.
