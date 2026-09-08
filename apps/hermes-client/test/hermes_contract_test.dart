import 'package:flutter_test/flutter_test.dart';
import 'package:hermes_client/hermes_client.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('entity parser keeps Hermes wire contract fields', () {
    final entity = HermesEntity.fromJson({
      'id': 'run-1',
      'kind': 'run',
      'version': 4,
      'status': 'ready',
      'data': {'title': 'Quality gate'},
      'created_at': '2026-09-08T00:00:00Z',
      'updated_at': '2026-09-08T00:01:00Z',
    });

    expect(entity.id, 'run-1');
    expect(entity.title, 'Quality gate');
    expect(entity.version, 4);
    expect(entity.data['title'], 'Quality gate');
  });

  test('envelope parser guarantees items list fallback', () {
    final envelope = HermesEnvelope.fromJson({
      'ok': true,
      'scope': {'workspace_id': 'w1'},
      'summary': {'total': 0},
      'actions': [],
      'permissions': ['read'],
      'audit': {'actor': 'owner'},
      'trace_id': 'trace-1',
    });

    expect(envelope.ok, isTrue);
    expect(envelope.items, isEmpty);
    expect(envelope.traceId, 'trace-1');
    expect(envelope.permissions, ['read']);
    expect(envelope.audit['actor'], 'owner');
  });

  test('client errors explicitly when core is unavailable', () {
    final client = HermesApiClient(settings: const ConnectionSettings());

    expect(
      () => client.list(Resource.runs),
      throwsA(isA<HermesUnavailableException>()),
    );
  });

  test('real-shaped envelopes and versioned delete use Hermes v1 contract',
      () async {
    final requests = <http.Request>[];
    final client = HermesApiClient(
      settings: const ConnectionSettings(
          baseUrl: 'https://example.org/api/hermes/v1', token: 'test'),
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
            jsonEncode({
              'ok': true,
              'items': [],
              'permissions': ['read', 'write'],
              'audit': {'actor': 'owner'},
            }),
            200);
      }),
    );
    addTearDown(client.close);
    await client.delete(
        Resource.assets,
        HermesEntity.fromJson({
          'id': 'asset',
          'version': 2,
          'kind': 'assets',
          'status': 'active',
        }),
        workspaceId: 'workspace',
        dryRun: true);
    expect(requests.single.url.path, '/api/hermes/v1/assets/asset');
    expect(requests.single.followRedirects, isFalse);
    expect(requests.single.headers['X-Workspace-Id'], 'workspace');
    expect(jsonDecode(requests.single.body)['expected_version'], 2);
    expect(jsonDecode(requests.single.body)['dry_run'], isTrue);
  });

  test('remote cleartext and redirect responses fail closed', () async {
    final insecure = HermesApiClient(
        settings: const ConnectionSettings(
            baseUrl: 'http://example.org', token: 'test'));
    addTearDown(insecure.close);
    await expectLater(insecure.list(Resource.workspaces),
        throwsA(isA<HermesUnavailableException>()));
    final redirected = HermesApiClient(
      settings: const ConnectionSettings(
          baseUrl: 'https://example.org', token: 'test'),
      httpClient: MockClient((request) async => http.Response('', 302)),
    );
    addTearDown(redirected.close);
    await expectLater(redirected.list(Resource.workspaces),
        throwsA(isA<HermesApiException>()));
  });
}
