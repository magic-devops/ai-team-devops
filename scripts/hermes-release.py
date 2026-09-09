#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


class ReleaseError(Exception):
    pass


RELEASE_VERSION = "1.0.0"
WINDOWS_NS = "http://schemas.microsoft.com/appx/manifest/foundation/windows10"
UAP_NS = "http://schemas.microsoft.com/appx/manifest/uap/windows10"
RESCAP_NS = "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"


def _run(argv: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    redacted = list(argv)
    for index, arg in enumerate(argv[:-1]):
        if arg.lower() in {"--password", "/p"}:
            redacted[index + 1] = "[REDACTED]"
    print("+ " + " ".join(redacted), file=sys.stderr)
    try:
        subprocess.run(argv, cwd=cwd, env=env, check=True)  # noqa: S603 - explicit release tool argv.
    except subprocess.CalledProcessError as exc:
        raise ReleaseError(f"{Path(argv[0]).name} failed with exit code {exc.returncode}") from None


def _tool(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise ReleaseError(f"required release tool is missing: {name}")
    return found


def _first_tool(*names: str) -> str:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    raise ReleaseError(f"required release tool is missing: {'/'.join(names)}")


def _env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ReleaseError(f"required release environment variable is missing: {name}")
    return value


def _optional_env(name: str) -> str:
    return os.getenv(name, "").strip()


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _validate_args(args: argparse.Namespace) -> None:
    if args.version != RELEASE_VERSION:
        raise ReleaseError(f"Hermes package version is fixed at {RELEASE_VERSION}; got {args.version}")
    native_platform = {"dmg": "macos", "windows": "windows", "deb": "linux", "appimage": "linux"}.get(args.package)
    if native_platform and native_platform != args.platform:
        raise ReleaseError(f"{args.package} packaging requires platform {native_platform}")
    if (args.package in {"dmg", "windows"} or (args.package == "auto" and args.platform in {"macos", "windows"})) and args.mode != "full":
        raise ReleaseError("macOS DMG and Windows MSIX packaging require full mode")
    stage = Path(args.stage)
    archive = Path(args.archive)
    if not stage.is_dir():
        raise ReleaseError(f"release stage is missing: {stage}")
    if not archive.is_file():
        raise ReleaseError(f"portable archive is missing: {archive}")
    if args.platform == "macos" and args.arch not in {"arm64", "x64"}:
        raise ReleaseError("macOS release arch must be arm64 or x64")
    if args.platform == "windows" and args.arch not in {"x64", "arm64"}:
        raise ReleaseError("Windows release arch must be x64 or arm64")
    if args.platform == "linux" and args.arch not in {"x64", "arm64"}:
        raise ReleaseError("Linux release arch must be x64 or arm64")


def _release_manifest_credentials_available() -> bool:
    names = ("HERMES_RELEASE_PRIVATE_KEY", "HERMES_RELEASE_PUBLIC_KEY", "HERMES_RELEASE_PUBLISHER")
    present = [name for name in names if _optional_env(name)]
    if present and len(present) != len(names):
        missing = sorted(set(names) - set(present))
        raise ReleaseError(f"release manifest signing credentials are incomplete: missing {', '.join(missing)}")
    return len(present) == len(names)


def _sign_release_manifest(args: argparse.Namespace, artifact: Path) -> Path:
    root = _root()
    manifest = Path(args.stage) / "hermes-manifest.json"
    release_manifest = Path(args.out_dir) / f"{artifact.name}.hermes-release.json"
    _run(
        [
            sys.executable,
            str(root / "scripts" / "hermes-distribution.py"),
            "sign-release",
            "--archive",
            str(artifact),
            "--manifest",
            str(manifest),
            "--private-key",
            _env("HERMES_RELEASE_PRIVATE_KEY"),
            "--publisher",
            _env("HERMES_RELEASE_PUBLISHER"),
            "--out",
            str(release_manifest),
            "--force",
        ]
    )
    _run(
        [
            sys.executable,
            str(root / "scripts" / "hermes-distribution.py"),
            "verify-release",
            "--archive",
            str(artifact),
            "--release-manifest",
            str(release_manifest),
            "--public-key",
            _env("HERMES_RELEASE_PUBLIC_KEY"),
            "--platform",
            args.platform,
            "--arch",
            args.arch,
            "--version",
            args.version,
        ]
    )
    return release_manifest


def _refresh_bundle_manifest(args: argparse.Namespace) -> None:
    root = _root()
    _run(
        [
            sys.executable,
            str(root / "scripts" / "hermes-distribution.py"),
            "manifest",
            "--root",
            str(Path(args.stage)),
            "--out",
            str(Path(args.stage) / "hermes-manifest.json"),
            "--version",
            args.version,
            "--platform",
            args.platform,
            "--arch",
            args.arch,
            "--mode",
            args.mode,
            "--api-base",
            "/api/hermes/v1",
            "--force",
        ]
    )


def _require_release_opt_in() -> None:
    if os.getenv("HERMES_RELEASE") != "1":
        raise ReleaseError("set HERMES_RELEASE=1 to build signed release artifacts")


def _macos_dmg(args: argparse.Namespace) -> Path:
    if args.mode != "full":
        raise ReleaseError("macOS DMG release requires --mode full so Hermes.app is present")
    stage = Path(args.stage)
    app = stage / "Hermes.app"
    if not (app / "Contents" / "Info.plist").is_file():
        raise ReleaseError(f"macOS app bundle is missing: {app}")
    codesign = _tool("codesign")
    xcrun = _tool("xcrun")
    hdiutil = _tool("hdiutil")
    identity = _env("HERMES_MACOS_CODESIGN_IDENTITY")
    apple_id = _env("HERMES_NOTARY_APPLE_ID")
    team_id = _env("HERMES_NOTARY_TEAM_ID")
    password = _env("HERMES_NOTARY_PASSWORD")
    dmg = Path(args.out_dir) / f"hermes-{args.version}-{args.platform}-{args.arch}.dmg"
    _macos_codesign_app(app, identity, codesign)
    _run([codesign, "--verify", "--strict", "--verbose=2", str(app)])
    _refresh_bundle_manifest(args)
    tmp_dmg = dmg.with_suffix(".tmp.dmg")
    if tmp_dmg.exists():
        tmp_dmg.unlink()
    if dmg.exists():
        dmg.unlink()
    _run([hdiutil, "create", "-volname", "Hermes", "-srcfolder", str(app), "-ov", "-format", "UDZO", str(tmp_dmg)])
    tmp_dmg.rename(dmg)
    _run(
        [
            xcrun,
            "notarytool",
            "submit",
            str(dmg),
            "--apple-id",
            apple_id,
            "--team-id",
            team_id,
            "--password",
            password,
            "--wait",
        ]
    )
    _run([xcrun, "stapler", "staple", str(dmg)])
    _run([xcrun, "stapler", "validate", str(dmg)])
    return dmg


def _macos_codesign_app(app: Path, identity: str, codesign: str) -> None:
    entitlements = Path(_optional_env("HERMES_MACOS_ENTITLEMENTS") or (_root() / "apps" / "hermes-client" / "macos" / "Runner" / "Release.entitlements"))
    signable: list[Path] = []
    for path in sorted(app.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        if path.is_dir() and path.suffix in {".framework", ".xpc", ".appex"}:
            signable.append(path)
        elif path.is_file() and (os.access(path, os.X_OK) or path.suffix in {".dylib", ".so"}):
            signable.append(path)
    seen: set[Path] = set()
    for path in signable:
        if path in seen:
            continue
        seen.add(path)
        _run([codesign, "--force", "--options", "runtime", "--timestamp", "--sign", identity, str(path)])
    cmd = [codesign, "--force", "--options", "runtime", "--timestamp", "--sign", identity]
    if entitlements.is_file():
        cmd.extend(["--entitlements", str(entitlements)])
    cmd.append(str(app))
    _run(cmd)


def _windows_signed_package(args: argparse.Namespace) -> Path:
    if args.mode != "full":
        raise ReleaseError("Windows MSIX release requires --mode full so hermes_client.exe is present")
    makeappx = _first_tool("MakeAppx.exe", "makeappx.exe", "MakeAppx", "makeappx")
    signtool = _first_tool("SignTool.exe", "signtool.exe", "signtool")
    stage = Path(args.stage)
    exe = stage / "Hermes" / "hermes_client.exe"
    if not exe.is_file():
        raise ReleaseError(f"Windows Flutter executable is missing: {exe}")
    cert = _env("HERMES_WINDOWS_PFX")
    password = _env("HERMES_WINDOWS_PFX_PASSWORD")
    publisher = _env("HERMES_WINDOWS_PUBLISHER")
    timestamp_url = os.getenv("HERMES_WINDOWS_TIMESTAMP_URL", "http://timestamp.digicert.com")
    out = Path(args.out_dir) / f"hermes-{args.version}-{args.platform}-{args.arch}.msix"
    with tempfile.TemporaryDirectory(prefix="hermes-msix-", dir=Path(args.out_dir)) as build_dir:
        package_root = Path(build_dir) / "package"
        shutil.copytree(stage, package_root, symlinks=True)
        assets = package_root / "Assets"
        assets.mkdir()
        shutil.copy2(_linux_icon_source(), assets / "Hermes.png")
        _write_windows_manifest(package_root / "AppxManifest.xml", publisher, args.arch)
        _run([makeappx, "pack", "/d", str(package_root), "/p", str(out), "/overwrite"])
    _run([signtool, "sign", "/fd", "SHA256", "/tr", timestamp_url, "/td", "SHA256", "/f", cert, "/p", password, str(out)])
    _run([signtool, "verify", "/pa", "/v", str(out)])
    return out


def _write_windows_manifest(path: Path, publisher: str, arch: str) -> None:
    ET.register_namespace("", WINDOWS_NS)
    ET.register_namespace("uap", UAP_NS)
    ET.register_namespace("rescap", RESCAP_NS)
    root = ET.Element(
        f"{{{WINDOWS_NS}}}Package",
        {
            "IgnorableNamespaces": "uap rescap",
        },
    )
    ET.SubElement(root, f"{{{WINDOWS_NS}}}Identity", {
        "Name": _optional_env("HERMES_WINDOWS_PACKAGE_NAME") or "Hermes.Desktop",
        "Publisher": publisher,
        "Version": f"{RELEASE_VERSION}.0",
        "ProcessorArchitecture": {"x64": "x64", "arm64": "arm64"}.get(arch, arch),
    })
    props = ET.SubElement(root, f"{{{WINDOWS_NS}}}Properties")
    ET.SubElement(props, f"{{{WINDOWS_NS}}}DisplayName").text = "Hermes"
    ET.SubElement(props, f"{{{WINDOWS_NS}}}PublisherDisplayName").text = _optional_env("HERMES_WINDOWS_PUBLISHER_DISPLAY_NAME") or "Hermes ReleaseOps"
    ET.SubElement(props, f"{{{WINDOWS_NS}}}Logo").text = "Assets\\Hermes.png"
    deps = ET.SubElement(root, f"{{{WINDOWS_NS}}}Dependencies")
    ET.SubElement(deps, f"{{{WINDOWS_NS}}}TargetDeviceFamily", {
        "Name": "Windows.Desktop",
        "MinVersion": "10.0.17763.0",
        "MaxVersionTested": "10.0.22621.0",
    })
    resources = ET.SubElement(root, f"{{{WINDOWS_NS}}}Resources")
    ET.SubElement(resources, f"{{{WINDOWS_NS}}}Resource", {"Language": "en-us"})
    apps = ET.SubElement(root, f"{{{WINDOWS_NS}}}Applications")
    app = ET.SubElement(apps, f"{{{WINDOWS_NS}}}Application", {"Id": "Hermes", "Executable": "Hermes\\hermes_client.exe", "EntryPoint": "Windows.FullTrustApplication"})
    ET.SubElement(app, f"{{{UAP_NS}}}VisualElements", {
        "DisplayName": "Hermes",
        "Description": "Hermes desktop runtime",
        "BackgroundColor": "transparent",
        "Square44x44Logo": "Assets\\Hermes.png",
        "Square150x150Logo": "Assets\\Hermes.png",
    })
    caps = ET.SubElement(root, f"{{{WINDOWS_NS}}}Capabilities")
    ET.SubElement(caps, f"{{{RESCAP_NS}}}Capability", {"Name": "runFullTrust"})
    path.write_text("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" + ET.tostring(root, encoding="unicode"), encoding="utf-8")


def _linux_deb(args: argparse.Namespace) -> Path:
    dpkg_deb = _tool("dpkg-deb")
    stage = Path(args.stage)
    deb = Path(args.out_dir) / f"hermes-{args.version}-{args.platform}-{args.arch}.deb"
    with tempfile.TemporaryDirectory(prefix="hermes-deb-", dir=Path(args.out_dir)) as build_dir:
        root = Path(build_dir) / "root"
        package_root = root / "opt" / "hermes"
        debian = root / "DEBIAN"
        package_root.mkdir(parents=True)
        debian.mkdir()
        shutil.copytree(stage, package_root, dirs_exist_ok=True, symlinks=True)
        _write_linux_desktop(root, args)
        deb_arch = {"x64": "amd64", "arm64": "arm64"}.get(args.arch, args.arch)
        (debian / "control").write_text(
            "\n".join(
                [
                    "Package: hermes",
                    f"Version: {args.version}",
                    "Section: utils",
                    "Priority: optional",
                    f"Architecture: {deb_arch}",
                    "Maintainer: Hermes ReleaseOps <release@example.invalid>",
                    "Description: Hermes desktop runtime",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        _run([dpkg_deb, "--build", "--root-owner-group", str(root), str(deb)])
    signing_key = os.getenv("HERMES_LINUX_GPG_KEY_ID", "").strip()
    if signing_key:
        dpkg_sig = _tool("dpkg-sig")
        cmd = [dpkg_sig, "--sign", "builder"]
        cmd.extend(["--gpg-options", f"--local-user {signing_key}"])
        cmd.append(str(deb))
        _run(cmd)
        _run(["dpkg-sig", "--verify", str(deb)])
    else:
        print("Linux deb archive signature skipped: HERMES_LINUX_GPG_KEY_ID is not configured", file=sys.stderr)
    _sign_linux_checksum(deb)
    return deb


def _linux_appimage(args: argparse.Namespace) -> Path:
    appimagetool = _tool("appimagetool")
    stage = Path(args.stage)
    env = os.environ.copy()
    env["ARCH"] = "x86_64" if args.arch == "x64" else args.arch
    appimage = Path(args.out_dir) / f"hermes-{args.version}-{args.platform}-{args.arch}.AppImage"
    with tempfile.TemporaryDirectory(prefix="hermes-appimage-", dir=Path(args.out_dir)) as build_dir:
        appdir = Path(build_dir) / "Hermes.AppDir"
        (appdir / "usr" / "bin").mkdir(parents=True)
        shutil.copytree(stage, appdir / "opt" / "hermes", dirs_exist_ok=True, symlinks=True)
        launcher = _linux_launcher_path(args)
        (appdir / "AppRun").write_text(f"#!/usr/bin/env sh\nexec \"$APPDIR/opt/hermes/{launcher}\" \"$@\"\n", encoding="utf-8")
        (appdir / "AppRun").chmod(0o755)
        _write_desktop_file(appdir / "hermes.desktop", "hermes")
        shutil.copy2(_linux_icon_source(), appdir / "hermes.png")
        cmd = [appimagetool, str(appdir), str(appimage)]
        if _optional_env("HERMES_LINUX_APPIMAGE_SIGN") == "1":
            cmd.append("--sign")
        _run(cmd, env=env)
    if _optional_env("HERMES_LINUX_APPIMAGE_SIGN") == "1":
        _run([str(appimage), "--appimage-signature"])
    else:
        print("Linux AppImage signature skipped: HERMES_LINUX_APPIMAGE_SIGN=1 is not configured", file=sys.stderr)
    _sign_linux_checksum(appimage)
    return appimage


def _linux_launcher_path(args: argparse.Namespace) -> str:
    full_launcher = "Hermes/hermes_client"
    core_launcher = "Hermes/runtime/hermes-core/hermes-core"
    stage = Path(args.stage)
    if args.mode == "full":
        if not (stage / full_launcher).is_file():
            raise ReleaseError(f"Linux Flutter executable is missing: {stage / full_launcher}")
        return full_launcher
    if not (stage / core_launcher).is_file():
        raise ReleaseError(f"Hermes core executable is missing: {stage / core_launcher}")
    return core_launcher


def _write_linux_desktop(root: Path, args: argparse.Namespace) -> None:
    applications = root / "usr" / "share" / "applications"
    icons = root / "usr" / "share" / "icons" / "hicolor" / "256x256" / "apps"
    applications.mkdir(parents=True)
    icons.mkdir(parents=True)
    launcher = "/opt/hermes/" + _linux_launcher_path(args)
    _write_desktop_file(applications / "hermes.desktop", launcher)
    shutil.copy2(_linux_icon_source(), icons / "hermes.png")


def _write_desktop_file(path: Path, exec_path: str) -> None:
    path.write_text(
        "\n".join(
            [
                "[Desktop Entry]",
                "Type=Application",
                "Name=Hermes",
                f"Exec={exec_path}",
                "Icon=hermes",
                "Terminal=false",
                "Categories=Development;Utility;",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _linux_icon_source() -> Path:
    root = _root()
    for candidate in (
        root / "apps/hermes-client/macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_256.png",
        root / "apps/hermes-client/macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_512.png",
        root / "apps/hermes-client/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
    ):
        if candidate.is_file() and candidate.stat().st_size > 100:
            return candidate
    raise ReleaseError("Hermes release icon asset is missing")


def _sign_linux_checksum(artifact: Path) -> None:
    checksum = artifact.with_suffix(artifact.suffix + ".sha256")
    digest = subprocess.check_output([_tool("shasum"), "-a", "256", str(artifact)], text=True)  # noqa: S603
    checksum.write_text(digest, encoding="utf-8")
    signer = os.getenv("HERMES_LINUX_CHECKSUM_SIGNER", "").strip().lower()
    if not signer:
        print("Linux checksum signature skipped: HERMES_LINUX_CHECKSUM_SIGNER is not configured", file=sys.stderr)
        return
    if signer == "openssl":
        openssl = _tool("openssl")
        private_key = _env("HERMES_LINUX_OPENSSL_PRIVATE_KEY")
        signature = checksum.with_suffix(checksum.suffix + ".sig")
        _run([openssl, "dgst", "-sha256", "-sign", private_key, "-out", str(signature), str(checksum)])
        public_key = os.getenv("HERMES_LINUX_OPENSSL_PUBLIC_KEY", "").strip()
        if public_key:
            _run([openssl, "dgst", "-sha256", "-verify", public_key, "-signature", str(signature), str(checksum)])
        return
    if signer == "minisign":
        minisign = _tool("minisign")
        secret_key = _env("HERMES_LINUX_MINISIGN_SECRET_KEY")
        signature = checksum.with_suffix(checksum.suffix + ".minisig")
        _run([minisign, "-Sm", str(checksum), "-s", secret_key, "-x", str(signature)])
        public_key = os.getenv("HERMES_LINUX_MINISIGN_PUBLIC_KEY", "").strip()
        if public_key:
            _run([minisign, "-Vm", str(checksum), "-P", public_key, "-x", str(signature)])
        return
    raise ReleaseError("HERMES_LINUX_CHECKSUM_SIGNER must be openssl or minisign")


def _portable(args: argparse.Namespace) -> Path:
    archive = Path(args.archive)
    if not archive.is_file():
        raise ReleaseError(f"portable archive is missing: {archive}")
    return archive


def package_command(args: argparse.Namespace) -> int:
    try:
        _require_release_opt_in()
        _validate_args(args)
        Path(args.out_dir).mkdir(parents=True, exist_ok=True)
        if args.package == "auto":
            args.package = {"macos": "dmg", "windows": "windows", "linux": "deb"}.get(args.platform, "portable")
        handlers = {
            "portable": _portable,
            "dmg": _macos_dmg,
            "windows": _windows_signed_package,
            "deb": _linux_deb,
            "appimage": _linux_appimage,
        }
        artifact = handlers[args.package](args)
        if _release_manifest_credentials_available():
            release_manifest = _sign_release_manifest(args, artifact)
            print(f"signed release artifact: {artifact}")
            print(f"signed release manifest: {release_manifest}")
        else:
            print("unsigned release artifact: release manifest signing credentials are not configured", file=sys.stderr)
            print(f"release artifact: {artifact}")
        return 0
    except (ReleaseError, subprocess.CalledProcessError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hermes-release", description="Hermes opt-in signed release packager")
    sub = parser.add_subparsers(dest="command", required=True)
    package = sub.add_parser("package")
    package.add_argument("--stage", required=True)
    package.add_argument("--archive", required=True)
    package.add_argument("--out-dir", required=True)
    package.add_argument("--version", required=True)
    package.add_argument("--platform", required=True, choices=["macos", "windows", "linux"])
    package.add_argument("--arch", required=True)
    package.add_argument("--mode", required=True, choices=["core-only", "full"])
    package.add_argument("--package", choices=["auto", "portable", "dmg", "windows", "deb", "appimage"], default="auto")
    package.set_defaults(func=package_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
