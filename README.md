# Self-evolving Router for DSH

[![CI](https://github.com/sra-research/self-evolving-router-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/sra-research/self-evolving-router-dsh/actions/workflows/ci.yml)

在 DeepSeek Harness 调用模型之前，用确定性程序完成可明确处理的请求；未知、歧义或执行失败时回退到原 Agent。Agent 可以从真实工作轨迹中修改、测试和持久发布这些程序。

**研究型 alpha · 当前入口为 v2 · 自动执行限于只读公开文件。** 已验证连续上下文中的自主开发闭环，尚未证明普遍可靠或全生命周期净降本。不是 DeepSeek 官方插件，也不承诺安装后自动学会所有任务。

English technical guides: [continuous training](docs/continuous-training.md) · [contributing](CONTRIBUTING.md).

## 它怎么工作

```mermaid
flowchart LR
    Q[新请求] --> R[确定性解析与规则选择]
    R -->|明确支持| E[只读隔离执行]
    E --> O[结果：零模型调用]
    R -->|未知或歧义| A[原 DSH Agent]
    E -->|失败| A
    H[获准的真实工作轨迹] --> D[Agent 自主修改和测试]
    D --> P[宿主重放检查并持久发布]
    P --> R
```

路由本身不调用模型，开发会调用你配置的模型。Agent 自写测试通过是开发证据，不等于独立正确性认证。**当前 v2 学习需要显式启动开发或训练流程，普通请求不会自动开启后台训练。**

## 五分钟试用：不需要 API

需要 Node.js 22+、npm、已启动的 Docker。支持固定 DSH `0.1.0-rc.6`；依赖由锁文件固定。在新克隆的仓库根目录执行：

```sh
git clone https://github.com/sra-research/self-evolving-router-dsh.git
cd self-evolving-router-dsh
npm ci
node install.js
docker pull python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285
npm run doctor
mkdir -p .sandbox/demo-v2 .sandbox/snapshots-v2
printf 'hello\nworld\n' > .sandbox/demo-v2/example.php
node v2.js init .sandbox/demo-v2 .sandbox/snapshots-v2
node v2.js route .sandbox/demo-v2 "Count total lines in PHP files in /testbed"
node v2.js status .sandbox/demo-v2
```

预期结果包含 `"kind": "completed"`、`"text": "2\n"`、`"modelCalls": 0`。`route` 是直接诊断入口：不支持时返回 fallback JSON，不会自动调用模型。完整 Agent 使用 `node run.js`，见 [开始使用](docs/getting-started.md)。

Colima 用户先设置 `export DOCKER_CONTEXT=colima` 和 `export ROUTER_DOCKER_CONTEXT=colima`。其他环境默认遵循 Docker 当前配置；`ROUTER_DOCKER_CONTEXT` 可覆盖。任务和快照目录都须可被 Docker 共享，快照目录必须在任务目录之外。`init` 拒绝覆盖已有注册表；重试示例时使用新目录。

## 从试用到学习

| 目的 | 入口 |
| --- | --- |
| 安装、完整 DSH、API 配置 | [开始使用](docs/getting-started.md) |
| 环境诊断与常见错误 | `npm run doctor` · [排障](docs/troubleshooting.md) |
| 能力包、开发工具、发布与回滚 | [v2 设计](docs/autonomous-v2.md) |
| 连续做题与自主开发时机实验 | [训练实验](docs/continuous-training.md) |
| 当前证据及结论边界 | [实验结果](docs/results.md) |
| 原有 cli.js evolve 流程 | [历史 v1 指南](docs/legacy-rule-objects.md) |

初始 v2 能力只有文件列表和换行符统计。实验中新学到的文件数、字节数、词数等能力不是默认内置功能。v1/v2 状态、历史接口和维护工具不同，请勿混用操作手册。

## 当前实验表现

同一上下文的 24 道训练题后，引导自主组自行选择集中开发：

| 条件 | 训练模型调用 | 训练 token | 冻结正确自动化 |
| --- | ---: | ---: | ---: |
| 固定批次 | 96 | 2,944,523 | 12/12 |
| 引导后自主时机 | 87 | 1,116,190 | 12/12 |

这是六类只读计数操作、人工请求和修改文件环境上的单次开发比较，不是官方 InterCode 分数、sealed 测试或广泛 coding 能力证明。学习成本尚未由本轮复用摊回。早期失败与修复重跑也保留在 [结果说明](docs/results.md)。

## 开发与贡献

```sh
npm run check
npm test
```

默认测试跳过需要 Docker/profile 的集成项，跳过不算通过。完整命令见 [贡献说明](CONTRIBUTING.md)。测试套件使用离线模型替身；live 脚本和真实 benchmark 会调用 API，须显式启动。

欢迎提交安装失败、边界错误、最小复现和文档改进。另见 [执行边界](docs/BOUNDARIES.md)、[安全说明](SECURITY.md)、[变更记录](CHANGELOG.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。[MIT 许可](LICENSE)。
