#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root_dir/extension/solvers"
mkdir -p "$out_dir"

GOOS=js GOARCH=wasm go build -trimpath -o "$out_dir/anubis-solver.wasm" "$root_dir/wasm"
goroot="$(go env GOROOT)"
runtime="$goroot/lib/wasm/wasm_exec.js"
if [[ ! -f "$runtime" ]]; then
	 runtime="$goroot/misc/wasm/wasm_exec.js"
fi
rm -f "$out_dir/wasm_exec.js"
cp "$runtime" "$out_dir/wasm_exec.js"
