# 术语表实施计划（首版历史）

当前语义已按用户2026-11-13决定调整为组织默认+项目fork，见 [后续计划](organization-glossary.md)。以下为首版实施记录。

- 所有权：`glossary` 拥有组织术语表、词条、纯字段规则及公开服务；`projects/glossary_services.py` 拥有项目关联、关联数、权限与归档上下文编排。依赖 projects → glossary → organizations/accounts，无反向 ORM 访问。
- 保存边界：Project 新增可空术语表 FK、独立关联版本和最近关联是否由首次添加创建的标记；只更新这些列，不 touch 字幕 revision、document、updated_at 或工作区保存基准。词条独立 revision。首次添加在 User → Organization → Project 锁内完成全部写入，允许同一个空关联版本的并发首次添加汇入同一默认表，显式切表后拒绝迟到添加。
- 前端：glossary-data 封装 HTTP/请求观察；glossary-ui 复用查询、表单和维护组件；workspace-ui 只接侧栏与同步光标插入，project-ui 只组合设置区。与 QC 共用侧栏及断点；表单普通输入，不进入字幕历史。
- 验证：PostgreSQL 事务/独立连接竞争、HTTP 权限/CSRF/契约；Vitest 字段/光标规则；浏览器 HTTP fixture 检查首次添加、冲突草稿、共享切换、响应隔离、插入/历史/IME/布局和无保存；运行类型检查、构建及相关回归。
- 不提交、不推送、不部署；保留开始前已有改动。具体契约与实际验证结果随实现补充。

## 完成记录

资源、项目关联迁移、工作区侧栏/插入、设置维护/共享、独立 CAS 及文档已实现。无公共字幕契约变化；旧迁移测试改为恢复实际 schema 后再执行历史数据迁移，避免新增列使冻结旧模型失配。相关旧浏览器 fixture 补充空术语响应，不放宽断言。具体执行结果见 ../experiments/glossary.md。
