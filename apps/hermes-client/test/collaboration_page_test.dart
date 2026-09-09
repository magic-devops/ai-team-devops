import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/pages/collaboration_page.dart';
import 'package:hermes_client/src/settings_controller.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class TestSettings extends SettingsController {
  @override
  Future<ConnectionSettings> build() async => const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      );
}

class MutableTestSettings extends SettingsController {
  @override
  Future<ConnectionSettings> build() async => const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      );

  @override
  Future<void> selectWorkspace(String workspaceId) async {
    state = AsyncData(ConnectionSettings(
      baseUrl: state.requireValue.baseUrl,
      token: state.requireValue.token,
      workspaceId: workspaceId,
    ));
  }
}

void main() {
  testWidgets('collaboration page renders server identities and list-detail',
      (tester) async {
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final requests = <String>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      ),
      httpClient: MockClient((request) async {
        requests.add('${request.method} ${request.url.path}');
        return http.Response.bytes(
          utf8.encode(jsonEncode(_responseFor(request.url.path))),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    addTearDown(client.close);

    await tester.pumpWidget(ProviderScope(
      retry: (_, __) => null,
      overrides: [
        settingsProvider.overrideWith(TestSettings.new),
        workspaceSelectionProvider.overrideWithValue('ws'),
        readinessProvider.overrideWith(
          (ref) async => const HermesEnvelope(
            ok: true,
            scope: {},
            summary: {},
            items: [],
            actions: [],
            permissions: ['read', 'write', 'config'],
            audit: {'actor': 'owner'},
            traceId: null,
          ),
        ),
        apiClientFactoryProvider.overrideWith((ref) => (_) => client),
      ],
      child: const MaterialApp(home: Scaffold(body: CollaborationPage())),
    ));
    await tester.pumpAndSettle();

    expect(find.text('工程协同'), findsOneWidget);
    await tester.tap(find.text('工程协同'));
    await tester.pumpAndSettle();
    expect(find.text('发布线程'), findsOneWidget);
    await tester.tap(find.text('发布线程'));
    await tester.pumpAndSettle();
    expect(find.textContaining('请 Dalton 复核 Flutter SDK'), findsOneWidget);
    expect(requests, contains('GET /api/hermes/v1/collaboration/members'));

    await tester.tap(find.byTooltip('配置频道'));
    await tester.pumpAndSettle();

    expect(find.text('owner'), findsWidgets);
    expect(find.text('dalton'), findsWidgets);
    expect(find.byType(FilterChip), findsNWidgets(2));
    expect(find.text('频道逻辑 ID'), findsOneWidget);
  });

  testWidgets(
      'delayed thread response cannot overwrite newer channel selection',
      (tester) async {
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final engineeringThreads = Completer<http.Response>();
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      ),
      httpClient: MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/collaboration/channels/ch_engineering/threads')) {
          return engineeringThreads.future;
        }
        return http.Response.bytes(
          utf8.encode(jsonEncode(_responseFor(path))),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    addTearDown(client.close);

    await tester.pumpWidget(_collaborationHarness(client));
    await tester.pumpAndSettle();

    await tester.tap(find.text('工程协同'));
    await tester.pump();
    await tester.tap(find.text('运营协同'));
    await tester.pumpAndSettle();

    expect(find.text('运营线程'), findsOneWidget);
    expect(find.text('发布线程'), findsNothing);

    engineeringThreads.complete(http.Response.bytes(
      utf8.encode(jsonEncode({
        'ok': true,
        'items': [_thread],
        'permissions': ['read', 'write', 'config'],
        'audit': {'actor': 'owner'},
      })),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    ));
    await tester.pumpAndSettle();

    expect(find.text('运营线程'), findsOneWidget);
    expect(find.text('发布线程'), findsNothing);
  });

  testWidgets(
      'mobile message delivery keeps audit evidence within the viewport',
      (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      ),
      httpClient: MockClient((request) async => http.Response.bytes(
            utf8.encode(jsonEncode({
              ..._responseFor(request.url.path),
              'trace_id': '0123456789abcdef0123456789abcdef',
            })),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          )),
    );
    addTearDown(client.close);
    await tester.pumpWidget(_collaborationHarness(client));
    await tester.pumpAndSettle();
    await tester.tap(find.text('工程协同'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('发布线程').first);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '核对交付证据');
    await tester.pump();
    await tester.tap(find.widgetWithText(OutlinedButton, '预览'));
    await tester.pumpAndSettle();
    expect(find.text('预览就绪'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '发送'));
    await tester.pumpAndSettle();
    expect(find.text('trace 0123456789abcdef0123456789abcdef'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dialog preview and apply stay bound to originating workspace',
      (tester) async {
    tester.view.physicalSize = const Size(1180, 820);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final preview = Completer<http.Response>();
    final configureBodies = <Map<String, dynamic>>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      ),
      httpClient: MockClient((request) async {
        final path = request.url.path;
        if (path.endsWith('/configure')) {
          configureBodies.add(jsonDecode(request.body) as Map<String, dynamic>);
          return preview.future;
        }
        return http.Response.bytes(
          utf8.encode(jsonEncode(_responseFor(path))),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    addTearDown(client.close);

    await tester.pumpWidget(_collaborationHarness(client));
    await tester.pumpAndSettle();

    await tester.tap(find.text('工程协同'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('配置频道'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, '预览'));
    await tester.pump();

    final dialogContainer = ProviderScope.containerOf(
      tester.element(find.byWidgetPredicate(
        (widget) => widget.runtimeType.toString() == '_ChannelDialog',
      )),
    );
    await (dialogContainer.read(settingsProvider.notifier)
            as MutableTestSettings)
        .selectWorkspace('ws-next');
    await tester.pumpAndSettle();
    expect(dialogContainer.read(workspaceSelectionProvider), 'ws-next');

    preview.complete(http.Response.bytes(
      utf8.encode(jsonEncode({
        'ok': true,
        'items': [_channel],
        'summary': {'would_apply': true},
        'permissions': ['read', 'write', 'config'],
        'audit': {'actor': 'owner'},
        'trace_id': 'stale-preview',
      })),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    ));
    await tester.pumpAndSettle();

    expect(find.text('预览证据'), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, '应用'));
    await tester.pumpAndSettle();

    expect(configureBodies, hasLength(1));
    expect(configureBodies.single['dry_run'], isTrue);
  });
}

Widget _collaborationHarness(HermesApiClient client) {
  return ProviderScope(
    retry: (_, __) => null,
    overrides: [
      settingsProvider.overrideWith(MutableTestSettings.new),
      readinessProvider.overrideWith(
        (ref) async => const HermesEnvelope(
          ok: true,
          scope: {},
          summary: {},
          items: [],
          actions: [],
          permissions: ['read', 'write', 'config'],
          audit: {'actor': 'owner'},
          traceId: null,
        ),
      ),
      apiClientFactoryProvider.overrideWith((ref) => (_) => client),
    ],
    child: const MaterialApp(home: Scaffold(body: CollaborationPage())),
  );
}

Map<String, dynamic> _responseFor(String path) {
  if (path.endsWith('/system/readiness')) {
    return {
      'ok': true,
      'items': [],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  if (path.endsWith('/collaboration/members')) {
    return {
      'ok': true,
      'items': [
        {'id': 'owner'},
        {'id': 'dalton'}
      ],
    };
  }
  if (path.endsWith('/collaboration/channels')) {
    return {
      'ok': true,
      'items': [_channel, _opsChannel],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  if (path.endsWith('/collaboration/channels/ch_engineering/threads')) {
    return {
      'ok': true,
      'items': [_thread],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  if (path.endsWith('/collaboration/channels/ch_ops/threads')) {
    return {
      'ok': true,
      'items': [_opsThread],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  if (path.endsWith('/collaboration/threads/th_release/messages')) {
    return {
      'ok': true,
      'items': [_message],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  if (path.endsWith('/collaboration/inbox')) {
    return {
      'ok': true,
      'items': [],
      'permissions': ['read', 'write', 'config'],
      'audit': {'actor': 'owner'},
    };
  }
  return {'ok': true, 'items': []};
}

const _channel = {
  'id': 'ch_engineering',
  'kind': 'channels',
  'version': 2,
  'status': 'active',
  'data': {
    'logical_id': 'engineering',
    'title': '工程协同',
    'members': ['owner', 'dalton'],
    'description': 'Product 1.0.0',
  },
  'created_at': '2026-09-09T00:00:00Z',
  'updated_at': '2026-09-09T00:00:00Z',
};

const _thread = {
  'id': 'th_release',
  'kind': 'threads',
  'version': 1,
  'status': 'active',
  'data': {
    'channel_id': 'ch_engineering',
    'title': '发布线程',
    'created_by': 'owner',
    'last_message_seq': 7,
  },
  'created_at': '2026-09-09T00:00:00Z',
  'updated_at': '2026-09-09T00:00:00Z',
};

const _opsChannel = {
  'id': 'ch_ops',
  'kind': 'channels',
  'version': 1,
  'status': 'active',
  'data': {
    'logical_id': 'ops',
    'title': '运营协同',
    'members': ['owner'],
    'description': 'Operations',
  },
  'created_at': '2026-09-09T00:00:00Z',
  'updated_at': '2026-09-09T00:00:00Z',
};

const _opsThread = {
  'id': 'th_ops',
  'kind': 'threads',
  'version': 1,
  'status': 'active',
  'data': {
    'channel_id': 'ch_ops',
    'title': '运营线程',
    'created_by': 'owner',
    'last_message_seq': 1,
  },
  'created_at': '2026-09-09T00:00:00Z',
  'updated_at': '2026-09-09T00:00:00Z',
};

const _message = {
  'id': 'msg_1',
  'kind': 'messages',
  'version': 3,
  'status': 'active',
  'data': {
    'channel_id': 'ch_engineering',
    'thread_id': 'th_release',
    'parent_id': '',
    'author': 'owner',
    'body': '请 Dalton 复核 Flutter SDK。',
    'mentions': ['dalton'],
    'recipients': ['owner', 'dalton'],
    'event_seq': 7,
  },
  'created_at': '2026-09-09T00:00:00Z',
  'updated_at': '2026-09-09T00:00:00Z',
};
