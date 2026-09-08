class AgentDispatch {
  final int expected_version;
  final String idempotency_key;
  final int target_version;
  final String? agent_id;
  final String? base_commit;
  final bool? dry_run;
  final String? isolation;
  final String? prompt;
  final String? squad_id;
  const AgentDispatch({
    required this.expected_version,
    required this.idempotency_key,
    required this.target_version,
    this.agent_id,
    this.base_commit,
    this.dry_run,
    this.isolation,
    this.prompt,
    this.squad_id,
  });
}

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

class Node {
  final String id;
  final String? agent_id;
  final List<String>? argv;
  final int? expected_exit_code;
  final String? kind;
  final String? prompt;
  final int? timeout_seconds;
  final String? title;
  const Node({
    required this.id,
    this.agent_id,
    this.argv,
    this.expected_exit_code,
    this.kind,
    this.prompt,
    this.timeout_seconds,
    this.title,
  });
}

class PairRedeem {
  final String device_id;
  final String secret;
  const PairRedeem({
    required this.device_id,
    required this.secret,
  });
}

class RemoteClaim {
  final String idempotency_key;
  final String? worker_version;
  const RemoteClaim({
    required this.idempotency_key,
    this.worker_version,
  });
}

class RemoteHeartbeat {
  final String idempotency_key;
  final String owner;
  final String run_id;
  const RemoteHeartbeat({
    required this.idempotency_key,
    required this.owner,
    required this.run_id,
  });
}

class RemoteResult {
  final String idempotency_key;
  final String node_id;
  final String owner;
  final String run_id;
  final Map<String, Object?>? result;
  const RemoteResult({
    required this.idempotency_key,
    required this.node_id,
    required this.owner,
    required this.run_id,
    this.result,
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

class ScheduleConfigure {
  final String idempotency_key;
  final int interval_seconds;
  final List<Node> nodes;
  final String starts_at;
  final String title;
  final bool? dry_run;
  final bool? enabled;
  final int? expected_version;
  final bool? misfire_coalesce;
  const ScheduleConfigure({
    required this.idempotency_key,
    required this.interval_seconds,
    required this.nodes,
    required this.starts_at,
    required this.title,
    this.dry_run,
    this.enabled,
    this.expected_version,
    this.misfire_coalesce,
  });
}

class TaskDispatch {
  final int expected_version;
  final String idempotency_key;
  final List<Node> nodes;
  final String? base_commit;
  final bool? dry_run;
  final String? isolation;
  final String? target_device_id;
  const TaskDispatch({
    required this.expected_version,
    required this.idempotency_key,
    required this.nodes,
    this.base_commit,
    this.dry_run,
    this.isolation,
    this.target_device_id,
  });
}

class TaskReview {
  final String comment;
  final String decision;
  final int expected_version;
  final String idempotency_key;
  final String run_id;
  final int run_version;
  final bool? dry_run;
  const TaskReview({
    required this.comment,
    required this.decision,
    required this.expected_version,
    required this.idempotency_key,
    required this.run_id,
    required this.run_version,
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
