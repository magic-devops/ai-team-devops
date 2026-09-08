import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'hermes_api_client.dart';
import 'models.dart';
import 'settings_controller.dart';
import 'settings_store.dart';

final secureStoreProvider = Provider<SecureSettingsStore>(
  (ref) => const SecureSettingsStore(),
);

final settingsProvider =
    AsyncNotifierProvider<SettingsController, ConnectionSettings>(
  SettingsController.new,
);

final workspaceSelectionProvider = Provider<String?>(
  (ref) => ref.watch(settingsProvider).asData?.value.workspaceId,
);

final apiProvider = Provider<HermesApiClient>((ref) {
  final settings = ref.watch(settingsProvider).asData?.value;
  final client = HermesApiClient(settings: settings);
  ref.onDispose(client.close);
  return client;
});

final workspacesProvider = FutureProvider<List<HermesEntity>>((ref) async {
  final settings = ref.watch(settingsProvider).asData?.value;
  if (settings?.isConfigured != true) return [];
  return ref.watch(apiProvider).list(Resource.workspaces);
});

FutureProvider<List<HermesEntity>> resourceProvider(Resource resource) {
  return FutureProvider<List<HermesEntity>>((ref) async {
    final workspaceId = ref.watch(workspaceSelectionProvider);
    final settings = ref.watch(settingsProvider).asData?.value;
    if (settings?.isConfigured != true) return [];
    if (resource.scoped && workspaceId == null) return [];
    return ref.watch(apiProvider).list(resource, workspaceId: workspaceId);
  });
}

final sessionsProvider = resourceProvider(Resource.sessions);
final tasksProvider = resourceProvider(Resource.tasks);
final requirementsProvider = resourceProvider(Resource.requirements);
final runsProvider = resourceProvider(Resource.runs);
final assetsProvider = resourceProvider(Resource.assets);
final devicesProvider = resourceProvider(Resource.devices);
final schedulesProvider = resourceProvider(Resource.schedules);

final approvalsProvider = FutureProvider<List<HermesEntity>>((ref) async {
  final workspaceId = ref.watch(workspaceSelectionProvider);
  final settings = ref.watch(settingsProvider).asData?.value;
  if (settings?.isConfigured != true) return [];
  if (workspaceId == null) return [];
  return ref.watch(apiProvider).approvals(workspaceId: workspaceId);
});

final healthProvider = FutureProvider<HermesEnvelope>((ref) async {
  return ref.watch(apiProvider).health();
});

final readinessProvider = FutureProvider<HermesEnvelope>((ref) async {
  return ref.watch(apiProvider).readiness();
});

final syncProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final settings = ref.watch(settingsProvider).asData?.value;
  if (settings?.isConfigured != true) return [];
  final workspaceId = ref.watch(workspaceSelectionProvider);
  return ref.watch(apiProvider).sync(workspaceId: workspaceId);
});
