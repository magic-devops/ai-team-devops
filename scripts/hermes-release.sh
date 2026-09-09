#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-${ROOT}/.venv/bin/python}"
PYTHON_BIN="$(command -v "${PYTHON_BIN}" || true)"

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "python runtime unavailable: ${PYTHON_BIN}" >&2
  exit 2
fi

exec "${PYTHON_BIN}" "${ROOT}/scripts/hermes-release.py" "$@"
