# Train sequentially, freeze, then test

This is the default protocol for the next benchmark. The previous online B4 runner and its logs are retained for historical reproduction.

Training requests arrive one at a time. The evolving router can retain validated rules, extend them using the verified training prefix, and use the current active rules as few-shot examples. The host supplies independent reference outputs on the actual public training filesystem, including when the base agent's answer was wrong; these references do not turn a wrong training answer into a reported success. No later training question or test reference is given to the maintainer.

After training, every condition is frozen. Testing creates fresh DSH request sessions and uses only its trained registry plus the fixed base-agent fallback. Test results are never observed as training history or passed to maintenance. Router-only correct automation and overall task success are reported separately.

## Focused development split

`benchmarks/intercode/splits/focused-fs1-v1.json` pins the exact InterCode fs1 dataset bytes and source commit.

| Phase | Original task indices | Purpose |
| --- | --- | --- |
| Train, in order | 20, 22, 33 | C/PHP recursive line counts, then recursive file count |
| Test | 28, 40 | New wording for a trained family |
| Test | 56 | Java parameter not present in training requests |
| Test | 0, 17, 53 | Three unseen families; measure fallback and incorrect automation |

These are previously audited development rows, not sealed or previously unseen data. The original queries remain unchanged. Training and testing share the same public filesystem; this measures request/parameter transfer and retained behavior after training another family, not cross-repository transfer. Do not relabel it as a final generalization benchmark.

## Controls

| Condition | Training | Testing |
| --- | --- | --- |
| B0 | Fixed base agent, no router | Same base agent |
| B1 | Three handwritten starter rules, no updates | Frozen starter rules plus fallback |
| B2 | Same seeds; handwritten executors with templates from observed training wording | Frozen training templates plus fallback |
| B3 | Same seeds; one batch learning phase after all training tasks | Frozen trained rules plus fallback |
| B4 | Same seeds; bounded incremental learning after each training task | Frozen trained rules plus fallback |

B3 and B4 have the same cumulative maintenance-call cap and maximum attempt opportunities. All conditions solve the same training and test requests; no training prefix or synthesis cost is free. The preset limits the complete physical run to 160 HTTP requests, including fallback and maintenance, and each learner to 24 maintenance calls. These are explicit ceilings, not promised costs or authorization to launch a paid run. Existing acceptance-script defaults remain unchanged.

## Freeze enforcement

- Maintenance is disabled before testing. The request backend rejects maintenance-enabled sessions and exposes only isolated Bash to the base model.
- Save the full trained state, admission suite, kernel hash and a content digest for each condition. Packages, active revisions, proofs, provenance, histories, drafts, operational state and budget/configuration must remain unchanged.
- Check the digest before and after every test task, including error exits. Preserve the pre-test audit prefix; only route and request-usage events may be appended. A mutation invalidates the run rather than triggering repair or silently continuing.
- Preserve failed tasks and process output. Existing output directories cannot be reused; test failure does not automatically rerun a model or candidate.
- Save dataset, source filesystem, initial seed and benchmark-code hashes. Verify benchmark code did not change during the run.

## Run

From the plugin directory, first inspect the split and exact replay fixtures. This does not read credentials, launch Docker, or call a model:

```sh
node benchmarks/intercode/train-test.mjs --inspect DATA_JSON EXPORTED_FS1 \
  benchmarks/intercode/splits/focused-fs1-v1.json
```

An explicit paid execution uses a fresh Docker-shared output directory:

```sh
ROUTER_DOCKER_CONTEXT=colima node benchmarks/intercode/train-test.mjs \
  PRIVATE_AUTH DATA_JSON EXPORTED_FS1 \
  benchmarks/intercode/splits/focused-fs1-v1.json NEW_OUTPUT
```

On Linux set `ROUTER_DOCKER_CONTEXT=''`. Use the pinned runtime and Docker image described in the main README. The exported directory must contain only the public filesystem, not `.dsh` state. Actual replay files must fit the existing 64-file/128-KiB limit and preserve UTF-8 bytes; preflight rejects incompatible inputs instead of truncating them.

The output contains per-task outputs/oracles, training checkpoints, `B*-frozen.json`, the final report, HTTP usage and tool journals. It reports training and test scores/calls separately, same-family and unseen-family test results, setup and maintenance cost, and end-to-end pipeline timing including reference and freeze checks. Shared/reporting overhead is explicit. Workspace mutation checks do not establish a general unsafe-automation rate; that metric remains unknown. No monetary saving is inferred from avoided calls alone.

For a one-time future audit, collect a new independently reviewed task set after protocol development, group by repository/family where appropriate, commit its split before learning, and never adapt to its outcomes. The current reused-development preset deliberately does not accept a `sealed` label.
