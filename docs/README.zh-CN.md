# 文档导航

[English](README.md) | **简体中文** · [项目首页](../README.zh-CN.md)

项目 README 提供完整中英两版。技术指南保留原文，语言标注如下。

| 从这里开始 | 语言 |
| --- | --- |
| [安装与使用](getting-started.md) | 中文 |
| [常见问题与排障](troubleshooting.md) | 中文 |
| [能力包与 Agent 设计](autonomous-v2.md) | 中文 |
| [连续上下文训练](continuous-training.md) | English |
| [实验结果与结论边界](results.md) | 中文 |
| [执行与学习边界](BOUNDARIES.md) | English |
| [贡献指南](../CONTRIBUTING.md) | English |

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `lib/` | 运行时和能力实现，当前后端位于 `lib/v2/` |
| `examples/` | 初始能力包与各版本示例 |
| `benchmarks/` | 评测入口与协议 |
| `tests/` | 回归测试和可选集成测试 |
| `scripts/` | 打包检查与环境诊断 |
| `maintenance-skills/` | 旧 v1 模型维护指令 |
| `docs/archive/` | 历史 v1 指南，不作为当前入门入口 |

## 较早协议

下列文档描述仍保留的旧版流程或较早实验。结果不能与当前连续训练协议混为一谈。

- [v1 规则对象指南](archive/legacy-rule-objects.md)
- [v1 执行边界](archive/legacy-boundaries.md)
- [初始 router](starter-router.md)
- [早期训练/测试 benchmark](train-test-benchmark.md)
- [InterCode 适配器](../benchmarks/intercode/README.md)
