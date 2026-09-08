import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/ui/task_delivery_dialog.dart';

void main() {
  test('stored code changes request retains workspace scope', () async {
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/api/hermes/v1/runs/run-id/changes');
          expect(request.headers['X-Workspace-Id'], 'ws');
          return http.Response(jsonEncode({'ok': true, 'items': []}), 200);
        }));
    await api.runChanges('run-id', workspaceId: 'ws');
    api.close();
  });
  for (final width in [390.0, 1200.0]) {
    testWidgets('delivery preview applies the same plan at width $width',
        (tester) async {
      tester.view.physicalSize = Size(width, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final writes = <Map<String, dynamic>>[];
      final task = {
        'id': 'task',
        'kind': 'tasks',
        'version': 1,
        'status': 'active',
        'data': {'title': 'Delivery', 'acceptance_criteria': 'Verify output'}
      };
      final api = HermesApiClient(
          settings: const ConnectionSettings(
              baseUrl: 'https://example.org', token: 'test'),
          httpClient: MockClient((request) async {
            expect(request.headers['X-Workspace-Id'], 'ws');
            final body = request.method == 'POST'
                ? jsonDecode(request.body) as Map<String, dynamic>
                : null;
            if (body != null) writes.add(body);
            return http.Response(
                jsonEncode({
                  'ok': true,
                  'items': [
                    {
                      'id': 'task',
                      'task': task,
                      'phase': 'unplanned',
                      if (body != null) 'plan': {'nodes': body['nodes']}
                    }
                  ],
                  'permissions': ['read', 'write', 'execute']
                }),
                200);
          }));
      await tester.pumpWidget(ProviderScope(
          overrides: [
            apiProvider.overrideWithValue(api),
            workspaceSelectionProvider.overrideWithValue('ws'),
            tasksProvider.overrideWith((ref) async => []),
            runsProvider.overrideWith((ref) async => []),
          ],
          child: MaterialApp(
              home: Scaffold(
                  body: TaskDeliveryDialog(
                      taskId: 'task', workspaceId: 'ws', client: api)))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.enterText(find.byType(TextField),
          '{"nodes":[{"id":"test","argv":["echo","verified"]}]}');
      await tester.tap(find.text('预览执行计划'));
      await tester.pumpAndSettle();
      expect(writes.single['dry_run'], true);
      await tester.ensureVisible(find.text('确认提交'));
      await tester.tap(find.text('确认提交'));
      await tester.pumpAndSettle();
      expect(writes.length, 2);
      expect(writes.last['dry_run'], false);
      expect(writes.last['idempotency_key'], writes.first['idempotency_key']);
      expect(writes.last['nodes'], writes.first['nodes']);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      api.close();
    });
  }

  testWidgets('git worktree dispatch pins preview and apply fields',
      (tester) async {
    final writes = <Map<String, dynamic>>[];
    final paths = <String>[];
    final task = {
      'id': 'task',
      'kind': 'tasks',
      'version': 1,
      'status': 'active',
      'data': {'title': 'Delivery', 'acceptance_criteria': 'Verify output'}
    };
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async {
          expect(request.headers['X-Workspace-Id'], 'ws');
          paths.add(request.url.path);
          final body = request.method == 'POST'
              ? jsonDecode(request.body) as Map<String, dynamic>
              : null;
          if (body != null) writes.add(body);
          if (request.url.path.endsWith('/workspaces/ws/repository')) {
            return http.Response(
                jsonEncode({
                  'ok': true,
                  'items': [
                    {
                      'id': 'ws',
                      'head_commit': '1234567890abcdef',
                      'root': '/repo',
                      'dirty': true,
                      'branch': 'feature/worktree'
                    }
                  ],
                  'permissions': ['read', 'write', 'execute']
                }),
                200);
          }
          return http.Response(
              jsonEncode({
                'ok': true,
                'items': [
                  {
                    'id': 'task',
                    'task': task,
                    'phase': 'unplanned',
                    if (body != null) 'plan': {'nodes': body['nodes']}
                  }
                ],
                'permissions': ['read', 'write', 'execute']
              }),
              200);
        }));
    await tester.pumpWidget(ProviderScope(
        overrides: [
          apiProvider.overrideWithValue(api),
          workspaceSelectionProvider.overrideWithValue('ws'),
          tasksProvider.overrideWith((ref) async => []),
          runsProvider.overrideWith((ref) async => []),
        ],
        child: MaterialApp(
            home: Scaffold(
                body: TaskDeliveryDialog(
                    taskId: 'task', workspaceId: 'ws', client: api)))));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Git worktree').last);
    await tester.pumpAndSettle();

    expect(paths, contains('/api/hermes/v1/workspaces/ws/repository'));
    expect(find.textContaining('当前提交 1234567890ab'), findsOneWidget);
    expect(find.textContaining('未提交变更'), findsOneWidget);

    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.text('预览执行计划'), 200,
        scrollable: scrollable);
    await tester.tap(find.text('预览执行计划'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('确认提交'), 200,
        scrollable: scrollable);
    await tester.tap(find.text('确认提交'));
    await tester.pumpAndSettle();

    expect(writes.length, 2);
    expect(writes.first['dry_run'], true);
    expect(writes.last['dry_run'], false);
    expect(writes.last['idempotency_key'], writes.first['idempotency_key']);
    expect(writes.last['nodes'], writes.first['nodes']);
    expect(writes.first['isolation'], 'git_worktree');
    expect(writes.last['isolation'], 'git_worktree');
    expect(writes.first['base_commit'], '1234567890abcdef');
    expect(writes.last['base_commit'], '1234567890abcdef');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });

  testWidgets('review renders stored code evidence and diff', (tester) async {
    tester.view.physicalSize = const Size(900, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async => http.Response(
            jsonEncode({
              'ok': true,
              'items': [
                {
                  'id': 'task',
                  'phase': 'awaiting_review',
                  'task': {
                    'id': 'task',
                    'kind': 'tasks',
                    'version': 2,
                    'status': 'in_progress',
                    'data': {
                      'title': 'Review',
                      'acceptance_criteria': 'Review evidence'
                    }
                  },
                  'run': {
                    'id': 'run',
                    'kind': 'runs',
                    'version': 3,
                    'status': 'completed',
                    'data': {
                      'isolation': 'git_worktree',
                      'code_workspace': {
                        'root': '/repo/.worktrees/run',
                        'base_commit': 'aaaaaaaaaaaabbbb',
                        'mode': 'git_worktree'
                      },
                      'code_evidence': {
                        'base_commit': 'aaaaaaaaaaaabbbb',
                        'head_commit': 'bbbbbbbbbbbbcccc',
                        'patch': 'diff --git a/lib/a.dart b/lib/a.dart\n+ok',
                        'files': [
                          {'path': 'lib/a.dart', 'status': 'modified'}
                        ],
                        'untracked': ['notes.txt'],
                        'truncated': true,
                        'complete': false,
                        'status_porcelain': ' M lib/a.dart\n?? notes.txt',
                        'captured_at': '2026-09-08T00:00:00Z',
                        'sha256': 'abc123'
                      }
                    }
                  }
                }
              ],
              'permissions': ['read', 'approve']
            }),
            200)));
    await tester.pumpWidget(ProviderScope(
        overrides: [
          apiProvider.overrideWithValue(api),
          workspaceSelectionProvider.overrideWithValue('ws')
        ],
        child: MaterialApp(
            home: Scaffold(
                body: TaskDeliveryDialog(
                    taskId: 'task', workspaceId: 'ws', client: api)))));
    await tester.pumpAndSettle();

    expect(find.text('代码变更证据'), findsOneWidget);
    expect(find.textContaining('变更证据已截断'), findsOneWidget);
    expect(find.textContaining('代码证据不完整'), findsOneWidget);
    expect(find.textContaining('base aaaaaaaaaaaa'), findsOneWidget);
    await tester.tap(find.text('变更文件 (1)'));
    await tester.pumpAndSettle();
    expect(find.text('lib/a.dart'), findsOneWidget);
    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.text('代码 diff'), 200,
        scrollable: scrollable);
    await tester.tap(find.text('代码 diff'));
    await tester.pumpAndSettle();
    expect(find.textContaining('diff --git a/lib/a.dart b/lib/a.dart'),
        findsOneWidget);
    await tester.scrollUntilVisible(find.byType(TextField), 200,
        scrollable: scrollable);
    expect(find.byType(TextField), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });

  testWidgets('incomplete evidence disables accept but keeps request changes',
      (tester) async {
    tester.view.physicalSize = const Size(900, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final writes = <Map<String, dynamic>>[];
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async {
          final body = request.method == 'POST'
              ? jsonDecode(request.body) as Map<String, dynamic>
              : null;
          if (body != null) writes.add(body);
          return http.Response(
              jsonEncode({
                'ok': true,
                'items': [
                  {
                    'id': 'task',
                    'phase': 'awaiting_review',
                    'task': {
                      'id': 'task',
                      'kind': 'tasks',
                      'version': 2,
                      'status': 'in_progress',
                      'data': {
                        'title': 'Review',
                        'acceptance_criteria': 'Review evidence'
                      }
                    },
                    'run': {
                      'id': 'run',
                      'kind': 'runs',
                      'version': 3,
                      'status': 'completed',
                      'data': {
                        'isolation': 'git_worktree',
                        'code_evidence': {
                          'complete': false,
                          'truncated': false,
                          'untracked': [],
                          'files': [],
                          'status_porcelain': ' m submodule'
                        }
                      }
                    },
                    if (body != null) 'review': body
                  }
                ],
                'permissions': ['read', 'approve']
              }),
              200);
        }));
    await tester.pumpWidget(ProviderScope(
        overrides: [
          apiProvider.overrideWithValue(api),
          workspaceSelectionProvider.overrideWithValue('ws'),
          tasksProvider.overrideWith((ref) async => []),
          runsProvider.overrideWith((ref) async => []),
        ],
        child: MaterialApp(
            home: Scaffold(
                body: TaskDeliveryDialog(
                    taskId: 'task', workspaceId: 'ws', client: api)))));
    await tester.pumpAndSettle();

    final scrollable = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(find.byType(TextField), 200,
        scrollable: scrollable);
    await tester.enterText(find.byType(TextField), 'needs more evidence');
    await tester.pumpAndSettle();
    final preview = find.text('预览审查结论');
    await tester.tap(preview);
    await tester.pumpAndSettle();

    expect(writes.single['decision'], 'request_changes');
    expect(writes.single['dry_run'], true);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });

  testWidgets('accepted phase keeps stored code evidence visible',
      (tester) async {
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async => http.Response(
            jsonEncode({
              'ok': true,
              'items': [
                {
                  'id': 'task',
                  'phase': 'accepted',
                  'task': {
                    'id': 'task',
                    'kind': 'tasks',
                    'version': 4,
                    'status': 'completed',
                    'data': {'title': 'Accepted'}
                  },
                  'run': {
                    'id': 'run',
                    'kind': 'runs',
                    'version': 3,
                    'status': 'completed',
                    'data': {
                      'isolation': 'git_worktree',
                      'code_workspace': {
                        'root': '/repo/.worktrees/run',
                        'base_commit': 'ccccccccccccdddd',
                        'mode': 'git_worktree'
                      },
                      'code_evidence': {
                        'complete': true,
                        'base_commit': 'ccccccccccccdddd',
                        'head_commit': 'ddddddddddddeeee',
                        'patch': '+accepted',
                        'files': [
                          {'path': 'lib/accepted.dart', 'status': 'added'}
                        ],
                        'untracked': [],
                        'truncated': false,
                        'captured_at': '2026-09-08T00:00:00Z',
                        'sha256': 'abc123'
                      }
                    }
                  }
                }
              ],
              'permissions': ['read']
            }),
            200)));
    await tester.pumpWidget(ProviderScope(
        overrides: [
          apiProvider.overrideWithValue(api),
          workspaceSelectionProvider.overrideWithValue('ws')
        ],
        child: MaterialApp(
            home: Scaffold(
                body: TaskDeliveryDialog(
                    taskId: 'task', workspaceId: 'ws', client: api)))));
    await tester.pumpAndSettle();

    expect(find.text('代码变更证据'), findsOneWidget);
    expect(find.text('预览审查结论'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });

  testWidgets('read-only delivery has no write controls', (tester) async {
    final api = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'https://example.org', token: 'test'),
        httpClient: MockClient((request) async => http.Response(
            jsonEncode({
              'ok': true,
              'items': [
                {
                  'id': 'task',
                  'phase': 'unplanned',
                  'task': {
                    'id': 'task',
                    'kind': 'tasks',
                    'version': 1,
                    'status': 'active',
                    'data': {'title': 'Read only'}
                  }
                }
              ],
              'permissions': ['read']
            }),
            200)));
    await tester.pumpWidget(ProviderScope(
        overrides: [
          apiProvider.overrideWithValue(api),
          workspaceSelectionProvider.overrideWithValue('ws')
        ],
        child: MaterialApp(
            home: Scaffold(
                body: TaskDeliveryDialog(
                    taskId: 'task', workspaceId: 'ws', client: api)))));
    await tester.pumpAndSettle();
    expect(find.text('预览执行计划'), findsNothing);
    expect(find.text('确认提交'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    api.close();
  });
}
