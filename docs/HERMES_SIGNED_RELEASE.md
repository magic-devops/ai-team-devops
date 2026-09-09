# Hermes Signed Release Pipeline

Hermes release packaging is opt-in and fail-closed. The default package command still creates an unsigned development runtime bundle. A signed release requires `HERMES_RELEASE=1`, the fixed product version `1.0.0`, a release-manifest signing key pair, and the platform signing tools and credentials for the requested package type.

CI preflight selects only compatible platforms for DMG, MSIX, deb, or AppImage.
`auto`, `dmg`, and `windows` workflow choices require `full` mode before any build
starts. Portable builds may use either mode. Install build/signing dependencies
with `python -m pip install -e 'packages/hermes-core[build,test]'`.

## Trust Model

Every release artifact has two verification layers:

- `hermes-manifest.json` records every installed file, POSIX mode, size, SHA-256, symlink target, product, version, platform, architecture, and package mode.
- `*.hermes-release.json` is an Ed25519 signed envelope over the artifact name, artifact size, artifact SHA-256, bundle manifest SHA-256, product, version, platform, architecture, mode, publisher, and key id.

Install and update commands verify the trusted public key, signature, size, hash, architecture, platform, and version before extraction. Updates require an existing valid install manifest, extract to a staging directory, swap only after verification, and restore the previous install if the swap fails.

The local Ed25519 round trip proves Hermes release-manifest cryptography. It is not Apple notarization, Microsoft Authenticode, or Linux distribution trust. When platform signing credentials are absent, the packaging command reports that platform signing was skipped and does not make a trusted platform-signature claim.

## Required Environment

Common signed release variables:

```bash
export HERMES_RELEASE=1
export HERMES_RELEASE_PRIVATE_KEY=/secure/hermes-release-ed25519.pem
export HERMES_RELEASE_PUBLIC_KEY=/secure/hermes-release-ed25519.pub.pem
export HERMES_RELEASE_PUBLISHER="Your Organization ReleaseOps"
```

Generate an ephemeral key only for local cryptographic tests:

```bash
python scripts/hermes-distribution.py keygen \
  --private-key /tmp/hermes-release-private.pem \
  --public-key /tmp/hermes-release-public.pem
```

macOS DMG release variables:

```bash
# CI imports this base64 P12 into an ephemeral keychain before running the release script.
export HERMES_MACOS_P12_BASE64='base64-p12-from-secret-store'
export HERMES_MACOS_P12_PASSWORD='from-secret-store'

# Local runs may instead pre-import the certificate into a private keychain and provide the identity.
export HERMES_MACOS_CODESIGN_IDENTITY="Developer ID Application: Your Organization (TEAMID)"
export HERMES_MACOS_ENTITLEMENTS=apps/hermes-client/macos/Runner/Release.entitlements
export HERMES_NOTARY_APPLE_ID="release@example.com"
export HERMES_NOTARY_TEAM_ID="TEAMID"
export HERMES_NOTARY_PASSWORD="@keychain:AC_PASSWORD"
```

CI imports `HERMES_MACOS_P12_BASE64` into an ephemeral keychain, signs nested binaries and bundles explicitly without `codesign --deep`, signs the outer `Hermes.app` with hardened runtime and entitlements, submits the DMG to Apple notarization, staples the ticket, validates it, and deletes the temporary keychain.

Windows MSIX/AppX release variables:

```bash
export HERMES_WINDOWS_PFX='C:\secure\HermesRelease.pfx'
export HERMES_WINDOWS_PFX_PASSWORD='from-secret-store'
export HERMES_WINDOWS_PUBLISHER='CN=Your Organization'
export HERMES_WINDOWS_PUBLISHER_DISPLAY_NAME='Your Organization'
export HERMES_WINDOWS_PACKAGE_NAME='YourOrg.Hermes'
export HERMES_WINDOWS_TIMESTAMP_URL='http://timestamp.digicert.com'
```

Windows packaging requires `--mode full`. The release script builds an MSIX from the verified stage with `MakeAppx`, using the staged Flutter `Hermes/hermes_client.exe`, existing runtime assets, the project icon asset, and a generated full-trust desktop manifest. It then signs that MSIX with SignTool. It no longer accepts `HERMES_WINDOWS_PACKAGE_PATH`; pointing a secret at a prebuilt package would bypass the verified stage.

Linux `.deb` / AppImage variables:

```bash
export HERMES_LINUX_GPG_KEY_ID="release-key-id"
export HERMES_LINUX_CHECKSUM_SIGNER="openssl"
export HERMES_LINUX_OPENSSL_PRIVATE_KEY=/secure/hermes-linux-checksum.pem
export HERMES_LINUX_OPENSSL_PUBLIC_KEY=/secure/hermes-linux-checksum.pub.pem
```

Linux `.deb` and AppImage packages are built from a temporary package root under the output directory. The `.deb` includes a desktop launcher and icon under `/usr/share`; AppImage uses the staged Flutter launcher for `--mode full` and the core launcher only for `--mode core-only`. The script always writes a checksum file. Checksum signing is performed only when `HERMES_LINUX_CHECKSUM_SIGNER` and the matching key material are configured. AppImage embedded signing is performed only when `HERMES_LINUX_APPIMAGE_SIGN=1`.

To use minisign instead of OpenSSL:

```bash
export HERMES_LINUX_CHECKSUM_SIGNER="minisign"
export HERMES_LINUX_MINISIGN_SECRET_KEY=/secure/minisign.key
export HERMES_LINUX_MINISIGN_PUBLIC_KEY="RWQ..."
```

## Build Commands

Unsigned development bundle:

```bash
bash scripts/hermes-package.sh --core-only
```

Signed portable release manifest over the verified tar bundle:

```bash
HERMES_RELEASE=1 bash scripts/hermes-package.sh --core-only --release-package portable
```

Signed macOS DMG:

```bash
HERMES_RELEASE=1 bash scripts/hermes-package.sh --full --release-package dmg
```

Signed Linux `.deb`:

```bash
HERMES_RELEASE=1 bash scripts/hermes-package.sh --core-only --release-package deb
```

Linux AppImage with a Hermes signed release manifest:

```bash
HERMES_RELEASE=1 bash scripts/hermes-package.sh --core-only --release-package appimage
```

Signed Windows MSIX:

```bash
HERMES_RELEASE=1 bash scripts/hermes-package.sh --full --release-package windows
```

Linux package commands write `*.sha256` and may sign that checksum with OpenSSL or minisign, then the Hermes release manifest signs the package hash again with the release Ed25519 key. Windows builds the MSIX from the verified stage before signing.

## Install And Update

Verify a signed release:

```bash
python scripts/hermes-distribution.py verify-release \
  --archive dist/hermes-1.0.0-linux-x64-core-only.tar.gz \
  --release-manifest dist/hermes-1.0.0-linux-x64-core-only.tar.gz.hermes-release.json \
  --public-key /secure/hermes-release-ed25519.pub.pem \
  --platform linux \
  --arch x64 \
  --version 1.0.0
```

Signed install to a new destination:

```bash
python scripts/hermes-distribution.py signed-install \
  --archive dist/hermes-1.0.0-linux-x64-core-only.tar.gz \
  --release-manifest dist/hermes-1.0.0-linux-x64-core-only.tar.gz.hermes-release.json \
  --public-key /secure/hermes-release-ed25519.pub.pem \
  --dest /opt/hermes \
  --platform linux \
  --arch x64 \
  --version 1.0.0
```

Explicit same-version repair with a retained rollback backup (product remains 1.0.0):

```bash
python scripts/hermes-distribution.py signed-update \
  --archive dist/hermes-1.0.0-linux-x64-core-only.tar.gz \
  --release-manifest dist/hermes-1.0.0-linux-x64-core-only.tar.gz.hermes-release.json \
  --public-key /secure/hermes-release-ed25519.pub.pem \
  --dest /opt/hermes \
  --platform linux \
  --arch x64 \
  --version 1.0.0 \
  --allow-same-version \
  --keep-backup
```

## CI

`.github/workflows/hermes-release.yml` is manual-only. It builds Hermes core, tests the Go agent runtime, verifies the distribution tests, builds the Flutter client for `full` mode, packages a runtime bundle, and uploads only verified artifacts.

If release signing secrets are configured, CI writes them to runner-temporary files with restrictive permissions, imports the macOS P12 into an ephemeral keychain when needed, runs the same release package command, and removes temporary key files/keychains in a trap. If release signing secrets are absent, CI still produces verified unsigned runtime artifacts but does not create a signed release claim. There is no auto-publish step.

## External Release Gaps

These remain intentionally outside local automation unless the real credentials and platform tooling are available:

- Apple Developer ID certificate, notary service credentials, notarization ticket, and stapled DMG validation.
- Microsoft MSIX/AppX package creation policy, Publisher manifest identity, PFX or cloud signing certificate, timestamp service, and SignTool verification.
- Linux GPG trust distribution for `.deb` or AppImage signatures.
- CDN, package registry, app store, or update-feed publication.

## References

- Apple notarization CLI: `xcrun notarytool submit --wait` and `xcrun stapler`.
- Microsoft MSIX/AppX signing: `signtool sign /fd SHA256 ... <package.msix>`.
- Debian archive signatures: `dpkg-sig --sign builder <package.deb>`.
- AppImage signatures: `appimagetool <AppDir> <AppImage> --sign`.
