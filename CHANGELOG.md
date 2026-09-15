# Changelog

## Unreleased — 2026-09-15

- `npm run demo` prepares a fresh zero-API example, downloads the image only when missing and verifies the result; no npm dependency install or DSH profile required.

- Current v2 onboarding, zero-model quick start, experiment results and explicit alpha boundaries.
- Read-only `npm run doctor` checks the pinned runtime, profile and Docker setup.
- CLI respects the configured Docker context, rejects recursive snapshot paths and reports development failure with a nonzero exit code.
- Status no longer creates an uninitialized registry; initialization refuses to overwrite one.
- Legacy rule-object documentation retained separately; contribution and issue templates added.

## 0.1.0-alpha.1 — 2026-09-14

- Python rule objects with immutable revisions, explicit triggers and schemas.
- Pre-model routing with isolated execution and deterministic fallback.
- DSH-native model maintenance: edit drafts, submit, inspect validation failures,
  repair, validate and activate; persistent repair chains and call budgets.
- Trusted verified-history ingestion; scheduling from repeated request families.
- Collection validation, split/merge mapping, disable, revocation and rollback.
- Portable runtime lookup, pinned dependencies and public Python image.

This alpha does not establish net cost savings or general coding-task coverage.

Live acceptance: 15 model calls across two persistent maintenance attempts; four
admission cases passed and a new-file request completed through DSH with zero
network attempts. This is a single-family engineering check, not a savings study.
