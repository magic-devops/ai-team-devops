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
  final String? target_basis;
  final String? target_device_id;
  final List<Node>? test_nodes;
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
    this.target_basis,
    this.target_device_id,
    this.test_nodes,
  });
}

class ChannelConfigure {
  final String idempotency_key;
  final List<String> members;
  final String title;
  final bool? archived;
  final String? description;
  final bool? dry_run;
  final int? expected_version;
  const ChannelConfigure({
    required this.idempotency_key,
    required this.members,
    required this.title,
    this.archived,
    this.description,
    this.dry_run,
    this.expected_version,
  });
}

class CollaborationAction {
  final String idempotency_key;
  final bool? dry_run;
  final int? expected_version;
  const CollaborationAction({
    required this.idempotency_key,
    this.dry_run,
    this.expected_version,
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

class DeviceRuntimePolicy {
  final List<String> allowed_providers;
  final List<String> allowed_runtimes;
  final int expected_version;
  final String idempotency_key;
  final bool? dry_run;
  const DeviceRuntimePolicy({
    required this.allowed_providers,
    required this.allowed_runtimes,
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

class MarkRead {
  final String channel_id;
  final int cursor;
  final String idempotency_key;
  final bool? dry_run;
  final int? expected_version;
  final String? thread_id;
  const MarkRead({
    required this.channel_id,
    required this.cursor,
    required this.idempotency_key,
    this.dry_run,
    this.expected_version,
    this.thread_id,
  });
}

class MessageEdit {
  final String body;
  final String idempotency_key;
  final bool? dry_run;
  final int? expected_version;
  final List<String>? mentions;
  const MessageEdit({
    required this.body,
    required this.idempotency_key,
    this.dry_run,
    this.expected_version,
    this.mentions,
  });
}

class MessageSend {
  final String body;
  final String channel_id;
  final String idempotency_key;
  final String thread_id;
  final bool? dry_run;
  final int? expected_version;
  final List<String>? mentions;
  final String? parent_id;
  final List<String>? recipients;
  const MessageSend({
    required this.body,
    required this.channel_id,
    required this.idempotency_key,
    required this.thread_id,
    this.dry_run,
    this.expected_version,
    this.mentions,
    this.parent_id,
    this.recipients,
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

class ProviderCapability {
  final bool executable_present;
  final String id;
  final String? auth;
  final String? version;
  const ProviderCapability({
    required this.executable_present,
    required this.id,
    this.auth,
    this.version,
  });
}

class RemoteClaim {
  final String idempotency_key;
  final List<String>? runtime_capabilities;
  final String? worker_id;
  final String? worker_version;
  const RemoteClaim({
    required this.idempotency_key,
    this.runtime_capabilities,
    this.worker_id,
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
  final List<Node> nodes;
  final String title;
  final ScheduleTrigger trigger;
  final bool? dry_run;
  final bool? enabled;
  final int? expected_version;
  final bool? misfire_coalesce;
  const ScheduleConfigure({
    required this.idempotency_key,
    required this.nodes,
    required this.title,
    required this.trigger,
    this.dry_run,
    this.enabled,
    this.expected_version,
    this.misfire_coalesce,
  });
}

class ScheduleTrigger {
  final String? cron_expression;
  final int? interval_seconds;
  final int? max_body_bytes;
  final String? secret_ref;
  final String? starts_at;
  final String? timezone;
  final String? type;
  const ScheduleTrigger({
    this.cron_expression,
    this.interval_seconds,
    this.max_body_bytes,
    this.secret_ref,
    this.starts_at,
    this.timezone,
    this.type,
  });
}

class TaskDispatch {
  final int expected_version;
  final String idempotency_key;
  final List<Node> nodes;
  final String? base_commit;
  final bool? dry_run;
  final String? isolation;
  final String? target_basis;
  final String? target_device_id;
  const TaskDispatch({
    required this.expected_version,
    required this.idempotency_key,
    required this.nodes,
    this.base_commit,
    this.dry_run,
    this.isolation,
    this.target_basis,
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

class ThreadCreate {
  final String channel_id;
  final String idempotency_key;
  final String title;
  final String? body;
  final bool? dry_run;
  final int? expected_version;
  final List<String>? mentions;
  final List<String>? recipients;
  const ThreadCreate({
    required this.channel_id,
    required this.idempotency_key,
    required this.title,
    this.body,
    this.dry_run,
    this.expected_version,
    this.mentions,
    this.recipients,
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

class WorkerPresence {
  final String idempotency_key;
  final List<ProviderCapability> providers;
  final List<String> runtime_capabilities;
  final String worker_id;
  final String worker_version;
  const WorkerPresence({
    required this.idempotency_key,
    required this.providers,
    required this.runtime_capabilities,
    required this.worker_id,
    required this.worker_version,
  });
}
