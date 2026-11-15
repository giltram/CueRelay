# 组织默认与项目fork验证（2026-11-13）

按用户确认实现：组织表只在组织设置维护；项目默认只读当前组织表；需要项目修改时显式fork全部当前组织词条成为独立副本，复制词条和新增词条无区别，之后不接收源更新也不回写。保留本任务开始前已有修改，未commit/push/部署或修改开发库。

## 实际执行

| 检查 | 结果 |
| --- | --- |
| Django check + makemigrations --check --dry-run（test_settings） | 无问题、No changes detected |
| 全量 accounts/ass_format/http_api/organizations/glossary/projects/diagnostics | 202项，201通过、1跳过 |
| projects.test_glossary + test_glossary_migration | 纳入全量；组织默认、快照复制、并发、权限/归档、失败回滚、分页、CAS、旧数据保留 |
| browser_tests.regression（真实Django/PostgreSQL/Playwright） | 3项通过：原保存/刷新/历史、原字幕冲突保护、新组织维护及项目fork双向隔离 |
| Vitest 全量 | 49文件、415项通过 |
| npm run typecheck、npm run build | 通过 |
| npm run test:glossary | 通过；最终44次术语分页查询、105次总请求，零页面错误/重复React key/意外请求/字幕保存 |
| project-settings、style-management、compact-layout专项浏览器 | 通过，组织/项目设置与现有样式、窄屏和保留实例兼容 |
| 新后端叶子导入边界、前端静态导入环（15文件）、git diff --check | 通过 |

后端用先前在临时目录创建的隔离PostgreSQL测试集群，loopback55433。各Django命令创建/销毁独立测试数据库，不加载开发环境或连接开发数据；本轮结束已停止专用测试集群及Vite。

后端覆盖首次组织添加合流到同一默认表；无表读取不创建资源；新旧无显式关联项目默认共享；空源fork独立空表；511条完整分批复制；新词条ID/revision重建；不同项目分别fork；fork与组织更新一致快照；竞争fork只一个成功；复制和关联写后注入失败无部分表/词条；复制旧词条可自由编辑、项目新增不回写、源更新/新增不进入副本；归档默认读取最新/副本保持独立；成员fork和管理员切回权限；跨组织/停用/CSRF/严格字段校验/词条冲突；旧默认/显式表ID和关联版本保留；字幕快照/revision/更新时间不变并继续可保存。

新增真实E2E通过浏览器登录→组织设置添加→项目默认只读→fork→修改复制的旧词条/添加新词条→组织修改/新增→API及刷新断言双向隔离，验证源/副本ID不同且字幕revision/document完全不变。真实链路首次发现此前表单初始化使用整个词条DTO，编辑请求会夹带id/updated_by/updated_at而被严格HTTP白名单拒绝（400）；已将表单状态限制为三字段，并在glossary-data传输中再次明确只发送可写字段。新增api.test.ts防止此回归，后端校验没有放宽。

专项浏览器仍采用内存HTTP fixture，用真实Chrome/合成媒体/唯一Python codec覆盖故障与迟到响应矩阵：组织设置/默认只读、fork失败重试、复制后编辑、切回组织默认及取消本地草稿、组织/副本双向隔离、归档、宽窄侧栏/QC互斥、选区/光标/切行/撤销重做/IME、视频未验证时可查询fork且不能插入、播放器节点保留、播放/字幕输入不发术语查询，以及项目/账号切换和撤权后旧响应隔离。检查桌面、窄屏和组织设置截图，并验证144px最小字幕区域内整侧栏滚动仍可访问查询和fork控件；术语表首列覆盖原字幕表56px宽度，避免组织设置内原词被挤成逐字换行。

## 迁移与边界

新增 glossary.0002（组织默认标记+唯一约束）及 projects.0004（移除旧auto_created特例）。已有表/项目FK/词条ID/版本完整保留，不合并入组织默认；无显式表的项目动态使用组织默认。需要在实际运行环境执行 migrate 后使用；本次仅在隔离测试库迁移。

唯一跳过为既有Nginx代理检查（本机未安装Nginx）。构建保留现有JS大于500kB提示，未新增运行时依赖或扩大拆包改造。当前不提供历史副本选择器、删除/重命名、持续同步或归档快照；Firefox/Safari及真实长视频未在本轮新增验收。
