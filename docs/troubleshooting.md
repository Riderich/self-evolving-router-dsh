# 排障

运行 `npm run doctor`，或 `node scripts/doctor.mjs --json`。诊断不调用模型、不下载依赖、不启动容器、不修改状态；基础配置检查不能代替实际挂载和完整运行验证。

| 现象 | 处理 |
| --- | --- |
| DSH 缺失或版本不符 | 运行 npm ci；检查 DSH_ROUTER_RUNTIME 是否指向固定 rc.6 安装 |
| Profile 缺失或指向另一个 checkout | 用相同 DSH_HOME 执行 node install.js；多 checkout 使用不同 DSH_HOME，不覆盖原链接 |
| Docker daemon/context 错误 | 启动 Docker；用 docker context ls 检查；Colima 设置 ROUTER_DOCKER_CONTEXT=colima |
| 固定镜像缺失 | 按 README pull 固定摘要，确保运行与下载使用同一个 context |
| Mount/Permission denied | 两个目录均须被 Docker 共享；检查 Docker Desktop/Colima 共享设置和可写权限 |
| Snapshot directory must be outside… | 用任务目录的相邻目录，不能把快照放进正在复制的任务目录 |
| Existing registry | init 不覆盖原版本；使用 status，或创建新的独立试用目录 |
| No v2 registry | 在已存在的任务目录执行 v2 init；旧 v1 状态不会自动迁移 |
| fallback | 看 reason/detail；可能是未支持表达、歧义、约束或执行错误，初始包仅有限列表和换行统计 |
| 开发结束但没新能力 | complete 不等于 publish；检查 active、会话及发布事件 |
| Frozen | 无 unfreeze 命令；不要手动改冻结标记或评测历史 |
| 输出多了说明文字 | 严格接口会失败；将格式与计算正确性分开分析，不偷偷放宽评分 |

报告问题请附提交号、系统、Node 版本、诊断结果、最小公开输入、完整命令和错误。分享前清理路径与业务信息，不要上传认证文件、私人轨迹或完整 state.json。
