# edit_executor

以 base_revision 或 draft_id 选择草稿，只修改 executor.py 与相关 helpers，保留触发语义。

完成时返回操作生成的 ID、事实与下一步。以工具结果为准；保留反例和正确行为，不修改可信状态或预算。
