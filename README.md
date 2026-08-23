# Ulysses Export for Obsidian

> **Documentación completa en español: [README.es.md](README.es.md)**

Export Obsidian notes to **PDF, DOCX and HTML** using **real Ulysses
`.ulss` style sheets** — the ones you already use on macOS, or any style
from the [Ulysses style gallery](https://styles.ulysses.app).

Its centrepiece is an **in-house PDF typesetter**: the PDF is not produced
by a print dialog or a browser — the plugin composes it itself with
[Typst](https://typst.app) compiled to WebAssembly. That is why it works
**identically on desktop (Windows, macOS, Linux) and mobile (iOS,
Android)**, fully offline.

## Features

- **PDF** typeset in-process: footnotes, page numbers, widow/orphan
  control, justification, Spanish dialogue dashes, nested lists, verse
  mode, tables and images.
- **DOCX** with named styles (restyleable in Word), native footnotes and
  native list numbering, matching the PDF geometry.
- **HTML** as a standalone file.
- A live **`.ulss` style editor** inside Obsidian.

## The PDF engine

The Typst compiler (~21 MB of WebAssembly) is downloaded once and cached
in the plugin folder. The emitter does not merely translate the style
sheet: it reproduces **Chromium's typesetting model**, measured against
real PDFs — down to 1/64 px layout units, baseline rounding and
justification distribution. On reference documents of 400+ lines the
maximum measured deviation is **0.02 pt**. The model is documented in
[`docs/paridad-chromium.md`](docs/paridad-chromium.md) (Spanish).

Fonts: system fonts on desktop (indexed once, cached). On mobile neither
iOS nor Android lets an app read system font files, so the plugin
downloads a fallback set (Tinos, Arimo, Cousine — metric-compatible with
Times New Roman, Arial and Courier New); for output identical to the
desktop, copy your own `.ttf`/`.otf`/`.ttc` files into a vault folder
(default `Tipografías`).

## Mobile (iOS / Android)

Same engine, same output. The first export downloads the compiler
(~21 MB, checked against its SHA-256) and the fallback fonts (~4 MB); the
command **«Preparar para usar sin conexión»** fetches both up front so the
plugin never needs the network again. Full instructions (BRAT or manual
install, fonts, performance, limits) in
**[`docs/movil.md`](docs/movil.md)** (Spanish).

## Install

Manual, until it lands in the community catalog: copy `main.js`,
`manifest.json`, `styles.css` (and optionally `typst.wasm`) from the
[latest release](../../releases) into
`YOUR_VAULT/.obsidian/plugins/ulysses-export/`, then enable it.

## Examples

See [`ejemplos/`](ejemplos/): one sample note exported with two different
Ulysses styles (source `.md` + resulting PDFs).

## Development

```bash
npm install
npm run build     # bundle to dist/
npm test          # unit tests
node scripts/exportar.mjs note.md style.ulss out.pdf
```

## License

[MIT](LICENSE). Typst is Apache-2.0 ([typst/typst](https://github.com/typst/typst)),
WebAssembly build by [typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
(Apache-2.0). See [`THIRD-PARTY.md`](THIRD-PARTY.md).

The plugin UI is currently in Spanish; translations welcome.
