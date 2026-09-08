# Hermes Portable Runtime Installation

Hermes `1.0.0` portable runtime bundles are development tar archives, not native installers. The package manifest records the target platform, architecture, package mode, Hermes API base path, and SHA-256 plus byte size for every staged payload file.

The manifest also records unsigned provenance. SHA-256 proves local file integrity against the manifest; it is not a trusted-publisher signature, notarization, Authenticode signature, or installer signing claim.

## Package

Core-only packaging:

```bash
bash scripts/hermes-package.sh --core-only
```

Full desktop packaging:

```bash
bash scripts/hermes-package.sh --full --flutter-bundle /path/to/hermes_client.app
```

If Flutter, Xcode, PyInstaller, or Go are missing, the package script fails honestly instead of producing a native-build claim. Signed mass installer distribution is still out of scope for this development bundler.

The archive is written under `dist/`, for example:

```text
dist/hermes-1.0.0-macos-arm64-core-only.tar.gz
```

The archive contains `hermes-manifest.json` at archive root. For macOS full bundles the manifest sits outside `Hermes.app`, so manifest generation does not mutate signed app contents.

## Verify

Verify a staged or installed root:

```bash
python scripts/hermes-distribution.py verify \
  --root /path/to/HermesPortableRoot \
  --manifest /path/to/HermesPortableRoot/hermes-manifest.json
```

The command prints JSON and exits nonzero on tampered, missing, unlisted, traversal, or unsupported symlink entries.

## Install

Install to an explicitly supplied new destination:

```bash
python scripts/hermes-distribution.py install \
  --archive dist/hermes-1.0.0-macos-arm64-core-only.tar.gz \
  --dest /opt/hermes-1.0.0-macos-arm64-core-only
```

The destination must not already exist. The installer reserves the destination with a new directory create before extraction, so a concurrently created destination is refused instead of overwritten. Payload files are extracted into a hidden staging directory inside that reserved destination, verified against the manifest, and then published into the reserved destination. If extraction or verification fails, the staging directory is removed and an empty reservation is cleaned up when possible. Existing user files are never overwritten.

Path traversal entries, Windows-style backslash or drive/colon paths, NUL bytes, Windows reserved device components such as `CON`, `PRN`, `AUX`, `NUL`, `COM1` through `COM9`, and `LPT1` through `LPT9` including extension forms like `CON.txt`, trailing dots or spaces, absolute archive paths, duplicate normalized archive paths, setuid/setgid modes, file-or-symlink ancestor conflicts, absolute symlink targets, and symlink targets that escape the install root are rejected. Files and directories are extracted before symlinks, and extraction refuses to write through symlink parents. After extraction or source-copy, every symlink is resolved and rejected if it leaves the install root or forms a resolution cycle. Safe relative symlinks are preserved, which supports normal macOS bundle symlink layouts. Unsupported archive member types and malformed manifests are rejected cleanly with JSON errors and nonzero exit status.

For upgrades or rollback, install each version into a new versioned destination such as `/opt/hermes-1.0.1-macos-arm64-core-only`, switch your launcher or shell profile after verification, and retain previous version directories until rollback is no longer needed. The portable installer performs no destructive auto migration.

## Run The Installed Core

For the verified macOS core-only layout, use a separate user-owned data directory:

```bash
RUNTIME="/path/to/installed-root/Hermes/runtime"
DATA="$HOME/Library/Application Support/Hermes/1.0.0"
"$RUNTIME/hermes-core/hermes-core" \
  --data-dir "$DATA" --token-file "$DATA/token" --port 0 \
  --agentd "$RUNTIME/agentd/sop-agentd"
```

The process emits a startup JSON line containing `url`, `token_file` and `pid`.
Connect the client to that URL and authenticate using the token file; do not paste
the token into logs or issue reports. The frozen Core and agentd do not require
Python or Go on the destination machine. The repository's manifest/install helper
does require Python; it is a developer utility, not a native installer replacement.

Contributor lifecycle verification runs from `apps/hermes-client`:

```bash
dart run tool/runtime_smoke.dart /path/to/installed-root/Hermes/runtime
```

This creates an isolated Chinese-named data directory, verifies diagnostics,
creates a workspace, restarts the owned Core, verifies retained data and stops it.
The temporary test data is removed only after the owned process has exited.
