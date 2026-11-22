# 真实浏览器测试

- `regression_fixture.py`唯一拥有一次性测试库守卫、真实身份/组织/单项目及8秒合成媒体。测试库必须来自`application.test_settings`且名称为`test_cuerelay_*`；不得改为开发库或keepdb。
- `regression.py`显式一一选择`frontend/regression/*.spec.mjs`的统一Chromium场景；必要的最终状态在Django中用ORM再次核对。`scripts/test_regression_selection.py`检查当前60个入口各选一例，无遗漏/重复。
- `platforms.py`只继承同一fixture，不继承整套统一测试；媒体、平台、生产、旧专项入口必须经`../../scripts/run_isolated_regression.py`提供进程适配器。默认直接执行会明确报错，不借用已有服务。
- `frontend/regression/helpers.mjs`组合登录/CSRF/真实项目读取等公共操作；`failure-helpers.mjs`只观察草稿/选择及恢复交互。未知写入通过route.fetch真实提交、独立GET核实后abort，禁止fulfill业务成功。
- 高层runner拥有新建/停止PostgreSQL、逐场空Vite缓存、envFile:false、证据目录/完整trace/JSON及退出检查；浏览器测试只访问真实公开HTTP，fixture播种/最终断言才直接调用服务/模型。没有产品测试路由或诊断下载API。

统一标准入口：`.venv/bin/python backend/manage.py test browser_tests.regression --settings=application.test_settings --noinput -v 2`。本轮无.env/独立冷缓存验收使用：`.venv/bin/python scripts/run_isolated_regression.py --suite full --pg-bin /absolute/postgres/bin`。所有实际结果、独立专项命令、资源预算和人工边界统一维护于 [测试手册](../../docs/testing.md) / [覆盖矩阵](../../docs/testing-coverage.md)。新场景必须同步显式入口及选择检查，不把历史通过、发现数或fixture当真实写库证据。
