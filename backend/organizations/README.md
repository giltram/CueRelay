# organizations

拥有 Organization、OrganizationMembership 和固定 organizer/member 角色。依赖 accounts 的 User 身份模型、ass_format 的公开纯样式校验及 Django；不依赖 application、HTTP、媒体或格式模块。

公开写入口位于 services.py：create_organization、rename_organization、add_member、change_member；查询鉴权使用 require_access。账号生命周期协调使用公开 lock_user_organizations / ensure_organizer，调用方必须先持有目标 User 锁且处于事务中。

锁顺序：目标 User → Organization（多组织按主键排序）；不在持有组织锁后获取用户锁。成员修改和账号停用均在组织锁下维护至少一名活动 organizer。创建组织和初始活动 organizer 原子提交。默认添加为 member；membership id 必须属于指定组织。

organizer 不能移除或降级其他 organizer（包括先降级再移除）；change_member 在持有组织锁后重新读取操作者身份及目标角色。dev 可管理 organizer，本人可降级或退出，但仍受最后活动 organizer 约束。

所有支持的 API/Admin 写入必须经过这些入口。Admin 成员表只读，不允许删除组织。不要通过直接 ORM update/delete 或 SQL 实施业务变更。唯一关系和角色范围另有数据库约束。

PostgreSQL 竞争测试：tests.py（多线程独立连接，同时降级/移除/退出/停用）。HTTP 越权、Admin 和约束测试：../http_api/test_identity.py。

## 组织样式模板

`style_templates.py` 是公开模板边界：list_templates / template_snapshot 返回独立 JSON 快照，create_template / update_template / delete_template 执行写入。OrganizationStyleTemplate 存名称、完整 ASS 属性、参考脚本设置、可编辑来源说明、自身 revision 与创建/更新者时间；同组织名称唯一，最多 1000 个。项目仅保留来源 UUID/revision，没有删除级联或动态继承。

写锁顺序 User → Organization → Template；在组织锁下重查 organizer/dev 权限、模板归属、唯一名称与预期 revision。成员可读，不能写。template_snapshot 供持有组织锁的 projects 创建/导入事务调用；同组织锁覆盖模板编辑/删除，版本不匹配抛 TemplateConflict。无 Admin 写入口和历史事件平行机制。来源说明仅为文字，不读取路径/URL或上传字体。
