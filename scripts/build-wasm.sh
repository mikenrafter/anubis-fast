#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$root_dir/extension/solvers"
mkdir -p "$out_dir"

# Reproducible output: the same Go version gives the same bytes from a git
# checkout or an unpacked source archive. Without -buildvcs=false, Go stamps
# the commit and a "dirty" flag into the binary; CGO_ENABLED is recorded too,
# and its default depends on whether a C compiler is on PATH.
CGO_ENABLED=0 GOOS=js GOARCH=wasm go build -trimpath -buildvcs=false -o "$out_dir/anubis-solver.wasm" "$root_dir/wasm"
goroot="$(go env GOROOT)"
runtime="$goroot/lib/wasm/wasm_exec.js"
if [[ ! -f "$runtime" ]]; then
	 runtime="$goroot/misc/wasm/wasm_exec.js"
fi
rm -f "$out_dir/wasm_exec.js"
cp "$runtime" "$out_dir/wasm_exec.js"
