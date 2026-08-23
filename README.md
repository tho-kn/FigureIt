# FigureIt

FigureIt is a privacy-conscious desktop editor for TikZ figures. It combines direct manipulation—move, resize, rotate, style, group, lock, hide, and reorder objects—with an editable TikZ source view, local undo/redo, Git-backed project history, and an optional Claude design assistant.

> Early alpha: FigureIt intentionally edits a useful TikZ subset. Unsupported statements remain in the source as locked raw segments instead of being discarded.

## See it in action

### Visual editing with synchronized TikZ

![FigureIt visual editor showing named layers, connected shapes, resize handles, gradient controls, and synchronized TikZ source](docs/images/figureit-editor.png)

Select and reshape objects directly on the SVG canvas while Layers, Inspector, and TikZ source stay synchronized.

### Customizable keyboard shortcuts

![FigureIt keyboard shortcut editor over the visual canvas](docs/images/figureit-shortcuts.png)

Open **Window → Keyboard shortcuts** to remap tool keys or restore the defaults. During a line or connector drag, hold `Ctrl` to bypass snapping temporarily.

## What works

- **Direct Visual Canvas**: Native SVG artboard with live drag, resize, rotate, endpoint reshaping, smart alignment and 15-degree line snapping, a temporary `Ctrl` snap bypass, and numeric inspector controls.
- **Rich Shapes & Primitives**: Rectangle, rounded rectangle, ellipse, triangle, diamond, text/math, image, line, arrow, pen path, and smart connectors.
- **Smart Orthogonal & Curved Connectors**: Shape-to-shape connectors with magnetic snap sites, persistent bindings, straight/elbow (`-|`, `|-`)/curved Bézier routing, waypoint management, and arrow ends.
- **Universal Shape Line Patterns**: Solid, dashed (`---`), and dotted (`···`) border strokes on all primitive shapes as well as lines and connectors.
- **In-Place Live Text Editing & Multi-Line Typography**: Double-click any shape or text box to edit text in-place without ghosting; multi-line text with `\\` and `align=center|left|right`; rich typography toolbar for font family (Modern Sans, LaTeX Serif, Monospace Code), font size ($6\dots96\text{pt}$), bold (`\textbf`), italic (`\textit`), strikethrough (`\sout`), math mode (`$...$`), and horizontal/vertical alignments.
- **Project and standalone `.tex` workflows**: **Open project** restores a FigureIt folder with its local Git history, while **Open .tex** and canvas drag-and-drop import `.tex`, `.tikz`, and `.latex` files without fabricating a project. `Cmd+O` opens a project on desktop and a standalone file on browser/mobile; `Cmd+S` exports the current source.
- **PPTX & PDF import**: Dropping or opening a `.pptx` file converts slide shapes, text boxes, embedded images, connectors, and theme colors into editable scene objects grouped per slide; a `.pdf` file imports each page as a high-resolution image object placed on the artboard. Both require a project (embedded media becomes project assets) and are isolated in a dedicated importer module that loads only when an import runs.
- **Custom Artboard Sizing**: Standard presets (16:9, IEEE column, Square, Banner) plus direct manual pixel width and height inputs with live centimeter readouts and a **Fit width (cm)** control that scales the whole figure to a paper column width.
- **Academic Figure Extras**: Dimension annotations (`|-|` measure lines with editable length labels), PNG export at 300/600 dpi for journals that require raster, and a compile wrapper that loads the TikZ libraries papers rely on (`patterns`, `decorations.pathreplacing`, `decorations.markings`, `fit`, `backgrounds`, `angles`, `quotes`, `arrows`, `intersections`).
- **Layer & Multi-Selection Tools**: Marquee selection, collective proportional resize and rotation, layer tree with grouping, visibility, reversible locking, reordering, duplication, opacity, fill/stroke palette, gradients, and align/distribute actions.
- **Git Checkpoints & Undo/Redo**: Transactional undo/redo (`Cmd+Z` / `Cmd+Shift+Z`) plus automatic local Git checkpoints per figure project.
- **Keyboard Controls**: Hover labels show each tool's shortcut, and **Window → Keyboard shortcuts** lets you remap the tool keys locally or reset them to the defaults.
- **Authoritative TikZ Source & Compilation**: Split TikZ source view with parse-before-apply behavior, SVG export, and authoritative zero-error vector PDF compilation with embedded Tectonic.
- **Optional Claude Design Assistant**: Attached conversation that receives a sanitized scene snapshot and returns approval-gated scene operations — including **inserting new shapes** — with an in-app auth check and **Log in to Claude** button that opens the `claude login` browser flow.
- **Lossless Raw Statements**: Preserves unsupported TikZ macros and raw comments adjacent to supported objects.

## Privacy model

FigureIt keeps project locations behind opaque runtime handles. Host paths, environment variables, credentials, process output, and local Git details are not included in browser-facing project records or Claude scene payloads. Image references stay project-relative and are omitted from the Claude payload. The repository also runs a privacy scan over source and production bundles.

No telemetry is included. Two actions can use the network:

- Tectonic downloads its TeX bundle on first use and caches it for later compilation.
- Claude receives the visible scene structure/text and the request only after you click **Request suggestion**. Claude has no tools, filesystem access, MCP servers, or shell access inside FigureIt. The attached conversation stays in app memory, is not resumed from a persisted Claude session, and is dropped when the app exits or the process fails. A suggestion cannot edit the figure until you click **Apply suggestion**.

Project history stays in the selected figure folder as a dedicated local Git repository. FigureIt commits only `figure.tikz` and `assets/` with a neutral repository-local identity; it does not configure global Git settings or push figure projects anywhere.

## Supported TikZ subset

FigureIt currently recognizes generated `\draw` rectangles, rounded rectangles, ellipses, triangles, diamonds, lines, arrow connectors, and polyline paths; `\node` text/math; `\includegraphics` image nodes; and nested `scope` groups with translate/rotate/scale transforms. Generated styling includes fill/stroke colours, opacity, linear gradients, line patterns, arrow ends, and connector routing. FigureIt metadata comments keep stable object IDs, bindings, and editor-only state.

More complex TikZ remains visible in Source and is retained as raw content. It cannot be moved on the artboard until it is expressed using the supported subset.

## Development

Requirements:

- Node.js 24 and pnpm 10
- Stable Rust and the platform prerequisites for Tauri 2
- Optional: Claude Code installed and authenticated for Assistant (the Assistant tab checks this and offers a **Log in to Claude** button that opens the `claude login` browser flow)

```sh
pnpm install
pnpm fetch:tectonic
pnpm tauri dev
```

`pnpm fetch:tectonic` downloads Tectonic 0.17.0 from its official GitHub release, verifies the pinned SHA-256 digest, and places the ignored sidecar where the release bundler expects it. The executable is not committed. `pnpm bundle` selects the native sidecar and builds the platform package: a macOS app, Windows NSIS installer, or Linux deb/AppImage.

Desktop packaging targets macOS arm64/x64, Windows x64, and Linux x64. Install the normal [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) first; Linux also needs WebKitGTK 4.1 and the AppIndicator development packages. The CI matrix compiles, tests, and packages all three desktop operating systems.

### Releases

Push an existing semantic version tag such as `v0.3.1` to run the Release workflow. It validates the source, builds macOS arm64/x64, Windows x64, Linux x64, and an Android arm64 preview APK, writes SHA-256 checksums, and creates one draft GitHub Release for final inspection:

```sh
git tag v0.3.1
git push origin v0.3.1
```

The workflow can also be started manually for an existing tag. Publishing the draft remains an explicit maintainer action. Desktop packages are currently unsigned and the Android asset is a debug-signed preview, so these assets are intended for testing until platform signing is configured.

### Android

Android currently provides the manual SVG/source editor with local browser-backed persistence. PDF/Tectonic, Git history, project assets, and Claude are desktop-only and are visibly disabled instead of silently failing on mobile.

After installing Android Studio, SDK, NDK, and an arm64 Rust target:

```sh
pnpm tauri android init
pnpm tauri android dev
# or build an APK
pnpm tauri android build --debug --apk --target aarch64
```

Run the checks with:

```sh
pnpm check
pnpm cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
pnpm cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
pnpm cargo test --manifest-path src-tauri/Cargo.toml
```

## Project layout

```text
src/model/         lossless TikZ scene model and transactions
src/services/      privacy-safe frontend/backend bridge
src-tauri/src/     local persistence, Git, Tectonic, and Claude processes
resources/         runtime-only Claude design skills
scripts/           privacy and pinned dependency helpers
```

Local `AGENTS.md` files provide contributor guidance throughout source folders and are intentionally ignored. Runtime Claude skills are public application resources; no internal development harness, session trace, personal configuration, or local path is committed.

## Status and license

FigureIt is experimental software. Back up important figures and review generated TikZ before publication. No open-source license has been selected yet; copyright remains with the contributors.
