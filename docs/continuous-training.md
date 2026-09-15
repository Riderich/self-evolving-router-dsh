# Continuous-context training experiment

`benchmarks/intercode/curriculum-benchmark.mjs AUTH PUBLIC_FS NEW_OUTPUT` runs two native DSH training sessions and a static seed control. Each learning arm solves 24 sequential tasks across six operations in **one conversation**. The router is bypassed for training; `solve` runs against only the current read-only filesystem, while development uses a separate persistent workspace. `training.submit` returns the next task without correctness feedback. Future tasks, expected answers and evaluator code are never mounted.

In `batch` mode every six submissions opens a development opportunity; the agent can skip it. In `autonomous` mode the opening instruction describes the permission once. The agent explicitly chooses `begin_development` and `end_development`, with no recurring or final development reminder. Both share a 192-call cap including task solving and development. All raw model requests, commands, answers, start/stop decisions, publications, failures and costs are retained. Unfinished training is reported, never silently restarted.

Training uses keyword/argument/constraint variations and altered public InterCode files; requests are authored development material, **not official benchmark scores or sealed data**. Twelve frozen transfer tasks use the same base fallback for all three conditions. Six predeclared rejection probes are reported separately. One run compares scheduling mechanisms; it does not replace the project's five-condition end-to-end evaluation or isolate all effects of data size, batch size and context length.

The model may produce no improvements, too many development attempts, or an incorrect published capability. Agent-authored tests plus locked regressions are supporting development evidence, not independent certification. Full lifecycle costs matter. Raw experiments and credentials are private by default.

Run offline full-session integration with `ROUTER_V2_PROFILE_TEST=1 ROUTER_V2_SHARED=/absolute/docker-shared/path node --test tests/curriculum-profile.test.js`. A pinned DSH installation and Docker image are required as described in `autonomous-v2.md`.

## Explicit responsibility guidance

The original autonomous condition only grants permission. Set `ROUTER_CURRICULUM_GUIDANCE=responsibility` to run the `guided` arm: the opening instruction explicitly makes task completion AND actively judging/improving the router responsibilities. The agent still chooses timing, edits, tests and publication, with no periodic or final reminder. This arm can be compared against the earlier batch control on the identical stream; sequential additions on opened development data are exploratory, not confirmatory. Original permission-only results are preserved.

In the guided arm, completing the last task returns `tasksComplete:true`, leaving the session open. The agent can still enter development, then explicitly call `finish_training`. This fixes an earlier host restriction that rejected genuine development attempts after all tasks were submitted. The original guided run remains failure evidence; it must not be described as absence of initiative.
