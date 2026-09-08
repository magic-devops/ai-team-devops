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
