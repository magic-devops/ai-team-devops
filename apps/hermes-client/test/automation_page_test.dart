import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/pages/automation_page.dart';
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

void main() {
  test('actions catalog preserves descriptor permissions arrays', () async {
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
      ),
      httpClient: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'ok': true,
            'items': [
              {
                'id': 'schedule.trigger',
                'title': 'Trigger schedule',
                'permissions': ['execute'],
              },
              {
                'id': 'schedule.configure',
                'title': 'Configure schedule',
                'permissions': ['config', 'execute'],
              }
            ],
          }),
          200,
        );
      }),
    );
    addTearDown(client.close);

    final actions = await client.actions();

    expect(actions, hasLength(2));
    expect(actions.first['id'], 'schedule.trigger');
    expect(actions.first['permissions'], ['execute']);
    expect(actions.last['permissions'], ['config', 'execute']);
  });

  test('agent dispatch posts RunAction fields and target version', () async {
    final requests = <http.Request>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org/api/hermes/v1',
        token: 'test',
      ),
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'ok': true,
            'summary': {'dry_run': true},
            'items': [
              {'id': 'delivery', 'phase': 'preview'}
            ],
            'permissions': ['read', 'write', 'execute'],
          }),
          200,
        );
      }),
    );
    addTearDown(client.close);

    await client.taskAgentDispatch(
      'task-1',
      workspaceId: 'ws',
      expectedVersion: 7,
      targetVersion: 4,
      prompt: 'Ship it',
      agentId: 'agent-1',
      isolation: 'git_worktree',
      baseCommit: 'a' * 40,
      idempotencyKey: 'dispatch-key',
    );

    expect(requests.single.method, 'POST');
    expect(
        requests.single.url.path, '/api/hermes/v1/tasks/task-1/agent-dispatch');
    expect(requests.single.headers['X-Workspace-Id'], 'ws');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect(body['idempotency_key'], 'dispatch-key');
    expect(body['expected_version'], 7);
    expect(body['target_version'], 4);
    expect(body['dry_run'], true);
    expect(body['agent_id'], 'agent-1');
    expect(body.containsKey('squad_id'), isFalse);
    expect(body['prompt'], 'Ship it');
    expect(body['isolation'], 'git_worktree');
    expect(body['base_commit'], 'a' * 40);
  });

  test('schedule configure uses interval scheduling endpoint', () async {
    final requests = <http.Request>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
      ),
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode({'ok': true, 'items': []}), 200);
      }),
    );
    addTearDown(client.close);

    await client.scheduleConfigure(
      'daily-readiness',
      workspaceId: 'ws',
      title: 'Readiness',
      intervalSeconds: 300,
      startsAt: '2026-09-08T00:00:00Z',
      nodes: [
        {
          'id': 'check',
          'kind': 'command',
          'argv': ['python3', 'scripts/hermes-readiness.py', '--json'],
        }
      ],
      enabled: true,
      misfireCoalesce: true,
      idempotencyKey: 'schedule-key',
      expectedVersion: 2,
      dryRun: false,
    );

    expect(requests.single.method, 'POST');
    expect(requests.single.url.path,
        '/api/hermes/v1/schedules/daily-readiness/configure');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect(body['interval_seconds'], 300);
    expect(body['starts_at'], '2026-09-08T00:00:00Z');
    expect(body['misfire_coalesce'], true);
    expect(body['expected_version'], 2);
    expect(body['dry_run'], false);
  });

  test('task dispatch can target a paired remote device command', () async {
    final requests = <http.Request>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
      ),
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode({'ok': true, 'items': []}), 200);
      }),
    );
    addTearDown(client.close);

    await client.taskDispatch(
      'task-remote',
      workspaceId: 'ws',
      expectedVersion: 9,
      nodes: [
        {
          'id': 'remote_command',
          'kind': 'command',
          'argv': ['python3', 'scripts/hermes-readiness.py', '--json'],
          'timeout_seconds': 300,
        }
      ],
      idempotencyKey: 'remote-key',
      targetDeviceId: 'device-1',
      dryRun: false,
    );

    expect(requests.single.method, 'POST');
    expect(
        requests.single.url.path, '/api/hermes/v1/tasks/task-remote/dispatch');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect(body['target_device_id'], 'device-1');
    expect(body['isolation'], 'workspace');
    expect(body['dry_run'], false);
    expect(body['nodes'], isA<List<dynamic>>());
  });

  test('agent dispatch requires exactly one versioned target', () async {
    final client = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
      ),
      httpClient: MockClient((request) async => http.Response('{}', 200)),
    );
    addTearDown(client.close);

    expect(
      () => client.taskAgentDispatch(
        'task',
        workspaceId: 'ws',
        expectedVersion: 1,
        targetVersion: 1,
        prompt: 'work',
        idempotencyKey: 'key',
      ),
      throwsA(isA<HermesApiException>()),
    );
    expect(
      () => client.taskAgentDispatch(
        'task',
        workspaceId: 'ws',
        expectedVersion: 1,
        targetVersion: 0,
        prompt: 'work',
        agentId: 'agent',
        idempotencyKey: 'key',
      ),
      throwsA(isA<HermesApiException>()),
    );
  });

  for (final size in [const Size(390, 844), const Size(1200, 900)]) {
    testWidgets('automation page renders native controls at $size',
        (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final writes = <Map<String, dynamic>>[];
      final api = HermesApiClient(
        settings: const ConnectionSettings(
          baseUrl: 'https://example.org',
          token: 'test',
          workspaceId: 'ws',
        ),
        httpClient: MockClient((request) async {
          if (request.method == 'POST') {
            writes.add(jsonDecode(request.body) as Map<String, dynamic>);
          }
          return http.Response(jsonEncode(_responseFor(request)), 200);
        }),
      );
      addTearDown(api.close);
      await tester.pumpWidget(
        ProviderScope(
          retry: (_, __) => null,
          overrides: [
            settingsProvider.overrideWith(TestSettings.new),
            workspaceSelectionProvider.overrideWithValue('ws'),
            readinessProvider.overrideWith(
              (ref) async => HermesEnvelope.fromJson({
                'ok': true,
                'items': [],
                'permissions': ['read', 'write', 'execute', 'config'],
                'trace_id': 'trace',
              }),
            ),
            apiProvider.overrideWithValue(api),
          ],
          child: const MaterialApp(
            home: Scaffold(body: AutomationPage(initialTabIndex: 4)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('自动化'), findsOneWidget);
      expect(find.text('Agents'), findsWidgets);
      expect(tester.takeException(), isNull);

      await tester.enterText(find.byType(TextFormField).first, 'Implement UI');
      await tester.scrollUntilVisible(
        find.text('预览派发'),
        120,
        scrollable: find.byType(Scrollable).at(1),
      );
      await tester.tap(find.text('预览派发'));
      await tester.pumpAndSettle();
      expect(writes.single['dry_run'], true);
      expect(writes.single['agent_id'], 'agent-1');
      expect(writes.single['target_version'], 2);
      expect(find.text('确认派发'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('agent catalog wording reports install state only',
      (tester) async {
    final api = HermesApiClient(
      settings: const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'test',
        workspaceId: 'ws',
      ),
      httpClient: MockClient((request) async =>
          http.Response(jsonEncode(_responseFor(request)), 200)),
    );
    addTearDown(api.close);

    await tester.pumpWidget(
      ProviderScope(
        retry: (_, __) => null,
        overrides: [
          settingsProvider.overrideWith(TestSettings.new),
          workspaceSelectionProvider.overrideWithValue('ws'),
          readinessProvider.overrideWith(
            (ref) async => HermesEnvelope.fromJson({
              'ok': true,
              'items': [],
              'permissions': ['read', 'write', 'execute', 'config'],
            }),
          ),
          apiProvider.overrideWithValue(api),
        ],
        child: const MaterialApp(
          home: Scaffold(body: AutomationPage()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('codex-reviewer'), findsOneWidget);
    expect(find.text('已安装'), findsOneWidget);
    expect(find.text('CLI 管理认证（未验证）'), findsOneWidget);
    expect(find.text('可运行'), findsNothing);
    expect(find.text('就绪'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('schedule configure requires preview for current edit',
      (tester) async {
    final requests = <Map<String, dynamic>>[];
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      onRequest: (request) {
        if (request.method == 'POST' &&
            request.url.path.contains('/schedules/')) {
          requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        }
      },
    );

    await tester.tap(find.byTooltip('编辑').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('预览配置'));
    await tester.pumpAndSettle();
    expect(requests.single['dry_run'], true);
    expect(find.text('应用配置'), findsOneWidget);
    var apply = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '应用配置'),
    );
    expect(apply.onPressed, isNotNull);

    await tester.enterText(find.widgetWithText(TextFormField, '标题'), 'Changed');
    await tester.pumpAndSettle();
    apply = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '应用配置'),
    );
    expect(apply.onPressed, isNull);
    expect(requests, hasLength(1));
  });

  testWidgets('remote dispatch invalidates preview when command changes',
      (tester) async {
    final requests = <Map<String, dynamic>>[];
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 3,
      onRequest: (request) {
        if (request.method == 'POST' &&
            request.url.path.endsWith('/dispatch')) {
          requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        }
      },
    );

    await tester.tap(find.byTooltip('派发任务').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('预览远程派发'));
    await tester.pumpAndSettle();
    expect(requests.single['dry_run'], true);
    var apply = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '确认派发'),
    );
    expect(apply.onPressed, isNotNull);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'argv JSON'),
      '["python3","scripts/hermes-readiness.py","--json","--strict"]',
    );
    await tester.pumpAndSettle();
    apply = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '确认派发'),
    );
    expect(apply.onPressed, isNull);
    expect(requests, hasLength(1));
  });

  testWidgets('device creation sends only backend-supported fields',
      (tester) async {
    Map<String, dynamic>? createBody;
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 3,
      onRequest: (request) {
        if (request.method == 'POST' && request.url.path.endsWith('/devices')) {
          createBody = jsonDecode(request.body) as Map<String, dynamic>;
        }
      },
    );

    await tester.tap(find.widgetWithText(FilledButton, '新建设备'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextFormField, '回调/远程地址（可选）'), findsNothing);
    expect(find.widgetWithText(TextFormField, '备注（可选）'), findsNothing);

    await tester.enterText(
        find.widgetWithText(TextFormField, '名称'), 'Mac worker');
    await tester.enterText(find.widgetWithText(TextFormField, '平台'), 'desktop');
    await tester.tap(find.widgetWithText(FilledButton, '提交'));
    await tester.pumpAndSettle();

    final data = createBody?['data'] as Map<String, dynamic>;
    expect(data, {
      'title': 'Mac worker',
      'name': 'Mac worker',
      'platform': 'desktop',
    });
    expect(data.containsKey('endpoint'), isFalse);
    expect(data.containsKey('notes'), isFalse);
  });

  testWidgets('automation permissions disable execute-backed actions only',
      (tester) async {
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      permissions: const ['read', 'write', 'config'],
    );

    final configure = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '配置计划'),
    );
    expect(configure.onPressed, isNull);
    final trigger = _iconButtons(tester, Icons.play_arrow_rounded).single;
    expect(trigger.onPressed, isNull);
    final pauseButtons =
        _iconButtons(tester, Icons.pause_circle_outline_rounded);
    expect(pauseButtons, isNotEmpty);
    expect(pauseButtons.every((button) => button.onPressed != null), isTrue);

    await tester.tap(find.text('设备'));
    await tester.pumpAndSettle();
    final pairing = _iconButtons(tester, Icons.key_rounded).single;
    expect(pairing.onPressed, isNull);
    final revoke = _iconButtons(tester, Icons.block_rounded).single;
    expect(revoke.onPressed, isNotNull);
  });

  testWidgets('schedule stale action refreshes and preserves conflict error',
      (tester) async {
    var scheduleLists = 0;
    var pausePosts = 0;
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      responseFor: (request) {
        if (request.url.path.endsWith('/schedules')) {
          scheduleLists++;
          return _automationResponse(
            items: [_scheduleItem(version: scheduleLists == 1 ? 4 : 5)],
          );
        }
        if (request.method == 'POST' &&
            request.url.path.endsWith('/schedules/daily-readiness/pause')) {
          pausePosts++;
          return (
            409,
            {
              'ok': false,
              'error': 'version_conflict',
              'items': [],
              'trace_id': 'stale-trace',
            }
          );
        }
        return null;
      },
    );

    expect(find.textContaining('v4'), findsWidgets);
    await tester.tap(find.byTooltip('暂停'));
    await tester.pumpAndSettle();

    expect(pausePosts, 1);
    expect(scheduleLists, 2);
    expect(find.textContaining('version_conflict'), findsOneWidget);
    expect(find.textContaining('status=409'), findsOneWidget);
    expect(find.textContaining('v5'), findsWidgets);
  });

  testWidgets('execute-only schedule permission enables trigger but not resume',
      (tester) async {
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      permissions: const ['read', 'execute'],
    );

    final configure = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, '配置计划'),
    );
    expect(configure.onPressed, isNull);
    final trigger = _iconButtons(tester, Icons.play_arrow_rounded).single;
    expect(trigger.tooltip, '立即触发');
    expect(trigger.onPressed, isNotNull);
    final pause = _iconButtons(tester, Icons.pause_circle_outline_rounded)
        .where((button) => button.tooltip == '暂停')
        .single;
    expect(pause.onPressed, isNull);

    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      permissions: const ['read', 'execute'],
      responseFor: (request) {
        if (request.url.path.endsWith('/schedules')) {
          return _automationResponse(items: [
            _scheduleItem(version: 6, status: 'paused'),
          ]);
        }
        return null;
      },
    );
    final resume = _iconButtons(tester, Icons.play_circle_outline_rounded)
        .where((button) => button.tooltip == '恢复')
        .single;
    expect(resume.onPressed, isNull);
  });

  testWidgets(
      'paused schedule resume is execute-gated while history is openable',
      (tester) async {
    await _pumpAutomationPage(
      tester,
      initialTabIndex: 2,
      permissions: const ['read', 'write', 'config'],
      responseFor: (request) {
        if (request.url.path.endsWith('/schedules')) {
          return _automationResponse(items: [
            _scheduleItem(version: 6, status: 'paused'),
          ]);
        }
        return null;
      },
    );

    expect(_iconButtons(tester, Icons.pause_circle_outline_rounded), isEmpty);
    final resume = _iconButtons(tester, Icons.play_circle_outline_rounded)
        .where((button) => button.tooltip == '恢复')
        .single;
    expect(resume.onPressed, isNull);

    await tester.tap(find.byTooltip('历史'));
    await tester.pumpAndSettle();
    expect(find.text('run-history-1'), findsOneWidget);
    expect(find.textContaining('scheduled readiness'), findsOneWidget);
    expect(find.byTooltip('打开运行'), findsOneWidget);
  });
}

List<IconButton> _iconButtons(WidgetTester tester, IconData icon) {
  return tester
      .widgetList<IconButton>(find.byType(IconButton))
      .where(
          (button) => button.icon is Icon && (button.icon as Icon).icon == icon)
      .toList();
}

Future<void> _pumpAutomationPage(
  WidgetTester tester, {
  required int initialTabIndex,
  List<String> permissions = const ['read', 'write', 'execute', 'config'],
  void Function(http.Request request)? onRequest,
  (int, Map<String, dynamic>)? Function(http.Request request)? responseFor,
}) async {
  tester.view.physicalSize = const Size(1200, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api = HermesApiClient(
    settings: const ConnectionSettings(
      baseUrl: 'https://example.org',
      token: 'test',
      workspaceId: 'ws',
    ),
    httpClient: MockClient((request) async {
      onRequest?.call(request);
      final custom = responseFor?.call(request);
      if (custom != null) {
        return http.Response(jsonEncode(custom.$2), custom.$1);
      }
      return http.Response(
        jsonEncode(_responseFor(request, permissions: permissions)),
        200,
      );
    }),
  );
  addTearDown(api.close);

  await tester.pumpWidget(
    ProviderScope(
      retry: (_, __) => null,
      overrides: [
        settingsProvider.overrideWith(TestSettings.new),
        workspaceSelectionProvider.overrideWithValue('ws'),
        readinessProvider.overrideWith(
          (ref) async => HermesEnvelope.fromJson({
            'ok': true,
            'items': [],
            'permissions': permissions,
          }),
        ),
        apiProvider.overrideWithValue(api),
      ],
      child: MaterialApp(
        home: Scaffold(body: AutomationPage(initialTabIndex: initialTabIndex)),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Map<String, dynamic> _responseFor(
  http.Request request, {
  List<String> permissions = const ['read', 'write', 'execute', 'config'],
}) {
  final path = request.url.path;
  if (path.endsWith('/agents/catalog')) {
    return {
      'ok': true,
      'items': [
        {
          'id': 'codex-reviewer',
          'provider': 'codex',
          'available': true,
          'executable': true,
          'auth': 'provider-managed',
        }
      ],
      'permissions': permissions,
    };
  }
  if (request.method == 'GET' &&
      path.endsWith('/schedules/daily-readiness/history')) {
    return _automationResponse(
      items: [
        {
          'id': 'run-history-1',
          'kind': 'runs',
          'version': 8,
          'status': 'completed',
          'data': {
            'title': 'scheduled readiness',
            'schedule': {'id': 'daily-readiness'},
          },
        }
      ],
      permissions: permissions,
    ).$2;
  }
  if (request.method == 'POST' && path.contains('/schedules/')) {
    final body = request.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(request.body) as Map<String, dynamic>;
    return {
      'ok': true,
      'summary': {'dry_run': body['dry_run'] == true},
      'items': [
        {'id': 'schedule-preview', 'phase': 'preview'}
      ],
      'permissions': permissions,
      'trace_id': 'trace',
    };
  }
  if (request.method == 'POST' && path.endsWith('/dispatch')) {
    final body = request.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(request.body) as Map<String, dynamic>;
    return {
      'ok': true,
      'summary': {'dry_run': body['dry_run'] == true},
      'items': [
        {'id': 'remote-preview', 'phase': 'preview'}
      ],
      'permissions': permissions,
      'trace_id': 'trace',
    };
  }
  if (request.method == 'POST' && path.endsWith('/devices')) {
    final body = request.body.isEmpty
        ? const <String, dynamic>{}
        : jsonDecode(request.body) as Map<String, dynamic>;
    final data = (body['data'] as Map?)?.cast<String, dynamic>() ??
        const <String, dynamic>{};
    final unsupported = data.keys.toSet().difference({
      'title',
      'name',
      'platform',
    });
    if (unsupported.isNotEmpty) {
      return {
        'ok': false,
        'error': 'server_owned_fields',
        'items': [],
        'trace_id': 'device-contract',
      };
    }
  }
  if (path.endsWith('/agent-dispatch')) {
    return {
      'ok': true,
      'summary': {'dry_run': request.method == 'POST'},
      'items': [
        {'id': 'dispatch-preview', 'phase': 'preview'}
      ],
      'permissions': permissions,
      'trace_id': 'trace',
    };
  }
  final items = switch (path.split('/').last) {
    'agents' => [
        {
          'id': 'agent-1',
          'kind': 'agents',
          'version': 2,
          'status': 'active',
          'data': {
            'title': 'Codex Agent',
            'provider': 'codex',
            'model': '',
            'instructions': '',
            'timeout_seconds': 300,
          },
        }
      ],
    'squads' => [
        {
          'id': 'squad-1',
          'kind': 'squads',
          'version': 3,
          'status': 'active',
          'data': {
            'title': 'Delivery Squad',
            'members': [
              {
                'agent_id': 'agent-1',
                'role': 'leader',
                'instructions': '',
              }
            ],
          },
        }
      ],
    'schedules' => [_scheduleItem()],
    'devices' => [
        {
          'id': 'device-1',
          'kind': 'devices',
          'version': 5,
          'status': 'active',
          'data': {
            'title': 'Desktop worker',
            'platform': 'desktop',
            'endpoint': 'local',
          },
        }
      ],
    'tasks' => [
        {
          'id': 'task-1',
          'kind': 'tasks',
          'version': 3,
          'status': 'active',
          'data': {'title': 'Automation Task'},
        }
      ],
    'runs' => [
        {
          'id': 'run-1',
          'kind': 'runs',
          'version': 1,
          'status': 'planned',
          'data': {
            'title': 'Previous Run',
            'schedule': {'id': 'daily-readiness'},
          },
        }
      ],
    _ => <Map<String, dynamic>>[],
  };
  return {
    'ok': true,
    'summary': {'total': items.length},
    'items': items,
    'permissions': permissions,
    'trace_id': 'trace',
  };
}

(int, Map<String, dynamic>) _automationResponse({
  required List<Map<String, dynamic>> items,
  List<String> permissions = const ['read', 'write', 'execute', 'config'],
}) {
  return (
    200,
    {
      'ok': true,
      'summary': {'total': items.length},
      'items': items,
      'permissions': permissions,
      'trace_id': 'trace',
    }
  );
}

Map<String, dynamic> _scheduleItem({
  int version = 4,
  String status = 'active',
}) {
  return {
    'id': 'daily-readiness',
    'kind': 'schedules',
    'version': version,
    'status': status,
    'data': {
      'title': 'Daily readiness',
      'interval_seconds': 300,
      'starts_at': '2026-09-08T00:00:00Z',
      'next_due_at': '2026-09-08T00:05:00Z',
      'nodes': [
        {
          'id': 'check',
          'kind': 'command',
          'argv': ['python3', 'scripts/hermes-readiness.py', '--json'],
          'timeout_seconds': 300,
        }
      ],
      'enabled': status != 'paused',
      'misfire_coalesce': true,
    },
  };
}
