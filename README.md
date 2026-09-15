# DSH Pre-LLM Router

## Autonomous v2

The optional v2 backend supports deterministic keyword/constraint parsing, isolated coding-agent development (terminal, file reading/writing and self-tests), and single-request publication with regression replay. Benchmark answers stay outside the developer context; test capabilities are frozen. See [v2 usage and limitations](docs/autonomous-v2.md). Read-only production execution remains separate from writable development workspaces. This does not establish net cost savings.

## Benchmark 更新（2026-09-14）

新对象后端已完成一次 InterCode 原始五题 B0–B4 开发对照：每组最终答案 5/5，学习组自动完成 1/5；实际 53 次 API。模型真实修复了失败代码并通过验证，但继续维护未带来新增覆盖，成本尚未回本。**两个事后子目录/排除约束反例均发生错误自动化**，当前准入还不能保证生成规则正确遵守所有范围限制。适用于受控研究，扩大使用前需加强范围验证。

[评测入口与边界](benchmarks/intercode/README.md) · [结构化结果](docs/intercode-objects-2026-09-14.json)。这是已用开发数据，非 sealed 或官方榜单成绩。


让 DeepSeek Harness 在调用模型之前执行经过验证的确定性程序，并从获准的历史请求中持续生成、修复和更新这些程序。

这是独立开发的开源 alpha。自进化代码走 DSH 原生工具循环：模型编辑真实 Python 规则文件，接收可信验证器的失败反馈，继续修复，通过检查后发布不可变版本。路由本身不调用模型。未命中或不确定时交回原 DSH agent。router profile 关闭自动模型会话标题，避免后台调用破坏零模型路径。

当前范围是**只读、可明确验证的小任务**，例如列出可见文件。它不是通用代码生成器，也尚未证明净成本下降。人工示例和离线模型测试不作为真实模型学习效果证据。

## 真实模型验收（2026-09-14）

使用已有 API 的 `deepseek-v4-flash` 完成一次工程验收：从空规则注册表和 3 条经宿主检查的历史开始，模型生成规则，经 4 项准入检查后激活。共 15 次真实 API 请求；第一段完成验证后停止，第二段保留进度并激活同一版本。新增文件请求通过完整 DSH，实际网络尝试为 0，边界请求回退。

这是单任务族的合成工程验收，不证明净节省、广泛泛化或真实失败修复成功率。见[结构化结果](docs/live-acceptance-2026-09-14.json)及[生成的原始规则](examples/learned-list-files)。真实接口来自用户配置的网关，服务端权重身份未独立核验。

## 安装

需要 Node.js 22+、npm 和 Docker。macOS 可以使用 Docker Desktop 或 Colima；Linux 使用 Docker Engine。安装命令不调用模型。在本仓库根目录：

```sh
git clone https://github.com/Riderich/self-evolving-router-dsh.git
cd self-evolving-router-dsh
npm ci
node install.js
node cli.js --help
```

依赖锁固定 DSH rc.6 及其实际解析的组件版本。`install.js` 注册独立 `router` profile。默认使用 `DSH_HOME`，否则 `~/.dsh`。也可以设置 `DSH_ROUTER_RUNTIME` 指向已有 pinned runtime 的根目录。启动入口为 `node run.js "请求"`；本地包安装后也可使用 `dsh-router-run`。

这个源目录可以单独克隆和安装，不需要研究文档、InterCode 数据集或私有 fork。研究工作区中的旧 runtime 自动发现只是开发兼容路径。

## 从可工作的初始 router 开始

先准备公开、无任务数据的固定 Python 镜像：

```sh
docker pull python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285
node scripts/setup-starter.mjs ./demo-workspace
```

Colima 用户在上述命令前设置 `DOCKER_CONTEXT=colima` 和 `ROUTER_DOCKER_CONTEXT=colima`。输出目录必须位于 Docker 可共享位置。安装会独立验证并激活三个手写规则：列出顶层可见普通文件、统计这些文件数量、递归统计指定扩展名文件的换行字节。18 项集合准入检查通过后才启用。初始规则能直接工作，也会作为维护模型的 few-shot；不会虚构成功历史或发起模型调用。只接受新的对象注册表，不覆盖已有证据。

先直接使用，无需 API：

```sh
node cli.js --root ./demo-workspace route "list visible files"
node cli.js --root ./demo-workspace route "count visible files"
node cli.js --root ./demo-workspace route "count lines in all c files in /testbed recursively"
```

支持范围和示例见 [工作初始 router](examples/starter-router)。额外子目录、排除、过滤等未支持限定条件会回退。以下维护命令需要先导入足够的真实验证历史并配置 DSH provider；没有历史时不会启动模型：

```sh
node cli.js --root ./demo-workspace preflight
node cli.js --root ./demo-workspace evolve
node cli.js --root ./demo-workspace maintenance-status
node cli.js --root ./demo-workspace route "list visible files"
```

也支持 `DSH_ROUTER_AUTH_FILE=/absolute/private/auth.json`，内容为 `{"apiKey":"…","baseURL":"https://…","model":"…"}`，必须 `chmod 600`。如需其他已支持的 adapter，设置 `DSH_ROUTER_PROVIDER_FILE`，格式见 `lib/provider-config.js`。凭证文件不挂载给维护工具。不要把凭证放进提交或示例目录。

`evolve` 自动选出有足够可信历史的任务族，运行编辑—验证—诊断—修复—激活链，默认累计最多 20 次模型调用。当前规则能正确重现的新历史会被标记已覆盖，跳过无增量依据的维护；比较为严格输出相等，不把一个匹配信号当作正确覆盖。提示自动提供最多两条当前有效规则及其测试，作为实际代码 few-shot。同族草稿默认复制稳定版本，重复 create 复用已有草稿；更新仍须通过整个规则集合的回归。一次未通过可用同一命令继续已有链；失败反馈、草稿、稳定版本、调用账本跨进程保留。达到预算即停止。`recover CHAIN_ID` 检查崩溃状态；未确认结果的模型调用进入 ambiguous，不会偷偷重发。

真实集成用 `observe EVIDENCE.json` 导入可信验证器确认的结果，记录必须含 `id/family/request/output/oracle_id/verified:true`。普通模型回复不会自动变成验证结果。建议由可信验证器附上 `fixture:{files,args}`，让增量版本必须重放新历史，防止只通过旧测试却未获得新能力；证据会绑定到证明并继承。详见 [初始 router 与增量验证](docs/starter-router.md)。宿主评估插件也可以调用 `prellmRouter.observeVerified(cwd, evidence)`，在维护已开启时自动调度。`family` 使用小写字母、数字和连字符，并作为规则 ID。

## 规则与验证

规则包包含 `manifest.json`、`README.md`、`trigger.py`、`executor.py`，可附 helpers 和开发测试。工作的初始集合在 `examples/starter-router`，旧单规则夹具仍在 `examples/rules/list-files`。维护模型通过 `rule` 的 18 个操作管理草稿和生命周期，通过隔离的 `str_replace_editor` 编辑文件，通过 `rule_skill` 按需读取操作说明。

触发函数 `trigger(request, context)` 返回 match/no_match/abstain；执行函数 `execute(request, args, context)` 返回有界 JSON 结果。执行环境只读公开快照。具体协议见 [维护协议](maintenance-skills/PROTOCOL.md)，威胁模型和限制见 [边界说明](docs/BOUNDARIES.md)。

可信操作者提供 `.dsh/executable-rules/admission.json`。开发测试和模型建议不能修改独立 oracle。准入集用于反复修复，不能称为密封测试。全量集合通过后才能激活；冲突、撤销、环境变化和陈旧凭据均回退。支持停用、重新验证后回滚，以及保留原 oracle 任务族的拆分/合并。

手动调试入口为 `source`、`submit`、`validate`、`activate`、`disable`、`rollback`。查看 `node cli.js --help`。旧模板后端保留用于对照；对象后端启用后不会调用旧模板学习器。

## 测试与证据

```sh
npm run check
npm test
# 需要已安装 profile 和上述 Docker 镜像；全部模型使用离线替身
ROUTER_DOCKER_CONTEXT= npm run test:evolution
ROUTER_DOCKER_CONTEXT= npm run test:docker
ROUTER_DOCKER_CONTEXT= npm run test:route
```

Colima 将变量值改为 `colima`。普通测试会跳过容器和 DSH 集成测试，跳过不算验收通过。自进化集成测试覆盖过宽触发器被拒绝、根据反馈修复、重新发布和新请求零模型路由；模型调用在实际 adapter 边界预留预算并记录用量。

原始候选、差异、证明、失败及调用记录位于工作区 `.dsh/executable-rules`；`events` 导出事件。请先清理私人数据再分享日志。报告收益时必须计入生成、验证、执行、回退、修复和维护成本，并和 always-LLM、人工静态、精确回放、冻结历史路由比较。

见 [贡献说明](CONTRIBUTING.md)、[安全说明](SECURITY.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。许可证为 MIT。

显式真实验收入口（会产生最多 20 次累计 API 请求，不属于测试套件）：

```sh
ROUTER_DOCKER_CONTEXT=colima node scripts/live-object-acceptance.mjs /absolute/private/auth.json /absolute/new-output-directory
```

Linux/Docker Desktop 将 context 值改为所用环境（默认可留空）。输出目录必须不存在，以免覆盖旧证据。

原有 `scripts/setup-demo.mjs` 仍用于从空注册表启动的合成工程演示，不是当前默认起点。`scripts/live-starter-acceptance.mjs AUTH NEW_OUTPUT` 是显式付费的种子增量工程验收（最多 20 调用）；离线集成用 `ROUTER_PROFILE_TEST=1 node --test tests/starter-profile.test.js`。几条验收成功不证明 few-shot 比从零生成更有效，也不代表广泛安全或净节省。

## Focused train/test evaluation

The next benchmark uses sequential training, persistent rule updates and a frozen test phase. See [the protocol, split and commands](docs/train-test-benchmark.md). Existing development results are preserved; this protocol change is not a new measured performance result.

Continuous-context task training and agent-chosen development timing: [experiment guide](docs/continuous-training.md).
