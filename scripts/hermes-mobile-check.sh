#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLUTTER_BIN="${FLUTTER_BIN:-/private/tmp/hermes-flutter/sdk/bin/flutter}"

if [[ ! -x "${FLUTTER_BIN}" ]]; then
  echo '{"ok":false,"items":[{"name":"flutter","status":"unavailable","detail":"flutter not found on PATH"}]}' >&2
  exit 2
fi

(cd "${ROOT}/apps/hermes-client" && "${FLUTTER_BIN}" doctor -v)
(cd "${ROOT}/apps/hermes-client" && "${FLUTTER_BIN}" pub get)
(cd "${ROOT}/apps/hermes-client" && "${FLUTTER_BIN}" build apk --debug)
(cd "${ROOT}/apps/hermes-client" && "${FLUTTER_BIN}" build ios --debug --no-codesign)
