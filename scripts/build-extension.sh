#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
build_dir="$root_dir/build/extension"

rm -rf "$build_dir"
mkdir -p "$build_dir"

npx tsc --noEmit false --outDir "$build_dir" --rootDir "$root_dir/extension"
cp "$root_dir/extension/manifest.json" "$build_dir/manifest.json"
cp "$root_dir/extension/icon.svg" "$build_dir/icon.svg"
cp "$root_dir/extension/solvers/wasm_exec.js" "$build_dir/solvers/wasm_exec.js"
cp "$root_dir/extension/solvers/anubis-solver.wasm" "$build_dir/solvers/anubis-solver.wasm"

if [[ "${1:-}" == "--check" ]]; then
  test -f "$build_dir/background.js"
  test -f "$build_dir/content.js"
fi
