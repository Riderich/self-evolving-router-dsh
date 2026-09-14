# 可工作规则同时作为 few-shot

`node scripts/setup-starter.mjs ROOT` 创建新的对象注册表，验证并激活三个手写基础规则。初始规则会直接处理支持的请求；维护模型读取的 few-shot 就来自这同一个有效激活集合，最多两条、24,000 字符。禁用或证明失效的规则不会被当作有效示例。

基础语法及范围见 [starter-router](../examples/starter-router)。这些规则只支持明确的完整请求形式和公开只读快照。初始 18 项检查包括空输入、未终止文本行、子目录、排除与额外动作等边界，有限检查不等于广泛正确性证明。

## 增量维护

同族更新默认复制稳定版本，保留父版本。重复 create 复用当前草稿，不会清空已有修改。模型应选择 edit_trigger/edit_executor 等操作限制修改面；其他规则也必须通过全量集合回归。没有执行代码变化的 metadata-only 发布会被拒绝。

可信验证器可通过 `observe` 或宿主 `observeVerified` 提供历史记录。模型回复本身不是验证证据，也不能通过规则工具添加这些记录。以下只是字段示意，不能当作已经测得的真实历史导入：

```json
{
  "id": "verified-task-001",
  "family": "list-files",
  "request": "show visible files",
  "output": "sample.txt\n",
  "oracle_id": "trusted-directory-evaluator",
  "verified": true,
  "fixture": {
    "files": {"sample.txt": "public example text"},
    "args": {}
  }
}
```

`fixture` 必须是可信验证器确认可重放该历史的文件视图及预期参数。路径不可越界、不可含隐藏/vendor/node_modules 目录，文件为字符串，最多 64 文件、128 KiB；私密内容拒绝接收。基础准入与累计历史回放合计最多 64 项，超过上限需由可信操作者设计有界协议，不会静默丢弃旧证据。

验证时，历史 fixture 与旧 admission 一起运行；除了旧能力，还必须正确重放新历史，才能通过。证明绑定历史内容，后续对其他规则的更新也继承已有回放要求。模型修改包内 tests 不会改变这些可信 oracle。

旧版无 fixture 历史仍兼容，但仅提供上下文，不构成新行为的可执行证明。安装器不会伪造历史。当前规则能严格重现的新历史会被标记已覆盖并跳过无增量依据的合成；不能重现时才进入维护候选选择。

## 证据边界

实际模型案例和结构化结果单独记录；离线替身验证执行流程，不证明真实学习效果。初始 router 同时是基线能力和 few-shot，应让静态、冻结与进化条件从同一初始快照开始比较，并计入初始验证、人工实现和全部维护费用。

升级可信实现后，旧环境证明会失效。使用 CLI 的 validate/activate 在新环境重新验证整个集合，不能直接修改证明或假装旧版本仍通过。

## Engineering acceptance (2026-09-14)

The first real-model attempt made eight calls and republished the unchanged trigger; it did not learn the new requests. After adding trusted historical replay and an explicit incremental objective, eleven further calls produced a trigger supporting list/show/display, passed 21 cases, and served a new file through full DSH with zero fetch attempts. Both attempts count: 19 model calls and 191,349 tokens including cache reads. This is a synthetic engineering result, not a benchmark, few-shot ablation, or net-cost saving. See [structured accounting](starter-acceptance-2026-09-14.json).

The complete local regression recorded 47 passes and one DSH startup timeout. The failed integration passed when rerun alone; the original failure is retained. Cloud-synchronized directories can stall module reads; use a canonical local checkout and Docker-shared workspace for reliable development. Do not relax path or sandbox checks to work around environment failures.

Maintenance coverage checks currently compare the active router output on the current workspace with recorded verified output. Changes in workspace contents can therefore cause unnecessary maintenance; historical fixtures are enforced at admission, but are not yet used for this scheduling decision.
