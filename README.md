# anubis-fast

Firefox extension and native host for using the local `anubis-fetch` Go
binary to clear proof-of-work pages.

The extension detects an Anubis challenge in the active tab by looking for the
`<script id="anubis_challenge" type="application/json">` marker. It also
recognizes Anubis deny/interstitial pages by the `anubis_version` marker and
the `/.within.website/` path. Detection starts at `document_start` and watches
DOM mutations so Anubis's own solver does not win the race.

It extracts the challenge JSON, browser User-Agent, and verification cookie
from the challenge page. When the native host is available, those values go
over Firefox Native Messaging to the Go solver. The host returns the solved
cookies, which the extension installs before navigating normally.

If the native host is unavailable, the extension falls back to its packaged
first-party Go/WASM solver, then to a first-party JavaScript Web Crypto
solver. The browser solver submits Anubis' pass-challenge URL directly so the
browser receives the auth cookie itself. No challenge data or cookies leave
the extension/browser except for the local native helper path.

The content script logs to the protected page's DevTools console. The
background script logs to Firefox's Browser Console (`Ctrl+Shift+J`).

The browser code does not know how Anubis solves its challenge. A provider
registry separates detection and page replacement from the protocol used by a
specific challenge family. Add a provider under `native/providers/` and a
detector under `extension/providers/` for another family such as Cloudflare.

## Layout

```text
extension/       Firefox WebExtension
wasm/             First-party Go/WASM solver source
native/          Go native-messaging host
native/providers provider dispatch and PoW adapters
```

## Nix installation

The flake packages the native host and pins your fork of `anubis-fetch` into
the wrapper environment. The Home Manager module also writes Firefox's
native-messaging manifest.

In a Home Manager import:

```nix
inputs.anubis-fast.homeModules.default

programs.anubis-fast.enable = true;
```

The generated host always invokes the forked `anubis-fetch` package. The
shell installer below remains useful for temporary development outside Nix.

## Build

Build the host with the Go toolchain used by `../anubis-fetch`:

```sh
go build -o anubis-fast-host ./native
```

The host finds `anubis-fetch` in this order:

1. `ANUBIS_FETCH_BIN`
2. `../anubis-fetch/result/bin/anubis-fetch`
3. `anubis-fetch` on `PATH`

The upstream project must be built first if the result path does not exist.

## Install for Firefox development

Register the native host for the Firefox profile in use:

```sh
./install-native-host.sh
```

Then open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, and select the generated XPI or `extension/manifest.json`.

By default the native host only accepts requests from the extension ID
`anubis-fast@mikenrafter`. Set `ANUBIS_FAST_EXTENSION_ID` before running the
installer if you use another ID.

For the local `slaughter.pro` stack, start the site from its checkout and
open `http://localhost:8080/` through the Anubis front door.

## Protocol

Native Messaging frames are Firefox's standard 32-bit little-endian length
prefix followed by UTF-8 JSON. Request and response bodies are base64 encoded
so arbitrary HTML cannot corrupt the JSON frame.

```json
{"id":"...","provider":"anubis","type":"fetch","url":"https://example.test/","cookie":"anubis-auth=...; cf_clearance=..."}
```

```json
{"id":"...","ok":true,"provider":"anubis","status":200,"content_type":"text/html","body_base64":"..."}
```

The provider field is intentionally explicit. A future Cloudflare adapter can
use the same transport without adding Cloudflare logic to the Anubis code.

## Solver backends

The extension prefers the native backend for speed. Its portable fallback is
deliberately maintained in this repository rather than imported from a third
party: `wasm/main.go` is compiled into `extension/solvers/anubis-solver.wasm`
by `npm run build:solver`, and `extension/solvers/javascript.js` is the final
Web Crypto fallback. Both implement Anubis' `sha256(randomData + decimal
nonce)` verifier directly.

The manifest declares `websiteActivity` and `websiteContent` because the
extension handles challenge pages, URLs, and cookies locally and may pass
those values to the locally installed native helper. It does not send
telemetry to a remote service.
