enum Resource {
  workspaces('workspaces', scoped: false),
  sessions('sessions'),
  runs('runs'),
  assets('assets'),
  devices('devices'),
  agents('agents'),
  squads('squads'),
  tasks('tasks'),
  requirements('requirements'),
  schedules('schedules');

  const Resource(this.path, {this.scoped = true});

  final String path;
  final bool scoped;
}

class ConnectionSettings {
  const ConnectionSettings({
    this.baseUrl,
    this.token,
    this.tokenFile,
    this.workspaceId,
    this.localPid,
  });

  final String? baseUrl;
  final String? token;
  final String? tokenFile;
  final String? workspaceId;
  final int? localPid;

  bool get hasBaseUrl => baseUrl != null && baseUrl!.isNotEmpty;

  bool get isConfigured => hasBaseUrl && token != null && token!.isNotEmpty;

  ConnectionSettings copyWith({
    String? baseUrl,
    String? token,
    String? tokenFile,
    String? workspaceId,
    int? localPid,
    bool clearWorkspace = false,
  }) {
    return ConnectionSettings(
      baseUrl: baseUrl ?? this.baseUrl,
      token: token ?? this.token,
      tokenFile: tokenFile ?? this.tokenFile,
      workspaceId: clearWorkspace ? null : workspaceId ?? this.workspaceId,
      localPid: localPid ?? this.localPid,
    );
  }
}

class HermesBootstrapReady {
  const HermesBootstrapReady({
    required this.url,
    required this.tokenFile,
    required this.pid,
  });

  final String url;
  final String tokenFile;
  final int pid;

  factory HermesBootstrapReady.fromJson(Map<String, dynamic> json) {
    return HermesBootstrapReady(
      url: json['url'] as String,
      tokenFile: json['token_file'] as String,
      pid: (json['pid'] as num).toInt(),
    );
  }
}

class HermesUnavailableException implements Exception {
  const HermesUnavailableException(this.message);

  final String message;

  @override
  String toString() => message;
}

class HermesApiException implements Exception {
  HermesApiException(this.message, {this.traceId, this.statusCode});

  final String message;
  final String? traceId;
  final int? statusCode;

  @override
  String toString() {
    final trace = traceId == null ? '' : ' trace_id=$traceId';
    final status = statusCode == null ? '' : ' status=$statusCode';
    return '$message$status$trace';
  }
}

class HermesEntity {
  const HermesEntity({
    required this.id,
    required this.kind,
    required this.version,
    required this.status,
    required this.data,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String kind;
  final int version;
  final String status;
  final Map<String, dynamic> data;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  String get title =>
      (data['title'] ?? data['name'] ?? data['workspace_root'] ?? id)
          .toString();

  factory HermesEntity.fromJson(Map<String, dynamic> json) {
    return HermesEntity(
      id: json['id'] as String,
      kind: json['kind'] as String? ?? '',
      version: (json['version'] as num?)?.toInt() ?? 0,
      status: json['status'] as String? ?? '',
      data: Map<String, dynamic>.from(json['data'] as Map? ?? const {}),
      createdAt: DateTime.tryParse(json['created_at'] as String? ?? ''),
      updatedAt: DateTime.tryParse(json['updated_at'] as String? ?? ''),
    );
  }
}

class HermesEnvelope {
  const HermesEnvelope({
    required this.ok,
    required this.scope,
    required this.summary,
    required this.items,
    required this.actions,
    required this.permissions,
    required this.audit,
    required this.traceId,
    this.error,
  });

  final bool ok;
  final Map<String, dynamic> scope;
  final Map<String, dynamic> summary;
  final List<dynamic> items;
  final List<dynamic> actions;
  final List<String> permissions;
  final Map<String, dynamic> audit;
  final String? traceId;
  final Object? error;

  factory HermesEnvelope.fromJson(Map<String, dynamic> json) {
    final items = json['items'];
    return HermesEnvelope(
      ok: json['ok'] == true,
      scope: Map<String, dynamic>.from(json['scope'] as Map? ?? const {}),
      summary: Map<String, dynamic>.from(json['summary'] as Map? ?? const {}),
      items: items is List ? items : const [],
      actions: json['actions'] is List ? json['actions'] as List : const [],
      permissions: (json['permissions'] as List? ?? const []).cast<String>(),
      audit: Map<String, dynamic>.from(json['audit'] as Map? ?? const {}),
      traceId: json['trace_id'] as String?,
      error: json['error'],
    );
  }
}
