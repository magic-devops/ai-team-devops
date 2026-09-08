# Hermes Client

Flutter desktop/mobile client for the authorized Hermes v5 contract.

## Contract

- API base: `/api/v2`
- Auth: `Authorization: Bearer <token>`
- Workspace scope: `X-Workspace-Id`
- Response envelope: `{ok,scope,summary,items,actions,permissions,audit,trace_id,agent_consumption,cli,error?}`; permissions is a string array and audit is an object.
- Entity wire shape: `{id,kind,version,status,data,created_at,updated_at}`

The client has no mock backend. When a remote core is not configured, repositories raise an explicit unavailable-core error and the UI shows the connection state.

## Local Bootstrap

On desktop, Settings starts the packaged runtime by absolute path, never an
untrusted executable from PATH:

```bash
hermes-core --data-dir DIR --token-file FILE --port 0 --agentd BUNDLED_AGENTD
```

The process must write a single JSON line to stdout:

```json
{"url":"http://127.0.0.1:12345","token_file":"/path/token","pid":1234}
```

The core owns token generation and token file permissions. The Flutter client reads the generated token file and stores the URL/token in the system keychain through `flutter_secure_storage`.

## Verification

Native host projects for all five platforms are checked in. Development was
verified with Flutter 3.47.2 / Dart 3.13.2 and re_editor 0.10.0. Run:

```bash
flutter pub get
flutter analyze
flutter test
flutter build macos
```

The current macOS verification host lacks full Xcode and CocoaPods; Android
command-line build tools are also absent. Analyze and widget/contract tests
are not native installation or real-device evidence. See
`docs/HERMES_V5_ACCEPTANCE.md` at repository root for the release matrix.

macOS uses a non-App-Store desktop entitlement configuration so the packaged
core and executor can launch project tools. This is not an OS sandbox. Mobile
clients never launch these local processes and require an authenticated remote
HTTPS endpoint (loopback HTTP is allowed for development).
