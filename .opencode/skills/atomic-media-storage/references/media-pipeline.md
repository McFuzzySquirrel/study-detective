# Media pipeline

Use this reference for the capture and card-detail image path.

## Validation order

1. File count: exactly one image per card.
2. Size: `file.size <= 30 * 1024 * 1024`. The exact boundary passes; one byte over fails.
3. Extension and MIME: JPEG, PNG, WebP, or GIF. Reject HEIC, HEIF, SVG, PDF, and unknown.
4. Magic bytes: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`.
5. Decode: `createImageBitmap` or an `Image` load must succeed; a corrupt or truncated file fails.

Return a typed reason so the UI can say what failed. No card, attachment, transaction, or persisted flag exists before validation passes.

## Orientation

EXIF orientation values 1-8 describe how stored pixels must be transformed for display. Choose one owner:

- Let `createImageBitmap(file, { imageOrientation: "from-image" })` apply orientation, then never re-apply it; or
- Decode un-oriented (`"none"`), read the EXIF tag, and apply the transform yourself.

Write a fixture-based test for orientation 6 (90 degrees clockwise) and orientation 8 (90 degrees counter-clockwise). If the pipeline has a manual transform and the bitmap is already oriented, the image will be sideways; that is the regression to catch.

## Crop and rotation

Store `crop: { x, y, width, height }` normalized to 0-1 of the oriented source, and `rotation: 0 | 90 | 180 | 270`. Clamp the rectangle inside the unit square. Rotation buttons cycle by exact integer quarters; never accumulate radians.

When rendering or exporting, apply rotation first, then map the normalized crop into the rotated pixel box. For 90/270, swap the crop's width and height before multiplying by the source dimensions.

Free crop with a square shortcut is the v1 editor. Provide keyboard rotation and crop nudges as the non-pointer path.

## Derivatives

| Output | Longest edge | Encoding | Notes |
|--------|--------------|----------|-------|
| Original | 4096 default | quality 0.9 | Retain full decoded resolution only when the card opts in; never upscale |
| Display | 2048 | quality 0.9 | Board and card-detail image |
| Thumbnail | 320 | quality 0.9 | Thumbnail-first board texture |

Compute `scale = min(1, cap / max(width, height))`. Round dimensions with a floor of 1. Preserve aspect ratio. Re-crop and rotation regenerate all three outputs from the retained original, not from the display derivative.

Animated GIFs are the exception: keep the original frame data for the original and display attachments, and create only a bounded static PNG thumbnail. Do not crop, rotate, or re-encode GIFs; the UI skips the crop editor and disables later crop/rotate actions. Still-image originals, display derivatives, and thumbnails continue to use the 4096/2048/320px caps.

Store MIME, width, height, byte size, and SHA-256 with each attachment. The archive exporter reuses the same metadata.

## Failure and cancellation

Stages: validating, decoding, transforming, encoding, saving, done. A cancel signal is checked before decode, before each encode, and before the transaction. On abort: close bitmaps, revoke URLs, discard canvases, and return a cancelled result with no write.

On decode or encode failure: same cleanup, retry action, no row. On transaction failure: report the storage error, leave no card, and let Retry restart from the retained in-memory source when still available.

## Test fixtures

- `e2e/fixtures/note.png` and `e2e/fixtures/source.png` for the real import journey.
- A large fixture for the 30 MB boundary and a corrupt byte fixture.
- An EXIF orientation fixture; do not generate it by rotating pixels alone, because that tests the wrong thing.
- A small 200px fixture to prove no upscaling.
