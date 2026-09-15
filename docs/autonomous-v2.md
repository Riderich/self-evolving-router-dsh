# 自主开发 Router v2

v2 是与旧 executable-rule-v1 并存的新后端。运行时优先检查 `.dsh/capabilities-v2/state.json`，否则保持旧路由。首次真实实验的结果另见项目实验记录；接口存在不代表已证明净收益。

## 使用

先按 [开始使用](getting-started.md) 安装固定 DSH runtime、profile 和 Docker 镜像，并运行 `npm run doctor`。下面是底层 JavaScript 接口示例；连续上下文训练见 [训练协议](continuous-training.md)。

```js
import { CapabilityStore } from './lib/v2/core.js'
import { installSeed, develop } from './lib/v2/runner.js'
const store = new CapabilityStore('/absolute/public/task/root')
await installSeed(store, {
  enabled: true,
  image: 'python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285',
  pythonVersion: '3.13.15', dockerContext: 'colima', pids: 64,
  snapshotDirectory: '/absolute/docker/shared/snapshots', triggerTimeoutMs: 5000,
})
await store.observe({ id: 'request-1', request: '...', output: '...', trajectory: [] })
await develop(store, { authFile: '/private/auth.json', maxCalls: 64 })
const frozen = await store.freeze()
```

也可以使用 `node v2.js --help` 查看 init、observe、develop、route、freeze 和 status 命令。

真实开发使用既有 DSH 主循环和模型连接，不在插件里重新实现 agent loop。`develop` 是外层调度入口，运行日志、实际模型调用和终端记录均写入 registry。输入历史是观察，不是正确答案认证。

## 可执行能力

一个包含 `manifest.json`、`parser.py`、`executor.py`、`CONTRACT.md`、可选 helpers 和开发测试。manifest 的 operation/schema 可扩展；初始包只识别列表和换行符统计。解析器把识别出的词、路径、排除与递归约束归一为 `{operation,args}`；不同说法可调用同一程序。执行结果是结构化 value，宿主按公开 formatter 输出。

初始解析器是确定性词法实现，支持部分英文和中文，并非完整自然语言理解。当前证据 span 覆盖整条被解释请求，尚未细分每个字段。省略递归默认 false；路径大小写保留；未知词、冲突与未支持操作回退。语义错误仍可能存在，不能把“没有未解释词”视为正确性证明。

多个包产生同一完整 task 且契约相同时，按固定 capability ID 排序选择；不同任务或不兼容效果回退。首批不提供任意跨包工作流图，executor 内部可以多步执行。旧 v1 包继续由旧后端运行，没有自动语义升级。

## agent 自主开发

开发会话提供四个工具：`bash`、`read_file`、`write_file`、`capability`。前三者都指向同一个隔离容器工作区，不是宿主文件操作。可以自由编写脚本、测试、生成夹具、执行命令与调试。每次命令运行新容器，挂载文件跨调用保留，进程/环境变量不保留。

- `/work/task`：当前公开任务的可写副本。
- `/work/capabilities`：可编辑能力代码及开发测试。
- `/work/history`：只读实际训练经历，含路由是否完成和已观察任务参数；没有外部正确性标签。
- `/work/scratch`：可写临时实验目录。

真实工作区、registry、评分器、后续题、API 密钥均不挂载。无网络、不安装依赖、固定镜像与资源额度。正式执行器依旧只读公开快照；开发时可以修改代码和临时项目，不代表允许写入真实用户项目。

## 自测与发布

agent 可用 Bash 自选任意检查。为了让发布证据可重复，包内 `tests/cases.json` 声明请求、公开夹具、期望结果与拒绝样例。至少包含两项正例和一项拒绝例；这只是最低接口要求，不是统计充分性或独立测试保证。

`capability(check)` 运行这些检查，返回紧凑失败摘要。`capability(publish)` 在同一个请求内快照代码、重放声明检查和旧锁定回归，通过后原子激活；无需模型再调用 activate。失败保持旧版，旧检查不能通过删文件消除。代码快照在容器内读取，符号链接被拒绝，Python/pytest 缓存忽略；普通自测生成缓存不会导致包不合法。旧版本、真实执行、来源与候选均留存。`rollback` 恢复已发布父版本。

检查和期望由 agent 编写，宿主只核验这些检查的可重复执行；发布不能宣称 benchmark 认证正确，也不能宣称开发样例为 sealed。首批没有强制生成独立开发留出集合；泛化与错误自动化交由冻结后的外部评测检测。

## 独立评测

```sh
node benchmarks/intercode/v2-benchmark.mjs --inspect DATA_JSON EXPORTED_FS1
node benchmarks/intercode/v2-benchmark.mjs PRIVATE_AUTH DATA_JSON EXPORTED_FS1 NEW_OUTPUT
```

早期 v2 协议为 3 训/6 测、B0–B4 同流；最新 24 训/12 测连续上下文协议见 [训练说明](continuous-training.md) 和 [结果](results.md)。早期协议中，3 条训练原始请求之后才出现测试；B3 集中开发，B4 每题可自行决定修改或不修改。主任务 fallback 相同；开发重试不改写首次成绩。B2 按已观察请求更新手写参数模板，不使用隐藏评分反馈。

训练历史只含请求、实际输出、工具轨迹，不提供 family、gold 命令、oracle 夹具。测试修改公开文件内容，混合原始措辞和预先声明的新表达，是探索性开发评测，不是官方 InterCode 或 sealed。计数与十六进制任务均声明严格输出接口。

冻结约束覆盖注册表、解析代码、规则、证据、历史、会话账本及配置；事件只允许追加路由/请求用量。未发布的隔离开发目录不供测试使用。运行源码和初始包 hash 存入 manifest。每组 64 次累计开发调用，整体 512 次 HTTP 上限，实际调用、执行与维护分别计账。金额未知时不虚构。

离线验收：`node --test tests/v2.test.js`；设置 `ROUTER_V2_DOCKER_TEST=1` / `ROUTER_V2_PROFILE_TEST=1` 和 Docker 共享的 `ROUTER_V2_SHARED` 可运行真实 Docker/完整 DSH 工程检查。完整 DSH 检查使用离线模型响应；不能当真实模型进化结果。
