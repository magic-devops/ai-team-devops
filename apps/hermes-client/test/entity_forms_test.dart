import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/src/app_providers.dart';
import 'package:hermes_client/src/hermes_api_client.dart';
import 'package:hermes_client/src/models.dart';
import 'package:hermes_client/src/pages/plan_page.dart';
import 'package:hermes_client/src/settings_controller.dart';
import 'package:hermes_client/src/ui/entity_forms.dart';

class CapturingApiClient extends HermesApiClient {
  CapturingApiClient()
      : super(
          settings: const ConnectionSettings(
            baseUrl: 'https://example.org',
            token: 'token',
          ),
        );

  Resource? patchedResource;
  String? patchedWorkspaceId;
  Map<String, dynamic>? patchedData;
  int patchCalls = 0;
  int createCalls = 0;

  @override
  Future<HermesEntity> patch(
    Resource resource,
    HermesEntity entity,
    Map<String, dynamic> data, {
    String? workspaceId,
  }) async {
    patchCalls += 1;
    patchedResource = resource;
    patchedWorkspaceId = workspaceId;
    patchedData = data;
    return entity;
  }

  @override
  Future<HermesEntity> create(
    Resource resource,
    Map<String, dynamic> data, {
    String? workspaceId,
    String? idempotencyKey,
  }) async {
    createCalls += 1;
    return HermesEntity.fromJson({
      'id': 'created',
      'kind': resource.path,
      'version': 1,
      'status': data['status'],
      'data': data,
    });
  }
}

class MutableSettings extends SettingsController {
  @override
  Future<ConnectionSettings> build() async => const ConnectionSettings(
        baseUrl: 'https://example.org',
        token: 'token',
        workspaceId: 'workspace-a',
      );

  void moveWorkspace(String workspaceId) {
    state = AsyncData(
      ConnectionSettings(
        baseUrl: state.requireValue.baseUrl,
        token: state.requireValue.token,
        workspaceId: workspaceId,
      ),
    );
  }
}

void main() {
  testWidgets('asset edit sends empty strings to clear optional fields',
      (tester) async {
    final api = CapturingApiClient();
    await tester.pumpWidget(_Harness(
      api: api,
      child: Consumer(
        builder: (context, ref, _) => FilledButton(
          onPressed: () => showEntityForm(
            context,
            ref,
            Resource.assets,
            entity: HermesEntity.fromJson({
              'id': 'asset-1',
              'kind': 'assets',
              'version': 2,
              'status': 'active',
              'data': {
                'name': '资产',
                'title': '资产',
                'kind': 'knowledge',
                'source': 'old-source',
                'content': '',
              },
            }),
          ),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, '来源（可选）'), '');
    await tester.tap(find.text('提交'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('请先选择工作区。'), findsNothing);
    expect(find.text('连接设置已变化，请关闭表单后重新打开。'), findsNothing);
    expect(find.text('必填'), findsNothing);
    expect(api.patchCalls, 1);
    expect(api.patchedResource, Resource.assets);
    expect(api.patchedWorkspaceId, 'workspace-a');
    expect(api.patchedData?['source'], '');
    expect(api.patchedData?['kind'], 'knowledge');
  });

  testWidgets('task form aborts when workspace changes after dialog opens',
      (tester) async {
    final api = CapturingApiClient();
    late WidgetRef capturedRef;
    await tester.pumpWidget(_Harness(
      api: api,
      child: Consumer(
        builder: (context, ref, _) {
          capturedRef = ref;
          return FilledButton(
            onPressed: () => showEntityForm(context, ref, Resource.tasks),
            child: const Text('open'),
          );
        },
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    (capturedRef.read(settingsProvider.notifier) as MutableSettings)
        .moveWorkspace('workspace-b');
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextFormField, '标题（1-120 字）'), '任务');
    await tester.tap(find.text('提交'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(api.createCalls, 0);
    expect(find.text('工作区已变化，请关闭表单后重新打开。'), findsOneWidget);
  });

  testWidgets('task and requirement statuses are bounded selectors',
      (tester) async {
    final api = CapturingApiClient();
    await tester.pumpWidget(_Harness(
      api: api,
      child: Consumer(
        builder: (context, ref, _) => FilledButton(
          onPressed: () => showEntityForm(context, ref, Resource.tasks),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.widgetWithText(DropdownButtonFormField<String>, '状态'),
        findsOneWidget);
    expect(find.text('活跃'), findsOneWidget);
    expect(find.text('active'), findsNothing);
    expect(find.widgetWithText(DropdownButtonFormField<String>, '优先级'),
        findsOneWidget);
  });

  testWidgets('plan write actions are disabled without write permission',
      (tester) async {
    await tester.pumpWidget(ProviderScope(
      retry: (_, __) => null,
      overrides: [
        settingsProvider.overrideWith(MutableSettings.new),
        sessionsProvider.overrideWith((ref) async => []),
        tasksProvider.overrideWith((ref) async => []),
        requirementsProvider.overrideWith((ref) async => []),
        readinessProvider.overrideWith((ref) async => const HermesEnvelope(
              ok: true,
              scope: {},
              summary: {'version': '1.0.0'},
              items: [],
              actions: [],
              permissions: ['read'],
              audit: {},
              traceId: null,
            )),
      ],
      child: const MaterialApp(home: Scaffold(body: PlanPage())),
    ));
    await tester.pumpAndSettle();

    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '会话'))
            .onPressed,
        isNull);
    expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '任务'))
            .onPressed,
        isNull);
    expect(
        tester
            .widget<OutlinedButton>(find.widgetWithText(OutlinedButton, '需求'))
            .onPressed,
        isNull);
  });
}

class _Harness extends StatelessWidget {
  const _Harness({required this.api, required this.child});

  final CapturingApiClient api;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      retry: (_, __) => null,
      overrides: [
        settingsProvider.overrideWith(MutableSettings.new),
        apiProvider.overrideWithValue(api),
      ],
      child: Consumer(
        builder: (context, ref, _) {
          ref.watch(settingsProvider);
          return MaterialApp(home: Scaffold(body: child));
        },
      ),
    );
  }
}
