# Changelog

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
