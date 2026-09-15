# Historical v1 boundaries

This document describes the legacy rule-object backend. For v2 see [current boundaries](BOUNDARIES.md).

# Execution and learning boundaries

The trusted host owns the registry, admission cases, model budgets and verified
history. The operator/evaluator certifies outcomes. Ordinary assistant completion
is not verification. History and validation feedback are sent to the configured
model provider; ingest only data you permit it to receive.

The maintenance model receives three tools: `rule`, `rule_skill` and the DSH
`str_replace_editor` schema backed by an isolated editor. The editor mounts only
the current draft read-write. No shell, network, registry or oracle mount is
available. Manifest identity, source IDs and parent revision are rechecked on
submission. Helpers and development tests never replace the trusted admission
oracle. All admitted programs remain read-only.

Trigger containers have no task mount. Executor containers see a public copy at
`/testbed`: no hidden entries, symlinks, node_modules or vendor. This filter is not
a secret detector: do not keep secrets in otherwise public files. The trusted
host filesystem, Docker daemon and operator are outside the hostile-code threat
model. Concurrent malicious host filesystem mutation is not supported. Resource
limits, no network, non-root UID and a read-only root filesystem are mandatory.

A match is accepted only if exactly one rule matches and every other trigger
returns no_match. Any abstention, conflict, timeout, schema failure, changed proof
or environment causes fallback. Routing never asks an LLM to decide.

Validation repeats exact task/output checks against the entire proposed active
collection. Proofs bind the source, kernel, environment, admission suite and
registry generation. Activation rechecks these bindings. Disabling one entry
invalidates the old collection proof until the reduced collection is validated.
Rollback also requires current validation. Split/merge preserve the original
oracle families through a trusted mapping; each new member must activate on a
positive case.

Admission is adaptively queried during repair. It is not a sealed future test and
does not prove behavior beyond the checked scope. A future audit must remain
outside the maintenance input. Model-call reservations persist before dispatch;
uncertain calls are not automatically replayed. Call limits are cumulative per
workspace. Raising the limit is a trusted operator decision.

State and evidence currently use a single atomic JSON store with an exclusive
writer lock. This alpha targets small registries and bounded maintenance jobs;
large histories need an explicit export/archive policy and a scalable journal.
Route duration returned to the caller includes event persistence; the stored
route event records work up to persistence. Container cleanup may exceed the
execution deadline by its bounded cleanup allowance. This is not a hard real-time
system. Do not claim net savings without accounting for this overhead.

The router profile disables automatic LLM session titles for all routing
conditions. Maintenance rejects auxiliary requests (including model compaction)
before dispatch unless they carry the exact maintenance tool surface. When the
context budget is exhausted, use the persistent draft/feedback in a new bounded
attempt; do not make an unaccounted background summary call.
