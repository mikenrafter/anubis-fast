#!/bin/sh
set -eu

extension_id=${ANUBIS_FAST_EXTENSION_ID:-anubis-fast@mikenrafter}
host_dir=${HOME}/.mozilla/native-messaging-hosts
mkdir -p "$host_dir"

host_path=$(command -v anubis-fast-host || true)
if [ -z "$host_path" ] || [ ! -x "$host_path" ]; then
  printf '%s\n' "error: an executable anubis-fast-host must be available on PATH" >&2
  exit 1
fi

case "$host_path" in
  /*) ;;
  *)
    printf '%s\n' "error: PATH resolved anubis-fast-host to a non-absolute path: $host_path" >&2
    exit 1
    ;;
esac

cat > "$host_dir/anubis_fast.json" <<EOF
{
  "name": "anubis_fast",
  "description": "Native Anubis proof-of-work bridge",
  "path": "$host_path",
  "type": "stdio",
  "allowed_extensions": ["$extension_id"]
}
EOF

printf 'Installed %s for Firefox extension %s\n' "$host_dir/anubis_fast.json" "$extension_id"
