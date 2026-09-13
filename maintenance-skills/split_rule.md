# split_rule

传 child_ids，从当前 active 规则创建多个草稿。依次用 edit_contract 的 draft_id 选择、提交每个成员，再整体验证和发布。

完成时返回操作生成的 ID、事实与下一步。以工具结果为准；保留反例和正确行为，不修改可信状态或预算。
