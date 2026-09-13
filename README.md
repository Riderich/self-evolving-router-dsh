# DSH Pre-LLM Router

让 DeepSeek Harness 在调用模型之前执行经过验证的确定性程序，并从获准的历史请求中持续生成、修复和更新这些程序。

这是独立开发的开源 alpha。自进化代码走 DSH 原生工具循环：模型编辑真实 Python 规则文件，接收可信验证器的失败反馈，继续修复，通过检查后发布不可变版本。路由本身不调用模型。未命中或不确定时交回原 DSH agent。

当前范围是**只读、可明确验证的小任务**，例如列出可见文件。它不是通用代码生成器，也尚未证明净成本下降。人工示例和离线模型测试不作为真实模型学习效果证据。

## 安装

需要 Node.js 22+、npm 和 Docker。macOS 可以使用 Docker Desktop 或 Colima；Linux 使用 Docker Engine。安装命令不调用模型。在本仓库根目录：

```sh
npm ci
node install.js
node cli.js --help
```

依赖锁固定 DSH rc.6 及其实际解析的组件版本。`install.js` 注册独立 `router` profile。默认使用 `DSH_HOME`，否则 `~/.dsh`。也可以设置 `DSH_ROUTER_RUNTIME` 指向已有 pinned runtime 的根目录。启动入口为 `node run.js "请求"`；本地包安装后也可使用 `dsh-router-run`。

这个源目录可以单独克隆和安装，不需要研究文档、InterCode 数据集或私有 fork。研究工作区中的旧 runtime 自动发现只是开发兼容路径。

## 跑通自进化

先准备公开、无任务数据的固定 Python 镜像：

```sh
docker pull python@sha256:9d2e5553305c7c7b0097999bb17187c69b921ccd6bc9d40e4bb5ebe652c00285
node scripts/setup-demo.mjs ./demo-workspace
```

Colima 用户在上述命令前设置 `DOCKER_CONTEXT=colima` 和 `ROUTER_DOCKER_CONTEXT=colima`。`.sandbox` 必须位于 Docker 可共享目录。示例脚本写入三个合成历史结果和独立准入检查，开启最多 **20 次累计模型请求**，但不会开始调用模型。

配置 DSH provider 后执行：

```sh
node cli.js --root ./demo-workspace preflight
node cli.js --root ./demo-workspace evolve
node cli.js --root ./demo-workspace maintenance-status
node cli.js --root ./demo-workspace route "list visible files"
```

也支持 `DSH_ROUTER_AUTH_FILE=/absolute/private/auth.json`，内容为 `{"apiKey":"…","baseURL":"https://…","model":"…"}`，必须 `chmod 600`。如需其他已支持的 adapter，设置 `DSH_ROUTER_PROVIDER_FILE`，格式见 `lib/provider-config.js`。凭证文件不挂载给维护工具。不要把凭证放进提交或示例目录。

`evolve` 自动选出有足够可信历史的任务族，运行生成—验证—诊断—修复—激活链。一次未通过可用同一命令继续已有链；失败反馈、草稿、稳定版本、调用账本跨进程保留。达到预算即停止。`recover CHAIN_ID` 检查崩溃状态；未确认结果的模型调用进入 ambiguous，不会偷偷重发。

真实集成用 `observe EVIDENCE.json` 导入可信验证器确认的结果，记录必须含 `id/family/request/output/oracle_id/verified:true`。普通模型回复不会自动变成验证结果。宿主评估插件也可以调用 `prellmRouter.observeVerified(cwd, evidence)`，在维护已开启时自动调度。`family` 使用小写字母、数字和连字符，并作为规则 ID。

## 规则与验证

规则包包含 `manifest.json`、`README.md`、`trigger.py`、`executor.py`，可附 helpers 和开发测试。例子在 `examples/rules/list-files`。维护模型通过 `rule` 的 18 个操作管理草稿和生命周期，通过隔离的 `str_replace_editor` 编辑文件，通过 `rule_skill` 按需读取操作说明。

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
```

Colima 将变量值改为 `colima`。普通测试会跳过容器和 DSH 集成测试，跳过不算验收通过。自进化集成测试覆盖过宽触发器被拒绝、根据反馈修复、重新发布和新请求零模型路由；模型调用在实际 adapter 边界预留预算并记录用量。

原始候选、差异、证明、失败及调用记录位于工作区 `.dsh/executable-rules`；`events` 导出事件。请先清理私人数据再分享日志。报告收益时必须计入生成、验证、执行、回退、修复和维护成本，并和 always-LLM、人工静态、精确回放、冻结历史路由比较。

见 [贡献说明](CONTRIBUTING.md)、[安全说明](SECURITY.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。许可证为 MIT。
