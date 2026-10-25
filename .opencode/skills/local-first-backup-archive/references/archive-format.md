# Archive format

Use this reference when building or reviewing the `.ndcase` manifest and exporter.

## Layout

```text
<case-slug>-<yyyy-mm-dd>.ndcase   (ZIP)
  manifest.json
  images/<attachmentId>.<ext>
```

No other top-level files or directories. No nested case directories. Exactly one case.

## Manifest

```json
{
  "format": "notes-detective-case",
  "formatVersion": 1,
  "exportedAt": "2026-10-25T18:00:00.000Z",
  "appVersion": "1.0.0",
  "dbSchemaVersion": 1,
  "case": {
    "id": "uuid",
    "title": "Cell Biology",
    "subject": "Biology",
    "examDate": "2026-11-04",
    "createdAt": "ISO",
    "updatedAt": "ISO",
    "closedAt": "ISO or null",
    "isDemo": false,
    "backupPromptedAt": "ISO or null",
    "viewport": { "x": 0, "y": 0, "scale": 1 }
  },
  "cards": [
    {
      "id": "uuid",
      "caseId": "uuid",
      "type": "note",
      "title": "Mitochondria",
      "position": { "x": 120, "y": 80 },
      "tags": ["Organelles"],
      "ocr": {
        "text": "optional",
        "confidence": 87.5,
        "engineVersion": "tesseract.js 7.0.0",
        "updatedAt": "ISO"
      }
    }
  ],
  "connections": [
    {
      "id": "uuid",
      "caseId": "uuid",
      "fromCardId": "uuid",
      "toCardId": "uuid",
      "pairKey": "sorted::pair",
      "type": "association"
    }
  ],
  "attachments": [
    {
      "id": "uuid",
      "cardId": "uuid",
      "kind": "original",
      "mime": "image/png",
      "width": 4096,
      "height": 3072,
      "bytes": 123456,
      "sha256": "hex",
      "path": "images/uuid.png"
    }
  ]
}
```

`ocr` is absent when OCR never ran. Do not write an empty object with null fields that the card schema rejects. Every card `caseId` equals the case ID. Every connection endpoint belongs to the case. Every attachment `cardId` belongs to a card in the manifest.

## Checksums

SHA-256 over the exact stored Blob bytes, lowercase hex. Verify after extracting the bytes and before writing any row. The manifest's `bytes` must match the actual entry size; the two checks together catch truncation and substitution.

## Export process

1. Read exactly one case through the repository.
2. Read its cards, connections, and attachment metadata.
3. Read each Blob once; hash it; add to the ZIP at its relative path.
4. Serialize JSON with stable key order.
5. Add `manifest.json` last or first consistently.
6. Save as `<slug>-<date>.ndcase`; slug lowercases, trims, replaces non-alphanumerics with `-`, collapses repeats, and caps length.
7. Use File System Access when present; otherwise create a Blob URL, click an anchor with `download`, and revoke the URL.

No fetch, XHR, analytics, or remote file picker. A cancelled save is a cancelled operation.

## Round-trip test

Build an archive in memory, unzip it with `fflate`, validate the manifest, verify every checksum, and assert the case count is one. Then import it into a fresh fake-indexeddb and compare tags, positions, viewport, closure, OCR, `isDemo`, and `backupPromptedAt`. A test that only asserts the ZIP is non-empty is not evidence.

## Versioning

`formatVersion` describes the archive layout. `dbSchemaVersion` describes the persisted record shape at export time. Import rejects an unknown future version with an actionable message. A future migration reads the old manifest, upgrades records in memory, and writes the current shape; it never guesses missing required fields.

## Privacy

The file is an unencrypted ZIP of the student's notes. The UI must say so before saving and advise storing it somewhere trusted. Never upload, sync, or attach it to a support report automatically.
