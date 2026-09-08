class Decision {
  final String decision;
  final int expected_version;
  final String idempotency_key;
  final bool? dry_run;
  const Decision({
    required this.decision,
    required this.expected_version,
    required this.idempotency_key,
    this.dry_run,
  });
}

class Envelope {
  final List<Map<String, Object?>> actions;
  final Map<String, Object?> agent_consumption;
  final Map<String, Object?> audit;
  final Map<String, Object?> cli;
  final List<Map<String, Object?>> items;
  final bool ok;
  final List<String> permissions;
  final Map<String, Object?> scope;
  final Map<String, Object?> summary;
  final String trace_id;
  const Envelope({
    required this.actions,
    required this.agent_consumption,
    required this.audit,
    required this.cli,
    required this.items,
    required this.ok,
    required this.permissions,
    required this.scope,
    required this.summary,
    required this.trace_id,
  });
}

class HTTPValidationError {
  final List<ValidationError>? detail;
  const HTTPValidationError({
    this.detail,
  });
}

class Mutation {
  final String idempotency_key;
  final Map<String, Object?>? data;
  final int? expected_version;
  const Mutation({
    required this.idempotency_key,
    this.data,
    this.expected_version,
  });
}

class RunAction {
  final int expected_version;
  final String idempotency_key;
  final bool? dry_run;
  const RunAction({
    required this.expected_version,
    required this.idempotency_key,
    this.dry_run,
  });
}

class ValidationError {
  final List<Object> loc;
  final String msg;
  final String type;
  final Map<String, Object?>? ctx;
  final Object? input;
  const ValidationError({
    required this.loc,
    required this.msg,
    required this.type,
    this.ctx,
    this.input,
  });
}
