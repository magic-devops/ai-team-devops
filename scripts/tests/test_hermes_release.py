from __future__ import annotations

import importlib.util
import re
import subprocess
import xml.etree.ElementTree as ET
from argparse import Namespace
from pathlib import Path

import pytest
import yaml

SCRIPT = Path(__file__).resolve().parents[1] / "hermes-release.py"
WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/hermes-release.yml"
SPEC = importlib.util.spec_from_file_location("hermes_release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(release)


def _root(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    icon = root / "apps/hermes-client/macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_256.png"
    icon.parent.mkdir(parents=True)
    icon.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * 256)
    return root


def _stage(tmp_path: Path, *, platform: str = "linux", mode: str = "full") -> Path:
    stage = tmp_path / f"stage-{platform}-{mode}"
    if platform == "macos":
        app = stage / "Hermes.app"
        (app / "Contents/MacOS").mkdir(parents=True)
        (app / "Contents/Resources/runtime/hermes-core").mkdir(parents=True)
        (app / "Contents/Info.plist").write_text("<plist/>", encoding="utf-8")
        exe = app / "Contents/MacOS/hermes_client"
        exe.write_text("app", encoding="utf-8")
        exe.chmod(0o755)
        core = app / "Contents/Resources/runtime/hermes-core/hermes-core"
        core.write_text("core", encoding="utf-8")
        core.chmod(0o755)
        return stage
    (stage / "Hermes/runtime/hermes-core").mkdir(parents=True)
    core = stage / "Hermes/runtime/hermes-core/hermes-core"
    core.write_text("core", encoding="utf-8")
    core.chmod(0o755)
    if platform == "windows":
        exe = stage / "Hermes/hermes_client.exe"
    else:
        exe = stage / "Hermes/hermes_client"
    if mode == "full":
        exe.write_text("app", encoding="utf-8")
        exe.chmod(0o755)
    (stage / "hermes-manifest.json").write_text("{}", encoding="utf-8")
    return stage


def _args(tmp_path: Path, *, platform: str = "linux", arch: str = "x64", mode: str = "full", package: str = "portable") -> Namespace:
    archive = tmp_path / "hermes.tar.gz"
    archive.write_bytes(b"archive")
    return Namespace(
        stage=str(_stage(tmp_path, platform=platform, mode=mode)),
        archive=str(archive),
        out_dir=str(tmp_path / "dist"),
        version="1.0.0",
        platform=platform,
        arch=arch,
        mode=mode,
        package=package,
    )


def test_run_redacts_password_and_sanitizes_called_process_error(monkeypatch, capsys):
    def fail(argv, *, cwd=None, env=None, check=False):
        raise subprocess.CalledProcessError(12, argv, output="secret", stderr="secret")

    monkeypatch.setattr(release.subprocess, "run", fail)

    try:
        release._run(["signtool", "sign", "/p", "p@ssword", "artifact.msix"])
    except release.ReleaseError as exc:
        assert str(exc) == "signtool failed with exit code 12"
    else:
        raise AssertionError("expected ReleaseError")

    assert "p@ssword" not in capsys.readouterr().err


def test_release_manifest_credentials_are_all_or_none(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_RELEASE_PRIVATE_KEY", str(tmp_path / "private.pem"))
    monkeypatch.delenv("HERMES_RELEASE_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("HERMES_RELEASE_PUBLISHER", "Hermes")

    try:
        release._release_manifest_credentials_available()
    except release.ReleaseError as exc:
        assert "HERMES_RELEASE_PUBLIC_KEY" in str(exc)
    else:
        raise AssertionError("expected incomplete credential failure")


def test_package_rejects_non_fixed_version(tmp_path, monkeypatch):
    args = _args(tmp_path)
    args.version = "2.0.0"
    monkeypatch.setenv("HERMES_RELEASE", "1")

    assert release.package_command(args) == 1


@pytest.mark.parametrize("platform,package,mode", [
    ("linux", "dmg", "full"), ("macos", "windows", "full"),
    ("windows", "deb", "full"), ("macos", "dmg", "core-only"),
    ("windows", "auto", "core-only"),
])
def test_package_rejects_incompatible_target_before_build(tmp_path, monkeypatch, platform, package, mode):
    args = _args(tmp_path, platform=platform, package=package, mode=mode)
    monkeypatch.setenv("HERMES_RELEASE", "1")
    assert release.package_command(args) == 1
    assert not Path(args.out_dir).exists()


@pytest.mark.parametrize("package,platforms", [
    ("portable", ["linux", "macos", "windows"]), ("auto", ["linux", "macos", "windows"]),
    ("dmg", ["macos"]), ("windows", ["windows"]), ("deb", ["linux"]), ("appimage", ["linux"]),
])
def test_workflow_preflight_matrix_only_targets_compatible_platforms(tmp_path, monkeypatch, package, platforms):
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    preflight = workflow["jobs"]["prepare"]["steps"][0]["run"]
    program = preflight.split("\n", 1)[1].rsplit("\nPY", 1)[0]
    output = tmp_path / "github-output"
    monkeypatch.setenv("PACKAGE", package)
    monkeypatch.setenv("MODE", "full")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    exec(compile(program, "workflow-preflight", "exec"), {})  # noqa: S102 - fixed repository workflow, not untrusted input
    import json
    matrix = json.loads(output.read_text().removeprefix("matrix="))
    assert [item["platform"] for item in matrix["include"]] == platforms
    assert workflow["jobs"]["build-and-verify"]["needs"] == "prepare"


def test_sign_release_manifest_always_verifies_with_public_key(tmp_path, monkeypatch):
    args = _args(tmp_path)
    Path(args.out_dir).mkdir()
    private_key = tmp_path / "private.pem"
    public_key = tmp_path / "public.pem"
    private_key.write_text("private", encoding="utf-8")
    public_key.write_text("public", encoding="utf-8")
    monkeypatch.setenv("HERMES_RELEASE_PRIVATE_KEY", str(private_key))
    monkeypatch.setenv("HERMES_RELEASE_PUBLIC_KEY", str(public_key))
    monkeypatch.setenv("HERMES_RELEASE_PUBLISHER", "Hermes Test")
    monkeypatch.setattr(release, "_root", lambda: _root(tmp_path))
    calls: list[list[str]] = []
    monkeypatch.setattr(release, "_run", lambda argv, **kwargs: calls.append(argv))

    release._sign_release_manifest(args, Path(args.archive))

    assert [call[2] for call in calls] == ["sign-release", "verify-release"]
    assert "--public-key" in calls[1]


def test_windows_builds_msix_from_stage_and_signs(tmp_path, monkeypatch):
    root = _root(tmp_path)
    args = _args(tmp_path, platform="windows", mode="full", package="windows")
    Path(args.out_dir).mkdir()
    monkeypatch.setattr(release, "_root", lambda: root)
    monkeypatch.setenv("HERMES_WINDOWS_PFX", str(tmp_path / "cert.pfx"))
    monkeypatch.setenv("HERMES_WINDOWS_PFX_PASSWORD", "secret")
    monkeypatch.setenv("HERMES_WINDOWS_PUBLISHER", "CN=Hermes Test")
    monkeypatch.setattr(release, "_first_tool", lambda *names: names[0])
    calls: list[list[str]] = []
    captured_manifest = ""

    def record(argv, **kwargs):
        nonlocal captured_manifest
        calls.append(argv)
        if argv[0].lower().startswith("makeappx"):
            package_root = Path(argv[argv.index("/d") + 1])
            captured_manifest = (package_root / "AppxManifest.xml").read_text(encoding="utf-8")
            Path(argv[argv.index("/p") + 1]).write_bytes(b"msix")

    monkeypatch.setattr(release, "_run", record)

    artifact = release._windows_signed_package(args)

    assert artifact.name.endswith(".msix")
    assert not any("HERMES_WINDOWS_PACKAGE_PATH" in " ".join(call) for call in calls)
    assert calls[0][1] == "pack"
    assert calls[1][1] == "sign"
    parsed = ET.fromstring(captured_manifest)  # noqa: S314 - generated manifest fixture
    identity = parsed.find(f"{{{release.WINDOWS_NS}}}Identity")
    application = parsed.find(f".//{{{release.WINDOWS_NS}}}Application")
    assert identity is not None and identity.attrib["Publisher"] == "CN=Hermes Test"
    assert application is not None and application.attrib["Executable"] == "Hermes\\hermes_client.exe"


def test_linux_appimage_full_launches_flutter_and_uses_real_icon(tmp_path, monkeypatch):
    root = _root(tmp_path)
    args = _args(tmp_path, platform="linux", mode="full", package="appimage")
    Path(args.out_dir).mkdir()
    monkeypatch.setattr(release, "_root", lambda: root)
    monkeypatch.setattr(release, "_tool", lambda name: name)
    monkeypatch.setattr(release, "_sign_linux_checksum", lambda artifact: None)
    observed: dict[str, object] = {}

    def record(argv, **kwargs):
        appdir = Path(argv[1])
        observed["apprun"] = (appdir / "AppRun").read_text(encoding="utf-8")
        observed["icon_size"] = (appdir / "hermes.png").stat().st_size
        Path(argv[2]).write_bytes(b"appimage")

    monkeypatch.setattr(release, "_run", record)

    release._linux_appimage(args)

    assert 'Hermes/hermes_client' in str(observed["apprun"])
    assert "runtime/hermes-core/hermes-core" not in str(observed["apprun"])
    assert int(observed["icon_size"]) > 100


def test_linux_deb_builds_desktop_launcher_in_temp_root(tmp_path, monkeypatch):
    root = _root(tmp_path)
    args = _args(tmp_path, platform="linux", mode="full", package="deb")
    Path(args.out_dir).mkdir()
    monkeypatch.setattr(release, "_root", lambda: root)
    monkeypatch.setattr(release, "_tool", lambda name: name)
    monkeypatch.setattr(release, "_sign_linux_checksum", lambda artifact: None)
    calls: list[list[str]] = []
    captured_desktop = ""
    captured_build_root = Path(args.out_dir)

    def record(argv, **kwargs):
        nonlocal captured_desktop, captured_build_root
        calls.append(argv)
        captured_build_root = Path(argv[-2])
        captured_desktop = (captured_build_root / "usr/share/applications/hermes.desktop").read_text(encoding="utf-8")
        Path(argv[-1]).write_bytes(b"deb")

    monkeypatch.setattr(release, "_run", record)

    release._linux_deb(args)

    assert "Exec=/opt/hermes/Hermes/hermes_client" in captured_desktop
    assert captured_build_root.is_relative_to(Path(args.out_dir))


def test_macos_codesign_is_explicit_without_deep(tmp_path, monkeypatch):
    args = _args(tmp_path, platform="macos", arch="arm64", mode="full", package="dmg")
    Path(args.out_dir).mkdir()
    app = Path(args.stage) / "Hermes.app"
    monkeypatch.setattr(release, "_root", lambda: _root(tmp_path))
    calls: list[list[str]] = []
    monkeypatch.setattr(release, "_run", lambda argv, **kwargs: calls.append(argv))

    release._macos_codesign_app(app, "Developer ID Application: Hermes", "codesign")

    flattened = " ".join(" ".join(call) for call in calls)
    assert "--deep" not in flattened
    assert any(call[-1].endswith("Hermes.app") for call in calls)
    assert any(call[-1].endswith("hermes-core") for call in calls)


def test_workflow_keeps_secret_conditions_and_package_inputs_safe():
    text = WORKFLOW.read_text(encoding="utf-8")
    if_lines = "\n".join(line for line in text.splitlines() if re.match(r"\s*if:", line))

    assert "secrets." not in if_lines
    assert "HERMES_WINDOWS_PACKAGE_PATH" not in text
    assert "--deep" not in text
    assert 'HERMES_FLUTTER_VERSION: "3.47.2"' in text
    assert re.search(r"options:\n\s+- \"1\.0\.0\"", text)
