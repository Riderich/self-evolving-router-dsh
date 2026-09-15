# 开始使用 v2

先完成 [README 的无 API 示例](../README.md)。仓库脚本默认从仓库根目录运行，任务目录须预先存在。`install.js` 注册 router profile，不调用模型；默认写入 `DSH_HOME`，未设置时为 `~/.dsh`。已有固定 runtime 可通过 `DSH_ROUTER_RUNTIME` 指定。

## 命令与状态

```sh
node v2.js --help
node v2.js status .sandbox/demo-v2
node v2.js route .sandbox/demo-v2 "List files in /testbed"
```

未初始化目录的 status 仅返回 initialized:false，不创建状态。route 返回执行或回退 JSON；回退是正常结果，不代表命令失败。输入错误、开发进程失败使用非零退出码。develop 的 status:complete 只表示会话正常结束；是否发布要看 active 版本和发布事件。

状态位于任务目录 `.dsh/capabilities-v2/state.json`，包含历史、用量和开发证据，可能含业务数据。不要直接编辑。当前为小规模单 JSON 存储，尚无成熟多用户服务或大规模历史归档。

## 完整 DSH 与模型配置

在仓库根目录记录绝对路径，再从任务目录运行：

```sh
ROUTER_REPO="$PWD"
cd .sandbox/demo-v2
node "$ROUTER_REPO/run.js" --auth-file /absolute/private/auth.json "你的请求"
```

认证文件使用自己的 provider 配置，不要用占位值调用：

```json
{"apiKey":"YOUR_KEY","baseURL":"https://YOUR_GATEWAY/v1","model":"YOUR_MODEL"}
```

执行 `chmod 600 /absolute/private/auth.json`，保存在仓库和任务目录之外。完整入口未命中会调用模型；普通基座 Agent 的权限仍生效，不等同于只读 benchmark 环境。默认使用 `deepseek-native` 协议，不能仅凭更换 model 名称切换任意 provider。完整 `run.js` 支持 `--provider-file`，其 JSON 可指定 `adapter: "pi-chat-completions"` 和 `model`；当前 `v2.js develop` 不转发这个选项，需使用兼容默认协议的端点。配置字段见 [provider-config.js](../lib/provider-config.js)。

## 显式开发

普通请求不会自动启动 v2 学习。从仓库根目录导入获准分享给 provider 的实际经历，再启动开发：

```sh
node v2.js observe .sandbox/demo-v2 /absolute/observed-history.json
node v2.js develop .sandbox/demo-v2 /absolute/private/auth.json 64
node v2.js status .sandbox/demo-v2
```

历史包含 id、request、output、trajectory（真实工具记录数组）。不要把推测结果伪装成执行历史；观察到的回答也不是正确性认证。v2 不接受旧 v1 的 family/oracle/verified 标签。

Agent 自行读写隔离目录、执行终端、编写测试和请求发布。检查失败保留旧版；模型也可能不修改。发生异常后先检查记录，不要假定重复 develop 会恢复原会话：独立 develop 从已发布版本开始，旧未发布草稿不会自动继承。

连续任务学习和自主结束控制使用专门 [训练入口](continuous-training.md)，与单次 develop 不同。

## 冻结与回滚

`node v2.js freeze ROOT` 用于固定评测版本。冻结后禁止开发；当前没有 unfreeze CLI。日常仍需学习的工作区不要随手冻结。

开发会话的 `capability(action='rollback',id=...,revision=...)` 可恢复当前能力的已发布父版本；冻结时不能回滚。当前没有面向最终用户的一键回滚界面，这是已知限制。
