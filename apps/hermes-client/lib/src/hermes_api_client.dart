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

  Future<List<String>> actions() async {
    final envelope = await _get('/actions');
    return envelope.items.map((item) => item.toString()).toList();
  }

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
    if (!{Resource.assets, Resource.devices, Resource.schedules}
        .contains(resource)) {
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
  }) async {
    return _request('POST', path, body: body, workspaceId: workspaceId);
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

  String _cleanPath(String value) {
    return value.replaceAll(RegExp(r'^/+'), '').replaceAll(RegExp(r'/+$'), '');
  }
}
