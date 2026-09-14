# InterCode 开发评测适配器

## 2026-09-14：新 Python 规则对象对照

`object-benchmark.mjs` 已接通对象后端的完整 DSH B0–B4，并通过统一只读镜像/快照执行。原始五题（20、22、28、40、56）全部最终答对，B3/B4 各自动完成 1 题；实际 53 API。B4 多花 12 次维护，没有新增命中，未回本。真实局部修复通过了准入，但事后两个 synthetic 范围反例均错误自动化。见[公开结构化结果](../../docs/intercode-objects-2026-09-14.json)。下方均为旧后端历史。

```sh
ROUTER_DOCKER_CONTEXT=colima node benchmarks/intercode/object-benchmark.mjs PRIVATE_AUTH DATA_JSON EXPORTED_FS1 NEW_OUTPUT
node benchmarks/intercode/analyze-objects.mjs NEW_OUTPUT
```

Linux 设置 `ROUTER_DOCKER_CONTEXT=''`。自行取得 pinned InterCode c3e46d827cfc9d4c704ec078f7abf9f41e3191d8 的 `data/nl2bash/nl2bash_fs_1.json` 和原始 `/testbed` 导出目录作为 DATA_JSON/EXPORTED_FS1；数据不随 npm 包分发。先准备 Docker 可共享输出目录的父目录，以及 README 中固定的 Python 3.13.15 镜像。任务在公开只读派生视图中执行，这是开发协议，不是官方 leaderboard setting。

运行会付费：总 HTTP 上限 64，初始维护最多 20，B4 累计维护最多 32；串行运行，禁止同时开启其他同日志进程或 Docker 计时测试。输出必须全新，不支持对已观察候选的盲目 resume。中断保存所有已完成阶段及 HTTP 原始记录，不得自动重抽。API 文件须仅当前用户可读，日志仅本地。金额 unknown。

前三题是真实、oracle 验证的共享历史；B3 初始状态复制给 B4，逻辑成本分别收费。后续原题不进入学习准入；B1 手写控制可见所有原题措辞，B2 仅过去措辞的扩展名模板。普通 CI 默认使用合成协议夹具，不能当本次原始数据结果。

独立 `object-scope-audit.mjs RUN NEW_DIAGNOSTIC_OUTPUT EXPORTED_FS1` 复制冻结注册表运行两个无模型事后反例；这些是看过代码后构造的诊断，不能混入五题分数。原始运行状态不变。


## 2026-09-11 最新：自进化增量评测已完成

`evolution.js AUTH EXPORTED_FS1` 是显式付费开发实验，非 CI。当前固定协议第二轮上限 54 次，加已保留首轮 10 次总上限 64；实际第二轮 51 次。不要自动重复运行来重抽候选。五组在 5 原始行数题＋单列 3 人造探针上比较，B4 没有获得净收益，见 `workspace/experiments/2026-09-11_SELF_EVOLUTION_CONCLUSION.md`。

`evolution-protocol.js` 固定数据/准入套件，未来请求不入学习套件。`analyze-evolution.js RESULT_DIR` 无模型调用，对账 SSE 并隔离执行 18 项事后诊断，不修改 registry。`evolution.js` 可用第四参数在首次合成之前的特定维护启动中断处继续；不支持重新抽取已观察到的合成结果。

`run.js --auth-file AUTH --benchmark-file CONFIG --benchmark-learn-only` 使用 native DSH 合成，无 agent 请求/工具，结束恢复 learning:false。CONFIG 的可选 `answerContract: "integer-only"` 仅适用于本次计数族，不用于其他任意任务。

最终 38/38 回归通过，包含维护路径的完全离线测试。以下 B0/B1 和静态 audit 描述是较早阶段，不覆盖此最新进度。

`audit.js` 运行无模型的任务审计、手写静态控制、独立 oracle 与 reset 检查；`text-audit.js` 统计原始数据的完全相同 query。使用项目中已有镜像，不 pull，不执行写操作题，原始题文本不改写。

```sh
node benchmarks/intercode/audit.js
node benchmarks/intercode/text-audit.js
```

每次 audit 保存新结果目录。当前选择 fs1 的 14 道 development 题，9 道执行、5 道回退控制；模板与测试由人手设计，不是 learned baseline。B0/B2/B3/B4 和完整 DSH benchmark 尚未运行。43 条准入检查不称 sealed。

结果字段区分路由边界正确与任务成功：fallback 的 taskSuccess 为 null；已执行任务要求 stdout、stderr、exitCode 同时正确。成本不把 golden/reference evaluation 时间当在线推理时间，也不从 0 API 调用推断节省。

2026-09-11：`dsh-backend.js` 已通过完整 DSH 的工具覆盖接口接通统一 `/testbed` DockerExecutor。`run.js --auth-file AUTH --benchmark-file CONFIG REQUEST` 显式启用；CONFIG 含 root、image、journal，root 为当前项目、image 与 router 状态一致、journal 必须在项目之外，且 learning:false。后台、提权及其他模型工具均拒绝。每次命令为独立容器，无持久 shell 状态。

`compare.js AUTH EXPORTED_FS1` 会真实消耗模型额度，运行三道开发题 B0/B1 并写入新结果目录，HTTP 上限 12。不纳入普通 CI；不能把 B1 手写候选当学习结果。B0/B1 均经过完整 DSH，仍未实现 B2/B3/B4。正式时延轮禁止和 Docker 回归并发。

详见 `workspace/experiments/2026-09-10_INTERCODE_ROUTER_ORACLE_STATIC.md` 与 `workspace/experiments/2026-09-11_DSH_UNIFIED_BACKEND_COMPARISON.md`。禁止在本机宿主直接执行 benchmark 或模型生成的操作。
