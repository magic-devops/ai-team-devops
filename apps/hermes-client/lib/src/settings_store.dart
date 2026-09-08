import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

class SecureSettingsStore {
  const SecureSettingsStore();

  static const _storage = FlutterSecureStorage();

  Future<ConnectionSettings> load() async {
    return ConnectionSettings(
      baseUrl: await _storage.read(key: 'hermes.baseUrl'),
      token: await _storage.read(key: 'hermes.token'),
      tokenFile: await _storage.read(key: 'hermes.tokenFile'),
      workspaceId: await _storage.read(key: 'hermes.workspaceId'),
      localPid: int.tryParse(await _storage.read(key: 'hermes.localPid') ?? ''),
    );
  }

  Future<void> save(ConnectionSettings settings) async {
    await _write('hermes.baseUrl', settings.baseUrl);
    await _write('hermes.token', settings.token);
    await _write('hermes.tokenFile', settings.tokenFile);
    await _write('hermes.workspaceId', settings.workspaceId);
    await _write('hermes.localPid', settings.localPid?.toString());
  }

  Future<void> clear() async {
    for (final key in [
      'hermes.baseUrl',
      'hermes.token',
      'hermes.tokenFile',
      'hermes.workspaceId',
      'hermes.localPid',
    ]) {
      await _storage.delete(key: key);
    }
  }

  Future<void> _write(String key, String? value) async {
    if (value == null || value.isEmpty) {
      await _storage.delete(key: key);
    } else {
      await _storage.write(key: key, value: value);
    }
  }
}
