import 'dart:convert';
import 'dart:async';

import 'package:http/http.dart' as http;

import 'models.dart';

const hermesApiBasePath = '/api/hermes/v1';

class HermesApiClient {
  HermesApiClient({
    required ConnectionSettings? settings,
    http.Client? httpClient,
  })  : _settings = settings,
        _httpClient = httpClient ?? http.Client();

  final ConnectionSettings? _settings;
  final http.Client _httpClient;

  void close() => _httpClient.close();

  Future<HermesEnvelope> _request(
    String method,
    String path, {
    String? workspaceId,
    Map<String, Object?> query = const {},
    Map<String, dynamic>? body,
    bool authenticated = true,
    bool allowDegradedOkFalse = false,
  }) async {
    final request = http.Request(
        method, _uri(path, query: query, requireToken: authenticated))
      ..followRedirects = false;
    if (authenticated) {
      request.headers.addAll(_headers(workspaceId: workspaceId));
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    try {
      final response = await _httpClient
          .send(request)
          .then(http.Response.fromStream)
          .timeout(const Duration(seconds: 30));
      return _decode(response, allowDegradedOkFalse: allowDegradedOkFalse);
    } on TimeoutException {
      throw const HermesUnavailableException(
          'Hermes request timed out. Refresh state before retrying a write.');
    }
  }

  Future<HermesEnvelope> health() async {
    final settings = _settings;
    if (settings == null || !settings.hasBaseUrl) {
      throw const HermesUnavailableException('No Hermes base URL configured.');
    }
    return _request('GET', '/health', authenticated: false);
  }

  Future<List<Map<String, dynamic>>> actions() async {
    final envelope = await _get('/actions');
    return _maps(envelope);
  }

  Future<List<Map<String, dynamic>>> agentCatalog() async {
    final envelope = await _get('/agents/catalog');
    return _maps(envelope);
  }

  Future<HermesEnvelope> taskDelivery(String taskId,
          {required String workspaceId}) =>
      _get('/tasks/${Uri.encodeComponent(taskId)}/delivery',
          workspaceId: workspaceId);

  Future<HermesEnvelope> workspaceRepository(String workspaceId) =>
      _get('/workspaces/${Uri.encodeComponent(workspaceId)}/repository',
          workspaceId: workspaceId);

  Future<HermesEnvelope> runChanges(String runId,
          {required String workspaceId}) =>
      _get('/runs/${Uri.encodeComponent(runId)}/changes',
          workspaceId: workspaceId);

  Future<HermesEnvelope> taskDispatch(
    String taskId, {
    required String workspaceId,
    required int expectedVersion,
    required List<Map<String, dynamic>> nodes,
    required String idempotencyKey,
    String isolation = 'workspace',
    String? baseCommit,
    String? targetDeviceId,
    bool dryRun = true,
  }) {
    if (isolation == 'git_worktree' &&
        (baseCommit == null || baseCommit.isEmpty)) {
      throw HermesApiException(
          'base_commit is required for git worktree dispatch.');
    }
    if (!{'workspace', 'git_worktree'}.contains(isolation)) {
      throw HermesApiException('Unsupported dispatch isolation: $isolation');
    }
    return _post(
        '/tasks/${Uri.encodeComponent(taskId)}/dispatch',
        {
          'expected_version': expectedVersion,
          'nodes': nodes,
          'idempotency_key': idempotencyKey,
          'isolation': isolation,
          if (baseCommit != null && baseCommit.isNotEmpty)
            'base_commit': baseCommit,
          if (targetDeviceId != null && targetDeviceId.isNotEmpty)
            'target_device_id': targetDeviceId,
          'dry_run': dryRun,
        },
        workspaceId: workspaceId);
  }

  Future<HermesEnvelope> taskAgentDispatch(
    String taskId, {
    required String workspaceId,
    required int expectedVersion,
    required int targetVersion,
    required String prompt,
    required String idempotencyKey,
    String? agentId,
    String? squadId,
    String? targetDeviceId,
    String isolation = 'workspace',
    String? baseCommit,
    bool dryRun = true,
  }) {
    final hasAgent = agentId != null && agentId.isNotEmpty;
    final hasSquad = squadId != null && squadId.isNotEmpty;
    if (taskId.isEmpty) {
      throw HermesApiException('Task is required for agent dispatch.');
    }
    if (hasAgent == hasSquad) {
      throw HermesApiException('Choose exactly one agent or squad.');
    }
    if (targetVersion < 1) {
      throw HermesApiException('target_version is required.');
    }
    if (prompt.trim().isEmpty) {
      throw HermesApiException('Prompt is required for agent dispatch.');
    }
    if (isolation == 'git_worktree' &&
        (baseCommit == null || baseCommit.isEmpty)) {
      throw HermesApiException(
          'base_commit is required for git worktree dispatch.');
    }
    if (!{'workspace', 'git_worktree'}.contains(isolation)) {
      throw HermesApiException('Unsupported dispatch isolation: $isolation');
    }
    return _post(
      '/tasks/${Uri.encodeComponent(taskId)}/agent-dispatch',
      {
        'idempotency_key': idempotencyKey,
        'expected_version': expectedVersion,
        'target_version': targetVersion,
        'dry_run': dryRun,
        if (hasAgent) 'agent_id': agentId,
        if (hasSquad) 'squad_id': squadId,
        if (targetDeviceId != null && targetDeviceId.isNotEmpty)
          'target_device_id': targetDeviceId,
        'prompt': prompt.trim(),
        'isolation': isolation,
        if (baseCommit != null && baseCommit.isNotEmpty)
          'base_commit': baseCommit,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> scheduleConfigure(
    String scheduleId, {
    required String workspaceId,
    required String title,
    required Map<String, dynamic> trigger,
    required List<Map<String, dynamic>> nodes,
    required bool enabled,
    required bool misfireCoalesce,
    required String idempotencyKey,
    int? expectedVersion,
    bool dryRun = true,
  }) {
    if (scheduleId.trim().isEmpty) {
      throw HermesApiException('Schedule ID is required.');
    }
    _validateScheduleTrigger(trigger);
    return _post(
      '/schedules/${Uri.encodeComponent(scheduleId.trim())}/configure',
      {
        'title': title.trim(),
        'trigger': trigger,
        'nodes': nodes,
        'enabled': enabled,
        'misfire_coalesce': misfireCoalesce,
        'idempotency_key': idempotencyKey,
        if (expectedVersion != null) 'expected_version': expectedVersion,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> schedulePreview({
    required String workspaceId,
    required String title,
    required Map<String, dynamic> trigger,
    required List<Map<String, dynamic>> nodes,
    required bool enabled,
    required bool misfireCoalesce,
    required String idempotencyKey,
    int? expectedVersion,
    int runs = 5,
  }) {
    _validateScheduleTrigger(trigger);
    return _post(
      '/schedules/preview',
      {
        'title': title.trim(),
        'trigger': trigger,
        'nodes': nodes,
        'enabled': enabled,
        'misfire_coalesce': misfireCoalesce,
        'idempotency_key': idempotencyKey,
        if (expectedVersion != null) 'expected_version': expectedVersion,
        'dry_run': true,
      },
      workspaceId: workspaceId,
      query: {'runs': runs},
    );
  }

  Future<HermesEnvelope> scheduleAction(
    String scheduleId,
    String action, {
    required String workspaceId,
    required int expectedVersion,
    bool dryRun = false,
  }) {
    if (!{'trigger', 'pause', 'resume'}.contains(action)) {
      throw HermesApiException('Unsupported schedule action: $action');
    }
    return _post(
      '/schedules/${Uri.encodeComponent(scheduleId)}/$action',
      {
        'idempotency_key': _idempotencyKey('schedule-$action-$scheduleId'),
        'expected_version': expectedVersion,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> scheduleWebhookTest(
    String scheduleId, {
    required String workspaceId,
    required int expectedVersion,
    required String idempotencyKey,
    bool dryRun = true,
  }) {
    return _post(
      '/schedules/${Uri.encodeComponent(scheduleId)}/webhook-test',
      {
        'idempotency_key': idempotencyKey,
        'expected_version': expectedVersion,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<List<Map<String, dynamic>>> scheduleHistory(
    String scheduleId, {
    required String workspaceId,
  }) async {
    final envelope = await _get(
      '/schedules/${Uri.encodeComponent(scheduleId)}/history',
      workspaceId: workspaceId,
    );
    return _maps(envelope);
  }

  Future<List<String>> collaborationMembers({
    required String workspaceId,
  }) async {
    final envelope =
        await _get('/collaboration/members', workspaceId: workspaceId);
    return envelope.items
        .whereType<Map>()
        .map((item) => (item['id'] ?? '').toString())
        .where((id) => id.isNotEmpty)
        .toList();
  }

  Future<HermesEnvelope> collaborationChannels({
    required String workspaceId,
    bool includeArchived = false,
  }) {
    return _get('/collaboration/channels', workspaceId: workspaceId, query: {
      'include_archived': includeArchived,
    });
  }

  Future<HermesEnvelope> collaborationConfigureChannel(
    String channelId, {
    required String workspaceId,
    required String title,
    required List<String> members,
    required String description,
    required bool archived,
    required String idempotencyKey,
    int? expectedVersion,
    bool dryRun = true,
  }) {
    if (channelId.trim().isEmpty) {
      throw HermesApiException('Channel ID is required.');
    }
    if (title.trim().isEmpty) {
      throw HermesApiException('Channel title is required.');
    }
    if (members.isEmpty) {
      throw HermesApiException('Select at least one channel member.');
    }
    return _post(
      '/collaboration/channels/${Uri.encodeComponent(channelId.trim())}/configure',
      {
        'title': title.trim(),
        'members': members,
        'description': description.trim(),
        'archived': archived,
        'idempotency_key': idempotencyKey,
        if (expectedVersion != null) 'expected_version': expectedVersion,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> collaborationThreads(
    String channelId, {
    required String workspaceId,
    bool includeArchived = false,
    String cursor = '',
    int limit = 100,
  }) {
    return _get(
      '/collaboration/channels/${Uri.encodeComponent(channelId)}/threads',
      workspaceId: workspaceId,
      query: {
        'include_archived': includeArchived,
        'cursor': cursor,
        'limit': limit,
      },
    );
  }

  Future<HermesEnvelope> collaborationCreateThread({
    required String workspaceId,
    required String channelId,
    required String title,
    required String body,
    required List<String> mentions,
    required List<String> recipients,
    required String idempotencyKey,
    bool dryRun = true,
  }) {
    if (channelId.isEmpty) {
      throw HermesApiException('Select a channel first.');
    }
    if (title.trim().isEmpty) {
      throw HermesApiException('Thread title is required.');
    }
    return _post(
      '/collaboration/threads',
      {
        'channel_id': channelId,
        'title': title.trim(),
        'body': body.trim(),
        'mentions': mentions,
        'recipients': recipients,
        'idempotency_key': idempotencyKey,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> collaborationMessages(
    String threadId, {
    required String workspaceId,
    int after = 0,
    int limit = 100,
  }) {
    return _get(
      '/collaboration/threads/${Uri.encodeComponent(threadId)}/messages',
      workspaceId: workspaceId,
      query: {'after': after, 'limit': limit},
    );
  }

  Future<HermesEnvelope> collaborationSendMessage({
    required String workspaceId,
    required String channelId,
    required String threadId,
    required String parentId,
    required String body,
    required List<String> mentions,
    required List<String> recipients,
    required String idempotencyKey,
    bool dryRun = true,
  }) {
    if (body.trim().isEmpty) {
      throw HermesApiException('Message body is required.');
    }
    return _post(
      '/collaboration/messages',
      {
        'channel_id': channelId,
        'thread_id': threadId,
        'parent_id': parentId,
        'body': body.trim(),
        'mentions': mentions,
        'recipients': recipients,
        'idempotency_key': idempotencyKey,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> collaborationEditMessage(
    String messageId, {
    required String workspaceId,
    required int expectedVersion,
    required String body,
    required List<String> mentions,
    required String idempotencyKey,
    bool dryRun = true,
  }) {
    if (body.trim().isEmpty) {
      throw HermesApiException('Message body is required.');
    }
    return _patch(
      '/collaboration/messages/${Uri.encodeComponent(messageId)}',
      {
        'expected_version': expectedVersion,
        'body': body.trim(),
        'mentions': mentions,
        'idempotency_key': idempotencyKey,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> collaborationArchive(
    String resource,
    String id, {
    required String workspaceId,
    required int expectedVersion,
    required String idempotencyKey,
    bool dryRun = true,
  }) {
    if (!{'threads', 'messages'}.contains(resource)) {
      throw HermesApiException('Unsupported collaboration archive: $resource');
    }
    return _post(
      '/collaboration/$resource/${Uri.encodeComponent(id)}/archive',
      {
        'expected_version': expectedVersion,
        'idempotency_key': idempotencyKey,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> collaborationInbox({
    required String workspaceId,
    int limit = 100,
  }) {
    return _get('/collaboration/inbox',
        workspaceId: workspaceId, query: {'limit': limit});
  }

  Future<HermesEnvelope> collaborationMarkRead({
    required String workspaceId,
    required String channelId,
    required String threadId,
    required int cursor,
    required String idempotencyKey,
    bool dryRun = false,
  }) {
    return _post(
      '/collaboration/read',
      {
        'channel_id': channelId,
        'thread_id': threadId,
        'cursor': cursor,
        'idempotency_key': idempotencyKey,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> devicePairing(
    HermesEntity device, {
    required String workspaceId,
    bool dryRun = false,
  }) {
    return _post(
      '/devices/${Uri.encodeComponent(device.id)}/pairing',
      {
        'idempotency_key': _idempotencyKey('device-pairing-${device.id}'),
        'expected_version': device.version,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> deviceRevoke(
    HermesEntity device, {
    required String workspaceId,
    bool dryRun = false,
  }) {
    return _post(
      '/devices/${Uri.encodeComponent(device.id)}/revoke',
      {
        'idempotency_key': _idempotencyKey('device-revoke-${device.id}'),
        'expected_version': device.version,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> taskReview(
    String taskId, {
    required String workspaceId,
    required int expectedVersion,
    required String runId,
    required int runVersion,
    required String decision,
    required String comment,
    required String idempotencyKey,
    bool dryRun = true,
  }) =>
      _post(
          '/tasks/${Uri.encodeComponent(taskId)}/review',
          {
            'expected_version': expectedVersion,
            'run_id': runId,
            'run_version': runVersion,
            'decision': decision,
            'comment': comment,
            'idempotency_key': idempotencyKey,
            'dry_run': dryRun,
          },
          workspaceId: workspaceId);

  Future<List<HermesEntity>> list(
    Resource resource, {
    String? workspaceId,
    String? q,
    String? status,
    String? kind,
    int limit = 50,
    String? cursor,
  }) async {
    final envelope = await _get(
      '/${resource.path}',
      workspaceId: resource.scoped ? workspaceId : null,
      query: {
        'q': q,
        'status': status,
        'kind': kind,
        'limit': limit,
        'cursor': cursor,
      },
    );
    return _entities(envelope);
  }

  Future<HermesEntity> get(
    Resource resource,
    String id, {
    String? workspaceId,
  }) async {
    final envelope = await _get(
      '/${resource.path}/$id',
      workspaceId: resource.scoped ? workspaceId : null,
    );
    return _singleEntity(envelope);
  }

  Future<HermesEntity> create(
    Resource resource,
    Map<String, dynamic> data, {
    String? workspaceId,
    String? idempotencyKey,
  }) async {
    final envelope = await _post(
      '/${resource.path}',
      {
        'data': data,
        'idempotency_key':
            idempotencyKey ?? _idempotencyKey('create-${resource.path}'),
      },
      workspaceId: resource.scoped ? workspaceId : null,
    );
    return _singleEntity(envelope);
  }

  Future<HermesEntity> patch(
    Resource resource,
    HermesEntity entity,
    Map<String, dynamic> data, {
    String? workspaceId,
  }) async {
    final envelope = await _patch(
      '/${resource.path}/${entity.id}',
      {
        'data': data,
        'idempotency_key':
            _idempotencyKey('patch-${resource.path}-${entity.id}'),
        'expected_version': entity.version,
      },
      workspaceId: resource.scoped ? workspaceId : null,
    );
    return _singleEntity(envelope);
  }

  Future<void> delete(
    Resource resource,
    HermesEntity entity, {
    String? workspaceId,
    bool dryRun = false,
  }) async {
    if (resource != Resource.assets) {
      throw HermesApiException('Delete is not supported for ${resource.path}.');
    }
    await _delete(
      '/${resource.path}/${entity.id}',
      {
        'idempotency_key':
            _idempotencyKey('delete-${resource.path}-${entity.id}'),
        'expected_version': entity.version,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<List<Map<String, dynamic>>> runEvents(
    String runId, {
    String? workspaceId,
    int after = 0,
  }) async {
    final envelope = await _get(
      '/runs/$runId/events',
      workspaceId: workspaceId,
      query: {'after': after},
    );
    return _maps(envelope);
  }

  Future<HermesEnvelope> runAction(
    String runId,
    String action, {
    required int expectedVersion,
    required String workspaceId,
    bool dryRun = false,
  }) {
    if (!{'start', 'cancel', 'retry', 'replay', 'export'}.contains(action)) {
      throw HermesApiException('Unsupported run action: $action');
    }
    return _post(
      '/runs/$runId/$action',
      {
        'idempotency_key': _idempotencyKey('run-$action-$runId'),
        'expected_version': expectedVersion,
        'dry_run': dryRun,
      },
      workspaceId: workspaceId,
    );
  }

  Future<List<HermesEntity>> approvals({String? workspaceId}) async {
    final envelope = await _get('/approvals', workspaceId: workspaceId);
    return _entities(envelope);
  }

  Future<HermesEnvelope> decideApproval(
    HermesEntity approval, {
    required String decision,
    required String workspaceId,
  }) {
    if (!{'approve', 'reject'}.contains(decision)) {
      throw HermesApiException('Unsupported approval decision: $decision');
    }
    return _post(
      '/approvals/${approval.id}/decision',
      {
        'decision': decision,
        'idempotency_key': _idempotencyKey('approval-$decision-${approval.id}'),
        'expected_version': approval.version,
      },
      workspaceId: workspaceId,
    );
  }

  Future<List<Map<String, dynamic>>> sync({
    String? workspaceId,
    int after = 0,
  }) async {
    final envelope = await _get(
      '/sync',
      workspaceId: workspaceId,
      query: {'after': after},
    );
    return _maps(envelope);
  }

  Future<HermesEnvelope> readiness() {
    return _get('/system/readiness', allowDegradedOkFalse: true);
  }

  Future<HermesEnvelope> diagnostics() {
    return _get('/system/diagnostics', allowDegradedOkFalse: true);
  }

  Future<HermesEnvelope> _get(
    String path, {
    String? workspaceId,
    Map<String, Object?> query = const {},
    bool allowDegradedOkFalse = false,
  }) async {
    return _request(
      'GET',
      path,
      query: query,
      workspaceId: workspaceId,
      allowDegradedOkFalse: allowDegradedOkFalse,
    );
  }

  Future<HermesEnvelope> _post(
    String path,
    Map<String, dynamic> body, {
    String? workspaceId,
    Map<String, Object?> query = const {},
  }) async {
    return _request(
      'POST',
      path,
      query: query,
      body: body,
      workspaceId: workspaceId,
    );
  }

  Future<HermesEnvelope> _patch(
    String path,
    Map<String, dynamic> body, {
    String? workspaceId,
  }) async {
    return _request('PATCH', path, body: body, workspaceId: workspaceId);
  }

  Future<void> _delete(
    String path,
    Map<String, dynamic> body, {
    String? workspaceId,
  }) async {
    await _request('DELETE', path, body: body, workspaceId: workspaceId);
  }

  Uri _uri(
    String path, {
    Map<String, Object?> query = const {},
    bool requireToken = true,
  }) {
    final settings = _settings;
    if (settings == null ||
        !settings.hasBaseUrl ||
        (requireToken && !settings.isConfigured)) {
      throw const HermesUnavailableException(
        'Hermes core is unavailable. Configure a remote core or bootstrap a local core in Settings.',
      );
    }
    final base = Uri.parse(settings.baseUrl!);
    if (!{'http', 'https'}.contains(base.scheme) ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment ||
        (base.scheme == 'http' &&
            !{'localhost', '127.0.0.1', '::1'}.contains(base.host))) {
      throw const HermesUnavailableException(
          'Remote connections require HTTPS. Only loopback HTTP is allowed.');
    }
    final normalizedPath = [
      if (!_cleanPath(base.path).endsWith(_cleanPath(hermesApiBasePath)))
        _cleanPath(base.path),
      _cleanPath(hermesApiBasePath),
      _cleanPath(path),
    ].where((part) => part.isNotEmpty).join('/');
    return base.replace(
      path: '/$normalizedPath',
      queryParameters: {
        for (final entry in query.entries)
          if (entry.value != null && entry.value.toString().isNotEmpty)
            entry.key: entry.value.toString(),
      },
    );
  }

  Map<String, String> _headers({
    String? workspaceId,
    bool jsonBody = false,
  }) {
    final settings = _settings;
    if (settings == null || !settings.isConfigured) {
      throw const HermesUnavailableException(
        'Hermes core is unavailable. Configure a remote core or bootstrap a local core in Settings.',
      );
    }
    return {
      'Authorization': 'Bearer ${settings.token}',
      if (workspaceId != null && workspaceId.isNotEmpty)
        'X-Workspace-Id': workspaceId,
      if (jsonBody) 'Content-Type': 'application/json',
    };
  }

  HermesEnvelope _decode(
    http.Response response, {
    bool allowDegradedOkFalse = false,
  }) {
    if (response.statusCode >= 300 && response.statusCode < 400) {
      throw HermesApiException('Redirect refused. Verify the Hermes endpoint.',
          statusCode: response.statusCode);
    }
    if (response.body.isEmpty) {
      throw HermesApiException('Hermes returned an empty response.');
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } on FormatException {
      throw HermesApiException('Hermes returned a malformed response.',
          statusCode: response.statusCode);
    }
    if (decoded is! Map<String, dynamic>) {
      throw HermesApiException('Hermes returned a malformed response.',
          statusCode: response.statusCode);
    }
    final body = decoded;
    final envelope = HermesEnvelope.fromJson(body);
    if (allowDegradedOkFalse && !_isStructuredProbeEnvelope(body)) {
      throw HermesApiException('Hermes probe response was malformed.',
          traceId: envelope.traceId, statusCode: response.statusCode);
    }
    if (response.statusCode >= 400 || (!envelope.ok && !allowDegradedOkFalse)) {
      throw HermesApiException(
        envelope.error?.toString() ?? 'Hermes request failed',
        traceId: envelope.traceId,
        statusCode: response.statusCode,
      );
    }
    return envelope;
  }

  bool _isStructuredProbeEnvelope(Map<String, dynamic> body) {
    final items = body['items'];
    return body['ok'] is bool && items is List;
  }

  List<HermesEntity> _entities(HermesEnvelope envelope) {
    return envelope.items
        .whereType<Map>()
        .map((item) => HermesEntity.fromJson(Map<String, dynamic>.from(item)))
        .toList();
  }

  List<Map<String, dynamic>> _maps(HermesEnvelope envelope) {
    return envelope.items
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  HermesEntity _singleEntity(HermesEnvelope envelope) {
    if (envelope.items.isEmpty || envelope.items.first is! Map) {
      throw HermesApiException(
        'Hermes response did not contain an entity item.',
        traceId: envelope.traceId,
      );
    }
    return HermesEntity.fromJson(
      Map<String, dynamic>.from(envelope.items.first as Map),
    );
  }

  String _idempotencyKey(String prefix) {
    return '$prefix-${DateTime.now().toUtc().microsecondsSinceEpoch}';
  }

  void _validateScheduleTrigger(Map<String, dynamic> trigger) {
    final type = trigger['type'];
    if (type == 'interval') {
      final intervalSeconds = trigger['interval_seconds'];
      if (intervalSeconds is! int || intervalSeconds < 10) {
        throw HermesApiException('interval_seconds must be at least 10.');
      }
      final startsAt = trigger['starts_at'];
      if (startsAt is! String || startsAt.trim().isEmpty) {
        throw HermesApiException(
            'starts_at is required for interval schedules.');
      }
      return;
    }
    if (type == 'cron') {
      final expression = trigger['cron_expression'];
      if (expression is! String ||
          expression.trim().split(RegExp(r'\s+')).length != 5) {
        throw HermesApiException('cron_expression must contain five fields.');
      }
      final timezone = trigger['timezone'];
      if (timezone is! String || timezone.trim().isEmpty) {
        throw HermesApiException('timezone is required for cron schedules.');
      }
      return;
    }
    if (type == 'webhook') {
      final secretRef = trigger['secret_ref'];
      if (secretRef is! String || secretRef.trim().isEmpty) {
        throw HermesApiException(
            'secret_ref is required for webhook schedules.');
      }
      final maxBodyBytes = trigger['max_body_bytes'];
      if (maxBodyBytes is! int || maxBodyBytes < 1 || maxBodyBytes > 1048576) {
        throw HermesApiException(
            'max_body_bytes must be between 1 and 1048576.');
      }
      return;
    }
    throw HermesApiException('Unsupported schedule trigger type: $type');
  }

  String _cleanPath(String value) {
    return value.replaceAll(RegExp(r'^/+'), '').replaceAll(RegExp(r'/+$'), '');
  }
}
