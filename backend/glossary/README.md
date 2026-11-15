# glossary

拥有组织默认/项目术语表数据及 Entry；不拥有项目关联、不依赖 projects/HTTP/ASS。组织默认以 `is_organization_default` 条件唯一约束标识，一组织至多一张，身份不可更换。迁移0002将既有表保留为非默认，不合并旧数据。

公开边界 services.py：organization_table（查询或原子具象默认）、table_summary、list_entries、read_entry、save_organization_entry、fork_organization_table、save_entry。组织表首次成功添加原子建表/写词条，读取不创建空表。fork从当前组织默认完整快照复制三字段，分批500条、新UUID/revision1/操作者时间，无来源、新旧区分或后续同步；空源可fork空项目表。项目归属、只读/归档和引用数由 projects 公开编排服务负责；外部不得访问本模块私有ORM。

写入 User → Organization → Glossary → Entry；上层持有相同 User/Organization 及 Project 锁后可调用。组织写入与fork在组织锁下串行，所以复制一致；失败事务全部回滚。无signals/全局共享业务状态。组织默认只能经组织设置HTTP维护；项目上下文禁止写默认表，必须先fork。

`shared/glossary-limits.json` 双端唯一限制：原词/译名各200 Unicode码点，备注2000，表名100，搜索200。trim后必填非空，拒绝NUL/非法Unicode。普通文本存储/展示，同表原词+译名完全相同唯一（编辑排除自身），同原词允许不同译名。查询三字段ORM icontains字面包含、忽略拉丁大小写，每页25。词条独立revision/CAS，不依赖字幕保存版本。

完整权限、项目关联和HTTP见 [术语契约](../../docs/glossary.md)。测试：projects.test_glossary / test_glossary_migration（真实PostgreSQL、独立连接并发、失败回滚、旧数据保留）。
