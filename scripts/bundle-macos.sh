#!/bin/sh
set -eu

figureit_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
figureit_builder_root=$(CDPATH= cd -- && pwd)
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$figureit_root=/figureit --remap-path-prefix=$figureit_builder_root=/build"

pnpm exec tauri build --config src-tauri/tauri.bundle.conf.json
