# notes-detective

Turning your notes into a detective story

## Browser support

Notes Detective is an offline-first, local-only PWA. It supports the current versions of Chrome,
Edge, Firefox, and Safari on desktop, plus current iOS Safari and Android Chrome.

The app checks these browser APIs on load. If one is missing, the shelf still opens and a
non-blocking notice names the reduced capability with a link back to this matrix.

| Capability                       | Required API                                                                           | If the API is missing                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Local case storage               | [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)            | Cases and cards cannot be saved on this device.                                                     |
| On-device text recognition (OCR) | [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)        | OCR is unavailable; cards, the board, search, and recall still work.                                |
| On-device text recognition (OCR) | [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly)                    | OCR is unavailable; cards, the board, search, and recall still work.                                |
| Offline app shell                | [Service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) | The app still runs while the current page is open, but it cannot load from cache without a network. |

| Browser | Desktop | Mobile                 |
| ------- | ------- | ---------------------- |
| Chrome  | Current | Android Chrome current |
| Edge    | Current | —                      |
| Firefox | Current | —                      |
| Safari  | Current | iOS Safari current     |

Unsupported browsers are not blocked. They receive the capability notice described above.
