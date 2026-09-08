#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${HERMES_DATA_DIR:-${1:-/tmp/hermes-v5}}"
TOKEN_FILE="${HERMES_TOKEN_FILE:-${DATA_DIR}/token}"
PORT="${HERMES_PORT:-0}"
PYTHON_BIN="${PYTHON_BIN:-.venv/bin/python}"

PYTHONPATH="${PYTHONPATH:-}:packages/hermes-core" "${PYTHON_BIN}" -m hermes_core \
  --data-dir "${DATA_DIR}" \
  --token-file "${TOKEN_FILE}" \
  --port "${PORT}"
