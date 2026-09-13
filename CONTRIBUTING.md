# Contributing

Use Node.js 22+, `npm ci`, then `npm run check` and `npm test`.
Docker integration tests are opt-in; skipped tests are not passes. See README.

Changes to routing, isolation, proof binding or model-call accounting need a
regression test that demonstrates the changed behavior. Keep the base DSH loop
frozen. Do not let model tools write admission answers, sources, budgets or active
registry entries directly. A new capability needs explicit scope and fallback.

Keep credentials, real requests and provider transcripts out of commits. Use
synthetic fixtures in tests. Report the platform, runtime digest and exact test
command in pull requests. Avoid savings claims based only on avoided model calls.
