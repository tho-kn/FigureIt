# FigureIt

FigureIt is a privacy-conscious desktop editor for TikZ figures. It combines direct manipulation—move, resize, rotate, style, group, lock, hide, and reorder objects—with an editable TikZ source view, local undo/redo, Git-backed project history, and an optional Claude design assistant.

> Early alpha: FigureIt intentionally edits a useful TikZ subset. Unsupported statements remain in the source as locked raw segments instead of being discarded.

## What works

- Native SVG artboard with direct object manipulation and numeric inspector controls
- Rectangle, ellipse, line/path, text/math, image, and connector scene objects
- Photoshop-style nested layer tree with grouping, visibility, locking, and ordering
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

FigureIt currently recognizes generated `\draw` rectangles, ellipses, lines, arrow connectors and polyline paths; `\node` text/math; `\includegraphics` image nodes; and nested `scope` groups with translate/rotate/scale transforms. FigureIt metadata comments keep stable object IDs and editor-only state.

More complex TikZ remains visible in Source and is retained as raw content. It cannot be moved on the artboard until it is expressed using the supported subset.

## Development

Requirements:

- macOS on Apple silicon (current packaged target)
- Node.js 24 and pnpm 10
- Stable Rust and the platform prerequisites for Tauri 2
- Optional: Claude Code installed and authenticated for Assistant

```sh
pnpm install
pnpm fetch:tectonic
pnpm tauri dev
```

`pnpm fetch:tectonic` downloads Tectonic 0.17.0 from its official GitHub release, verifies the pinned SHA-256 digest, and places the ignored sidecar where the release bundler expects it. The executable is not committed to this repository. Development builds use a system `tectonic` when available; create the macOS release bundle with `pnpm bundle` after fetching the sidecar.

Run the checks with:

```sh
pnpm check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
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
