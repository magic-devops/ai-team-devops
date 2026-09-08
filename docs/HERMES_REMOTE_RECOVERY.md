# Hermes v1 Remote Worker Recovery

Version: 1.0.0. Scope: outbound command Workers and result delivery.

## Recovery Contract

The Worker records the claimed node before starting `agentd`, then saves the
execution result before uploading it. Restarting drains saved results before
claiming new work. Retries retain the original run, node, owner and idempotency
key. A retry is a result upload, not a new execution attempt.

| Local state | Meaning | Allowed recovery |
| --- | --- | --- |
| `executing` | Command may have started; no durable result is known | Stop and inspect actual side effects; no automatic rerun |
| `pending` | Result saved, no confirmed server acknowledgement | Retry the same result while authorization and lease remain valid |
| `acknowledged` | Server receipt confirmed | Retain local evidence; no upload or execution repeated |
| `quarantined` | Permanent rejection or credential binding mismatch | Stop new claims; investigate identity, lease and server evidence |

Transport failures, HTTP 408/429 and server errors retain pending results.
Authentication failure, revocation, stale ownership and other permanent
rejections do not extend the lease or acquire a new owner. A lost response
after server commit is retried using the same idempotency key.

The outbox is bound to the server, device, workspace and credential generation.
Changing the credential file is not a way to replay old results under a new
identity. Local status does not prove that the device is currently authorized.

## Operator Commands

The bundled executable does not require Python to be installed. The same flags
are forwarded by `sop system remote-worker` on a CLI-enabled installation.

```sh
hermes-core remote-worker --server "$HERMES_URL" \
  --credential-file "$HERMES_DEVICE_CREDENTIAL_FILE" --outbox-status

hermes-core remote-worker --server "$HERMES_URL" \
  --credential-file "$HERMES_DEVICE_CREDENTIAL_FILE" --flush-only

hermes-core remote-worker --server "$HERMES_URL" \
  --credential-file "$HERMES_DEVICE_CREDENTIAL_FILE" \
  --workspace-map "$HERMES_WORKSPACE=$PROJECT_ROOT" \
  --agentd "$HERMES_AGENTD" --once
```

`--outbox-status` is local JSON metadata only. `--flush-only` never claims a task
and does not need an agentd binary or project mapping. `--once` performs at most
one claim, or drains already pending results. Exit 0 means that mode succeeded;
exit 1 means recovery or execution failed; exit 2 for `--once` means no claim
was available (argument parsing errors also use 2).
Exit 0 confirms Worker processing, not task success: a command with a failing
exit code can still have its failure result successfully delivered. Inspect
the run and node evidence for the business outcome.

The default directory is `<credential-file>.outbox`; `--outbox-dir` selects an
explicit directory. Keep one stable outbox per device credential and one
Worker process per outbox. Do not switch directories to bypass a recovery
blocker. Local filesystem locks do not coordinate different machines or
provide network-filesystem lease guarantees.

## Evidence And Safety

On POSIX, the directory is private (0700) and records are private (0600).
Writes use temporary files, file flush and atomic replacement; the directory
is flushed where supported. Corrupt records, unexpected files and unsafe
links fail closed. The outbox can contain command arguments and output,
including business-sensitive content; treat backups as sensitive data.
Credential secrets are not copied into the journal identity fields.

For an uncertain execution, preserve the directory and compare the run events,
actual project changes and external side effects. Do not edit a journal state
to fabricate success. After server-side resolution, any further execution
must be an explicitly authorized new attempt. This release intentionally
does not provide automatic deletion or acknowledgement of uncertain records.
Acknowledged records are retained too; there is no automatic retention job.
Include outbox disk usage in operational monitoring and keep archived evidence
under the same access restrictions. Do not remove active recovery records.

Arbitrary command side effects are not exactly-once. A crash between process
execution and saving its result cannot be resolved from a local journal alone.
Disk failure, filesystem replacement and OS credential compromise are not
solved by retry logic. Windows ACL and real-device crash behavior require
platform-specific acceptance; POSIX permissions are not Windows ACL evidence.
