# Documentation

**English** | [简体中文](README.zh-CN.md) · [Project home](../README.md)

The project README is available in both languages. Technical guides retain their original language, listed below.

| Start here | Language |
| --- | --- |
| [Installation and usage](getting-started.md) | 中文 |
| [Troubleshooting](troubleshooting.md) | 中文 |
| [Capability and agent design](autonomous-v2.md) | 中文 |
| [Continuous-context training](continuous-training.md) | English |
| [Results and limitations](results.md) | 中文 |
| [Execution and learning boundaries](BOUNDARIES.md) | English |
| [Contributing](../CONTRIBUTING.md) | English |

## Repository map

| Directory | Contents |
| --- | --- |
| `lib/` | Runtime and capability implementation; current backend in `lib/v2/` |
| `examples/` | Starter capabilities and version-specific examples |
| `benchmarks/` | Evaluation runners and protocols |
| `tests/` | Regression and opt-in integration tests |
| `scripts/` | Package checks and environment diagnostics |
| `maintenance-skills/` | Legacy v1 model-maintenance instructions |
| `docs/archive/` | Historical v1 guides; not the current onboarding path |

## Earlier protocols

These documents describe maintained legacy workflows or earlier experiments. Their results must not be mixed with the current continuous-training protocol.

- [v1 rule-object guide](archive/legacy-rule-objects.md)
- [v1 execution boundaries](archive/legacy-boundaries.md)
- [Starter router](starter-router.md)
- [Earlier train/test benchmark](train-test-benchmark.md)
- [InterCode adapter](../benchmarks/intercode/README.md)
