#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
extension_id=${ANUBIS_FAST_EXTENSION_ID:-anubis-fast@slaughter.pro}
host_dir=${HOME}/.mozilla/native-messaging-hosts
mkdir -p "$host_dir"

if command -v go >/dev/null 2>&1; then
  go build -o "$root/anubis-fast-host" "$root/native"
else
  nix develop "$root/../anubis-fetch" --command go build -o "$root/anubis-fast-host" "$root/native"
fi

cat > "$host_dir/anubis_fast.json" <<EOF
{
  "name": "anubis_fast",
  "description": "Native Anubis proof-of-work bridge",
  "path": "$root/anubis-fast-host",
  "type": "stdio",
  "allowed_extensions": ["$extension_id"]
}
EOF

printf 'Installed %s for Firefox extension %s\n' "$host_dir/anubis_fast.json" "$extension_id"
