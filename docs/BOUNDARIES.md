# Execution and learning boundaries

## Current v2 backend

Generated Python and model-written tests are untrusted. The host owns registry transactions, snapshots, resource limits, call budgets and freeze enforcement. The operator, host filesystem and Docker daemon are outside the hostile-code threat model.

Parsing has no task mount. Execution sees a read-only public snapshot at `/testbed`, excluding hidden entries, links, node_modules and vendor. **This is a visibility filter, not a secret detector.** Publicly named files can contain secrets. Containers have no network, a non-root UID, a read-only root filesystem and bounded resources. Unknown or conflicting interpretations, timeouts and execution errors fall back.

Development has isolated writable capability, scratch and example-task directories plus read-only observed history. Credentials, registry, evaluator and future tasks are not mounted. Commands use new containers while mounted files persist. The model may run arbitrary commands within this boundary; this is not the legacy three-tool editor.

Publication snapshots code inside the container, rejects links, ignores ordinary Python/pytest caches, reproduces agent-declared tests and locked regressions, then atomically changes the active version. These tests are supporting evidence, not an independent semantic oracle. A published program can still be wrong. Rollback restores the published parent in an unfrozen development session. Freeze forbids development and registry changes.

## Data and ordinary fallback

Permitted requests, file/tool outputs, history and development feedback enter the configured provider's context. Ingest only data you authorize it to receive. Do not commit auth files, state or transcripts. Call and context limits do not guarantee successful publication.

**Ordinary DSH fallback retains the base agent's permissions and behavior.** The plugin does not make it universally read-only. Dedicated benchmark solve tools expose only the current read-only task; continuous training explicitly bypasses the router to collect model trajectories.

Current v2 learning starts through explicit develop/training entry points, not an automatic background service. Large histories, concurrent users, malicious host filesystem races and production write automation are not established support targets. Lifecycle overhead can exceed savings.

For the older backend, see [historical v1 boundaries](legacy-boundaries.md). Its verified-history/oracle-assisted admission and rollback semantics differ from v2.
