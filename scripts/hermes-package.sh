#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${ROOT}/.venv/bin/python}"
PYTHON_BIN="$(command -v "${PYTHON_BIN}" || true)"
FLUTTER_BIN="${FLUTTER_BIN:-$(command -v flutter || true)}"
PACKAGE_MODE="full"
FLUTTER_BUNDLE="${HERMES_FLUTTER_BUNDLE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core-only)
      PACKAGE_MODE="core-only"
      shift
      ;;
    --full)
      PACKAGE_MODE="full"
      shift
      ;;
    --flutter-bundle)
      FLUTTER_BUNDLE="${2:?--flutter-bundle requires a path}"
      shift 2
      ;;
    -h|--help)
      echo "usage: bash scripts/hermes-package.sh [--core-only|--full] [--flutter-bundle PATH]" >&2
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

RAW_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
RAW_ARCH="$(uname -m | tr '[:upper:]' '[:lower:]')"

case "${RAW_OS}" in
  darwin) HOST_OS="macos" ;;
  linux) HOST_OS="linux" ;;
  mingw*|msys*|cygwin*) HOST_OS="windows" ;;
  *) HOST_OS="${RAW_OS}" ;;
esac

case "${RAW_ARCH}" in
  arm64|aarch64) HOST_ARCH="arm64" ;;
  x86_64|amd64) HOST_ARCH="x64" ;;
  *) HOST_ARCH="${RAW_ARCH}" ;;
esac

HOST_NAME="${HOST_OS}-${HOST_ARCH}"
EXE_EXT=""
if [[ "${HOST_OS}" == "windows" ]]; then
  EXE_EXT=".exe"
fi

DIST_ROOT="${ROOT}/dist/hermes-v5"
BUILD_ROOT="${DIST_ROOT}/.build/${HOST_NAME}"
PYI_DIST="${BUILD_ROOT}/pyinstaller-dist"
PYI_WORK="${BUILD_ROOT}/pyinstaller-work"
PYI_CACHE="${BUILD_ROOT}/pyinstaller-cache"
CORE_BUILD="${PYI_DIST}/hermes-core"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime unavailable: ${PYTHON_BIN}" >&2
  exit 2
fi

if [[ "${PACKAGE_MODE}" == "full" ]]; then
  if [[ -z "${FLUTTER_BUNDLE}" ]]; then
  if [[ ! -x "${FLUTTER_BIN}" ]]; then
    echo "flutter unavailable; full package failed honestly. Use --core-only for core/agentd packaging." >&2
    exit 2
  fi
  if [[ ! -f "${ROOT}/apps/hermes-client/pubspec.yaml" ]]; then
    echo "apps/hermes-client missing; full package failed honestly. Use --core-only for core/agentd packaging." >&2
    exit 2
  fi
    if [[ "${HOST_OS}" == "macos" ]]; then
      xcrun --find xcodebuild >/dev/null
    fi
    (cd "${ROOT}/apps/hermes-client"; "${FLUTTER_BIN}" build "${HOST_OS}" --release)
    case "${HOST_OS}" in
      macos) FLUTTER_BUNDLE="${ROOT}/apps/hermes-client/build/macos/Build/Products/Release/hermes_client.app" ;;
      linux) FLUTTER_BUNDLE="${ROOT}/apps/hermes-client/build/linux/${HOST_ARCH}/release/bundle" ;;
      windows) FLUTTER_BUNDLE="${ROOT}/apps/hermes-client/build/windows/${HOST_ARCH}/runner/Release" ;;
      *) echo "unsupported desktop host" >&2; exit 2 ;;
    esac
  fi
  if [[ "${HOST_OS}" == "macos" ]]; then
    if [[ ! -f "${FLUTTER_BUNDLE}/Contents/Info.plist" || ! -x "${FLUTTER_BUNDLE}/Contents/MacOS/hermes_client" ]]; then
      echo "invalid Flutter macOS bundle: ${FLUTTER_BUNDLE}" >&2
      exit 2
    fi
  else
    if [[ ! -f "${FLUTTER_BUNDLE}/hermes_client${EXE_EXT}" ]]; then
      echo "Flutter executable missing in bundle: ${FLUTTER_BUNDLE}" >&2
      exit 2
    fi
  fi
fi

if [[ "${HERMES_RELEASE:-0}" == "1" ]]; then
  echo "Signed installer distribution is not implemented by this development bundler; release refused." >&2
  exit 4
fi

if ! "${PYTHON_BIN}" -c 'import PyInstaller' >/dev/null 2>&1; then
  echo "pyinstaller unavailable in ${PYTHON_BIN}; core package build failed honestly" >&2
  exit 2
fi

mkdir -p "${DIST_ROOT}" "${BUILD_ROOT}"
DIST="$(mktemp -d "${DIST_ROOT}/${HOST_NAME}-${PACKAGE_MODE}.XXXXXX")"
BUNDLE_ROOT="${DIST}/HermesV5"
if [[ "${PACKAGE_MODE}" == "full" ]]; then
  if [[ "${HOST_OS}" == "macos" ]]; then
    cp -R "${FLUTTER_BUNDLE}" "${DIST}/HermesV5.app"
    BUNDLE_ROOT="${DIST}/HermesV5.app/Contents/Resources"
  else
    mkdir -p "${BUNDLE_ROOT}"
    cp -R "${FLUTTER_BUNDLE}/." "${BUNDLE_ROOT}/"
  fi
fi
RUNTIME_ROOT="${BUNDLE_ROOT}/runtime"
CORE_RUNTIME="${RUNTIME_ROOT}/hermes-core"
AGENTD_RUNTIME="${RUNTIME_ROOT}/agentd"
CORE_BIN="${CORE_RUNTIME}/hermes-core${EXE_EXT}"
AGENTD_BIN="${AGENTD_RUNTIME}/sop-agentd${EXE_EXT}"
mkdir -p "${CORE_RUNTIME}" "${AGENTD_RUNTIME}"

rm -rf "${PYI_DIST}" "${PYI_WORK}" "${CORE_RUNTIME}"
mkdir -p "${CORE_RUNTIME}"

(
  cd "${ROOT}"
  PYINSTALLER_CONFIG_DIR="${PYI_CACHE}" "${PYTHON_BIN}" -m PyInstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name hermes-core \
    --paths "${ROOT}/packages/hermes-core" \
    --collect-all langgraph \
    --collect-all langgraph_sdk \
    --hidden-import langgraph.checkpoint.sqlite \
    --hidden-import aiosqlite \
    --distpath "${PYI_DIST}" \
    --workpath "${PYI_WORK}" \
    --specpath "${BUILD_ROOT}" \
    scripts/hermes-frozen-entry.py
)

if [[ ! -x "${CORE_BUILD}/hermes-core${EXE_EXT}" ]]; then
  echo "frozen hermes-core binary missing: ${CORE_BUILD}/hermes-core${EXE_EXT}" >&2
  exit 2
fi
cp -R "${CORE_BUILD}/." "${CORE_RUNTIME}/"

if command -v go >/dev/null 2>&1; then
  (
    cd "${ROOT}/apps/agent-runtime"
    GOCACHE="${ROOT}/apps/agent-runtime/.sop-runtime/go-cache" go build -o "${AGENTD_BIN}" ./cmd/sop-agentd
  )
else
  echo "go unavailable; agentd build failed honestly" >&2
  exit 2
fi

echo "${PACKAGE_MODE} development bundle staged" >&2
if [[ "${PACKAGE_MODE}" == "full" && "${HOST_OS}" == "macos" ]]; then
  codesign --force --deep --sign - "${DIST}/HermesV5.app"
  codesign --verify --deep --strict "${DIST}/HermesV5.app"
fi

QA_TMP="$(mktemp -d "${TMPDIR:-/tmp}/hermes-package-qa.XXXXXX")"
CORE_PID=""
cleanup() {
  status=$?
  if [[ ${status} -ne 0 && -f "${QA_TMP}/core.stderr" ]]; then
    tail -n 30 "${QA_TMP}/core.stderr" >&2
  fi
  if [[ -n "${CORE_PID}" ]] && kill -0 "${CORE_PID}" >/dev/null 2>&1; then
    kill "${CORE_PID}" >/dev/null 2>&1 || true
    wait "${CORE_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${QA_TMP}"
}
trap cleanup EXIT

QA_DATA="${QA_TMP}/data"
QA_WORKSPACE="${QA_TMP}/workspace"
QA_TOKEN="${QA_TMP}/token"
QA_READY="${QA_TMP}/ready.json"
mkdir -p "${QA_DATA}" "${QA_WORKSPACE}"

(
  cd "${QA_TMP}"
  exec env -u PYTHONPATH "${CORE_BIN}" --data-dir "${QA_DATA}" --token-file "${QA_TOKEN}" --port 0 --agentd "${AGENTD_BIN}" >"${QA_READY}" 2>"${QA_TMP}/core.stderr"
) &
CORE_PID=$!

"${PYTHON_BIN}" - "${QA_READY}" "${QA_TOKEN}" "${QA_WORKSPACE}" <<'PY'
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ready_path = Path(sys.argv[1])
token_path = Path(sys.argv[2])
workspace_root = Path(sys.argv[3])

deadline = time.time() + 30
ready = None
while time.time() < deadline:
    if ready_path.exists() and ready_path.stat().st_size:
        ready = json.loads(ready_path.read_text())
        break
    time.sleep(0.25)
if not ready:
    raise SystemExit("frozen hermes-core did not publish startup JSON")

token = token_path.read_text().strip()
base = ready["url"]

def request(method: str, path: str, body: dict | None = None, workspace_id: str = "") -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    if workspace_id:
        req.add_header("X-Workspace-Id", workspace_id)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} failed: {exc.code} {exc.read().decode()[:500]}") from exc

while True:
    try:
        health = json.loads(urllib.request.urlopen(base + "/api/v2/health", timeout=2).read())
        break
    except (OSError, urllib.error.URLError):
        if time.time() >= deadline:
            raise
        time.sleep(0.1)
if health.get("ok") is not True or health.get("service") != "hermes-core":
    raise SystemExit(f"unexpected health response: {health}")

workspace = request("POST", "/api/v2/workspaces", {
    "data": {"name": "Package QA", "root": str(workspace_root)},
    "idempotency_key": "package-qa-workspace",
})
workspace_id = workspace["items"][0]["id"]
runs = request("GET", "/api/v2/runs", workspace_id=workspace_id)
required = {"ok", "scope", "summary", "items", "actions", "permissions", "audit", "trace_id", "agent_consumption", "cli"}
missing = required.difference(runs)
if missing:
    raise SystemExit(f"workspace API response missing keys: {sorted(missing)}")

run = request("POST", "/api/v2/runs", {
    "data": {"title": "Frozen execution QA", "nodes": [{"id": "list", "title": "List files", "kind": "command", "argv": ["workspace-file-list"], "timeout_seconds": 10}]},
    "idempotency_key": "package-run",
}, workspace_id)["items"][0]
request("POST", f"/api/v2/runs/{run['id']}/start", {
    "idempotency_key": "package-start", "expected_version": run["version"], "dry_run": False,
}, workspace_id)
deadline = time.time() + 20
while time.time() < deadline:
    run = request("GET", f"/api/v2/runs/{run['id']}", workspace_id=workspace_id)["items"][0]
    if run["status"] in {"completed", "failed"}:
        break
    time.sleep(0.1)
if run["status"] != "completed" or run["data"]["node_results"]["list"]["exit_code"] != 0:
    raise SystemExit(f"frozen execution failed: {run}")

print(json.dumps({
    "health": {"ok": health["ok"], "service": health["service"], "version": health.get("version")},
    "workspace_id": workspace_id,
    "execution": "completed",
    "runs_envelope_keys": sorted(runs.keys()),
}, sort_keys=True))
PY

mkdir -p "${ROOT}/dist"
ARCHIVE="${ROOT}/dist/hermes-v5-${HOST_NAME}-${PACKAGE_MODE}.tar.gz"
tar -C "${DIST}" -czf "${ARCHIVE}.tmp" .
mv "${ARCHIVE}.tmp" "${ARCHIVE}"

echo "installer/image packaging is out of scope for this script; produced tar runtime bundle only" >&2

echo "unsigned development artifact; no signed release claim" >&2

echo "packaged ${HOST_NAME} ${PACKAGE_MODE}: ${CORE_BIN}, ${AGENTD_BIN}, ${ARCHIVE}"
