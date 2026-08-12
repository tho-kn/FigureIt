#!/bin/sh
set -eu

version=0.17.0
target=aarch64-apple-darwin
archive_name="tectonic-${version}-${target}.tar.gz"
expected=a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667
url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/${archive_name}"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

curl --fail --location --silent --show-error "$url" --output "$temporary/$archive_name"
actual="$(openssl dgst -sha256 "$temporary/$archive_name" | awk '{print $NF}')"
[ "$actual" = "$expected" ] || { printf '%s\n' 'Tectonic checksum mismatch' >&2; exit 1; }
tar -xzf "$temporary/$archive_name" -C "$temporary"
mkdir -p src-tauri/binaries
install -m 755 "$temporary/tectonic" "src-tauri/binaries/tectonic-${target}"
printf '%s\n' "Installed Tectonic ${version} for ${target}."
