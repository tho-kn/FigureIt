# FigureIt

FigureIt is a privacy-conscious desktop editor for TikZ figures. It combines direct manipulation—move, resize, rotate, style, group, lock, hide, and reorder objects—with an editable TikZ source view, local undo/redo, Git-backed project history, and an optional Claude design assistant.

> Early alpha: FigureIt intentionally edits a useful TikZ subset. Unsupported statements remain in the source as locked raw segments instead of being discarded.

## What works

- Native SVG artboard with drag, resize, rotate, endpoint reshaping, and numeric inspector controls
- Rectangle, rounded rectangle, ellipse, triangle, diamond, text/math, image, line, arrow, path, and connector objects
- Shape-to-shape connectors with eight snap sites, persistent bindings, straight/elbow/curved routing, arrow ends, and solid/dashed/dotted strokes
- Layer tree with grouping, visibility, reversible locking, ordering, duplication, opacity, stroke/fill, gradients, alignment, and distribution
- Transactional undo/redo plus automatic local Git checkpoints per figure project
- Split TikZ source editing with parse-before-apply behavior
- SVG export and authoritative PDF compilation with Tectonic
- Optional attached Claude Code conversation that receives a sanitized scene snapshot and returns approval-gated scene operations
- Lossless retention of unsupported TikZ statements adjacent to supported objects

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
- Optional: Claude Code installed and authenticated for Assistant

```sh
pnpm install
pnpm fetch:tectonic
pnpm tauri dev
```

`pnpm fetch:tectonic` downloads Tectonic 0.17.0 from its official GitHub release, verifies the pinned SHA-256 digest, and places the ignored sidecar where the release bundler expects it. The executable is not committed. `pnpm bundle` selects the native sidecar and builds the platform package: a macOS app, Windows NSIS installer, or Linux deb/AppImage.

Desktop packaging targets macOS arm64/x64, Windows x64, and Linux x64. Install the normal [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) first; Linux also needs WebKitGTK 4.1 and the AppIndicator development packages. The CI matrix compiles, tests, and packages all three desktop operating systems.

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
