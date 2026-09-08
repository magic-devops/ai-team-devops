# Hermes Acceptance Matrix

This matrix records real evidence slots. Empty or unavailable evidence remains
explicitly open.

## Historical Evidence Captured Before 1.0.0 Normalization

The following bullets are historical QA from before the Hermes 1.0.0 route and
packaging normalization. They are retained as prior execution history, not as
fresh Hermes 1.0.0 acceptance evidence. Fresh acceptance evidence belongs in
`docs/HERMES_1_0_0_QA.md`.

- Full readiness: 22 passed, 1 failed (`flutter.build.macos`: missing `xcodebuild`), 0 unavailable. The gate correctly exits nonzero and `release_ready` remains false.
- Python: core 19, Manager scope/page 2, SDK/CLI 17, generator 1 tests passed (39 total). Core tests include real Go execution, approvals, retry and lease recovery.
- Web: 22 Vitest files / 128 tests, TypeScript checking and Vite build passed.
- Flutter 3.47.2 / Dart 3.13.2: analyze and 7 tests passed. Widget tests visit all five destinations at 1440x900 and 390x844; this is not native-device evidence. Editor uses re_editor 0.10.0.
- Go: host tests and Windows amd64 CGO-disabled cross-compilation passed. Cross-compilation does not execute Windows tests; CGO-disabled outbox intentionally fails closed.
- Web manual QA: workspace/run creation, Red (exit 1), human interrupt, approval, Green (exit 0), actual file evidence, replay preview, disabled terminal-state actions and audit export. See `hermes-local-qa.json`.
- Frozen Core: PyInstaller 6.22.2 macOS ARM64 bundle started outside the checkout without PYTHONPATH, created a workspace and completed a real LangGraph node through bundled agentd. Development archive: `dist/hermes-macos-arm64-core-only.tar.gz`, SHA-256 `d7e8f79c4e7da7af0dbf19e1f47cb9f9614539626327ddd6e32a3e7fab8a2ada`.

## Open Delivery Boundaries

This commit is the local execution foundation, not completion of the full Hermes 1.0.0 plan.
Remote device pairing/revocation, remote ownership dispatch, offline draft sync,
ACP/MCP/LLM adapters, arbitrary graph loops and compensation, full business-specific
data/skills/plugin workflows, embedded terminal integration, installers and signed
updates are still open. PostgreSQL code paths have not been tested against a live
team database. Five-platform installation, Chinese IME, accessibility, large-file
editing, crash recovery on real devices and benchmark targets are not accepted yet.

| Area | Evidence command | Expected result | Current status |
| --- | --- | --- | --- |
| Workflow file | `test -f .github/workflows/hermes.yml` | exact file exists | required |
| Core syntax | `PYTHONPATH=packages/hermes-core python3 -m compileall -q packages/hermes-core/hermes_core` | exit 0 | required |
| Core contract tests | `PYTHONPATH=packages/hermes-core pytest -q packages/hermes-core/tests` | actual core tests pass | required |
| Readiness JSON | `PYTHONPATH=packages/hermes-core python3 scripts/hermes-readiness.py --json` | JSON records passed/failed/unavailable | required |
| Full readiness | `PYTHONPATH=packages/hermes-core python3 scripts/hermes-readiness.py --json --full` | nonzero if required full gates missing | platform dependent |
| Desktop bootstrap | `PYTHONPATH=packages/hermes-core PYTHON_BIN=/path/to/python-with-deps bash scripts/hermes-bootstrap.sh DIR` | one ready JSON line with url/token_file/pid | required |
| Go agentd | `cd apps/agent-runtime && go test ./...` | exit 0 | required by full readiness |
| Core-only package | `bash scripts/hermes-package.sh --core-only` | PyInstaller onedir plus agentd, then frozen-core launch from a temporary cwd without `PYTHONPATH`; `/api/hermes/v1/health` and authenticated workspace API return the expected contract | required |
| Bundle layout | `tar -tf dist/hermes-1.0.0-macos-arm64-core-only.tar.gz` | includes `Hermes/runtime/hermes-core/hermes-core` and `Hermes/runtime/agentd/sop-agentd`; not a desktop installer | required |
| Full package gate | `bash scripts/hermes-package.sh --full [--flutter-bundle PATH]` | builds or consumes a real Flutter host; rejects missing host tools; preserves prior bundles | native packaging unverified |
| Flutter hosts | `bash scripts/hermes-mobile-check.sh` | Flutter analyze and tests pass where Flutter SDK exists; native macOS build remains blocked if `xcrun`/`xcodebuild` is unavailable | open: reported main lane has Flutter 3.47.2 analyze plus 7 tests passed; native macOS xcrun/xcodebuild missing |
| Windows package | `.github/workflows/hermes.yml` Windows package job | uses bash shell and builds `hermes-core.exe` plus `sop-agentd.exe` into the Windows runtime layout | CI only |
| Release signing | `HERMES_RELEASE=1 bash scripts/hermes-package.sh --core-only` | fails closed: this bundler does not implement signed release distribution | not implemented |
| Production backend data | N/A | no mocked backend production data | intentionally not claimed |

Required platform QA before release:

- macOS: bootstrap, local API smoke, real Flutter host build after Xcode tools exist, codesign/notarization.
- Windows: bootstrap, API smoke, installer install/uninstall, Authenticode signing.
- Linux: bootstrap, API smoke, tar runtime paths, service startup.
- iOS/Android: remote base URL/token configuration, secure storage, compile, device smoke.
