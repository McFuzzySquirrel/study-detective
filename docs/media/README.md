# README media

Every file in this directory is captured from the production build with the generated demo case
(`Demo Case: The Missing Lecture`). The demo pages are drawn locally on a canvas by the app, so the
media contains no personal notes, photos, account details, remote images, web fonts, or third-party
artwork.

## Files

| File                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `demo.gif`           | Board, closure, recall scratch drawing, and recall results in one loop.  |
| `board.png`          | The fitted demo board with its six cards and five strings.               |
| `closure.png`        | The Case closure panel, ready to close with no loose threads.            |
| `card-detail.png`    | A Study Note detail screen with its generated lecture page and actions.  |
| `recall-results.png` | Recall pair lists and the scratch connection marked on the board.        |
| `phone-board.png`    | The demo board at 390x844 with the compact bottom action bar.            |

The desktop stills are 1440x900 and the phone still is 390x844. The GIF is 1152x720 and runs for
about 15 seconds. The GIF must stay at or below 5 MiB; the capture fails instead of writing an
oversized file.

## Regenerate

```bash
npm ci
npx playwright install chromium
npm run media
```

`npm run media` builds the app first, starts a `vite preview` on a free local port, and captures
both the stills and the GIF. It uses a fresh browser profile so the first-run demo seeds itself, and
it dismisses the one-time hints and toasts that would otherwise sit over the board. The preview is
stopped on success and on failure.

The script needs a Chromium browser from Playwright, which the end-to-end suite already requires. It
has no ffmpeg or ImageMagick dependency: frames are assembled into the GIF with `sharp`.

### Existing preview or partial capture

```bash
node scripts/capture-media.mjs --url http://127.0.0.1:4173
node scripts/capture-media.mjs --stills-only
node scripts/capture-media.mjs --gif-only
```

`--url` uses an already running preview instead of starting one. Run `npm run build` first when
using it, because the script does not rebuild.

## WebGL and image quality

The board renders its cards as PixiJS textures. With a software WebGL renderer such as SwiftShader
the app deliberately renders at a reduced backing-store resolution, which makes the captured board
soft. The script warns when it detects a software renderer; a machine with a GPU produces the
media in this directory. On Linux the script asks Chromium for hardware GL
(`--enable-gpu --use-gl=angle --use-angle=gl`) and falls back to the default launch if that fails.

The phone still steps the board out to 80% so the two visible notes and their page images stay
legible at 390px.

## Privacy

The screenshots are ordinary app captures. They use the demo case because it is generated locally
and is removed from a real install with the shelf's **Remove demo** action. No user case is opened,
read, or exported by the capture script.
