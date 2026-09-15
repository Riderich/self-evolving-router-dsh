# Contributing

Use Node.js 22+ and run from the repository root:

```sh
npm ci
npm run check
npm test
```

Default tests do not call a paid model. Docker and installed-profile tests are opt-in; skipped tests are not passes. For current v2 integration coverage:

```sh
node install.js
# Pull the pinned image listed in README first.
npm run doctor
ROUTER_V2_DOCKER_TEST=1 ROUTER_V2_PROFILE_TEST=1 ROUTER_V2_SHARED="$PWD/.sandbox/v2-tests" node --test --test-concurrency=1 tests/v2.test.js tests/v2-profile.test.js tests/curriculum-profile.test.js
```

On Colima, set `ROUTER_DOCKER_CONTEXT=colima`. Ensure the shared directory is visible to Docker. The [CI workflow](.github/workflows/ci.yml) also exercises the maintained legacy integration tests. Live learning benchmarks require explicit credentials and incur model cost; they are not part of the default test suite.

| Area | Entry point |
|---|---|
| Current CLI | `v2.js` |
| Capability storage, routing and development | `lib/v2/` |
| DSH integration | `index.js`, `run.js` |
| Training and frozen evaluation | `benchmarks/` |
| Starter capabilities | `examples/` |
| Regression tests | `tests/` |

Changes to routing, isolation, proof binding or model-call accounting need a regression test demonstrating the changed behavior. Keep the base DSH loop frozen. Do not let model tools write admission answers, sources, budgets or active registry entries directly. A new capability needs explicit scope and fallback. Agent-written tests are evidence, not an independent correctness oracle.

Keep credentials, real requests and provider transcripts out of commits. Use synthetic fixtures. Report the platform, runtime digest and exact test commands in pull requests. Distinguish skipped tests and environment failures from passes. Avoid savings claims based only on avoided model calls; include learning and validation costs.

See [boundaries](docs/BOUNDARIES.md), [troubleshooting](docs/troubleshooting.md) and [security reporting](SECURITY.md).
