# 前端路径与部署

2026-10-24。前端使用根路径 History URL；不使用 hash 路由，不假定子目录部署。页面路径见 [导航契约](../frontend/src/navigation/README.md)。刷新项目地址读取指定项目的服务器快照，本地视频/未保存草稿不会随 URL 恢复。

## 开发与构建检查

Vite dev/preview 使用 SPA 入口回退；`/api`、`/admin`、`/static` 代理到 `CUERELAY_API_TARGET`（默认 127.0.0.1:8000）。代理路径保留，API/Admin 错误不返回前端 HTML。默认前端端口仍是 5173；切换端口时需把该 Origin 加入 Django 的 CSRF_TRUSTED_ORIGINS。

```sh
cd frontend
npm run dev
# 独立验证构建产物；preview 只是本机验收入口，不充当生产服务
npm run build
npm run preview
```

## 生产静态入口

仓库提供 [Nginx 示例](../deploy/nginx.conf.example) 和 [前端响应头片段](../deploy/frontend-headers.conf)。使用前根据实际部署修改域名、监听端口、构建目录、Django 上游与 collectstatic 目录：

1. 发布 frontend/dist。把响应头片段安装为 `/etc/nginx/snippets/cuerelay-frontend-headers.conf`；配置文件放入现有 Nginx http 上下文。
2. Django Admin 静态文件需通过实际部署 settings 配置 STATIC_ROOT 并执行 collectstatic，发布到示例 alias 对应目录。开发时这些文件由 Django DEBUG 服务，不要将该方式用于生产。
3. `/api`、`/api/`、`/admin`、`/admin/` 优先代理 Django；`/static/` 服务 Admin 静态资源；`/assets/` 仅服务存在的前端文件。上述路径缺失时不得回退到 index.html。
4. 前端路径回退到 index.html，由客户端处理未知页面。index.html 不缓存；前端页面/脚本/Worker 使用现有 COOP/COEP 和 CSP 边界。前端 CSP 仅施加到前端位置，避免改变 Django Admin 页面策略。生产 MIME 配置需正确包含 JS/CSS 类型。
5. 外部使用 HTTPS、DEBUG=0、实际 ALLOWED_HOSTS；保留安全 Cookie。示例 8080 仅展示路由边界，没有配置证书或承诺可直接上线；反向代理信任、TLS 和其他安全设置仍见 [账号安全](account-security.md)。不要随意信任客户端传入的转发头。
6. 发布前执行 nginx -t，然后从实际公网入口验收下列路径和登录/保存。仓库不会自动安装、启动 Nginx 或发布到生产。

| 请求 | 预期 |
| --- | --- |
| 组织列表、项目 workspace、本地 workspace、`/settings`、组织 settings、带组织的 personal/local 深路径（旧 projects/new 地址规范到列表） | 前端 HTML；资源以绝对根路径加载 |
| `/api/not-a-route` | Django 404，不能返回前端 HTML |
| `/admin/login/` | Django Admin 登录页 |
| `/static/admin/css/base.css` | Admin CSS |
| `/assets/missing.js` | 404，不能返回 HTML |
| 任意未知前端页面 | 前端入口，然后客户端显示页面不存在 |

## 导航浏览器回归

复用项目播种脚本，允许原有专用 `cuerelay_projects_browser` 或新建的 `cuerelay_navigation_browser_<数字后缀>`。必须 DEBUG=1 且没有已有账号；不覆盖业务库或已有测试账号。先自行创建数据库、设置 PGDATABASE、BROWSER_TEST_PASSWORD，加载数据库环境后运行：

```sh
python backend/manage.py migrate
python backend/manage.py shell < backend/browser_tests/seed_projects.py
# 启动连接该库的 Django 和 Vite 后，从仓库根执行
PROJECTS_URL=http://127.0.0.1:5173 node frontend/browser-tests/navigation.mjs
PROJECTS_URL=http://127.0.0.1:5173 node frontend/browser-tests/tab-navigation.mjs
# 改为 preview 地址即可对构建产物执行同一回归
# 也可从 frontend 执行 PROJECTS_URL=... npm run test:navigation
```

需要已安装的 Chrome、FFmpeg 和 frontend/package-lock.json 对应依赖。测试使用合成 MP4、真实 Session/权限/项目 API；503 和延迟响应用浏览器请求拦截注入。输出截图与检查结果到系统临时目录。该验证不代替生产代理、真实片源或其他浏览器验收。实际执行结果见 [导航验证记录](experiments/frontend-navigation.md)。

`tab-navigation.mjs` 验证普通点击的默认新标签页规则、仅列表可换组织、非默认组织上下文、新建当前页弹窗复用本页 File，以及原工作区不暂停。其余历史/稿件保护脚本通过 link-navigation.sameTab 显式使用当前页，继续覆盖原有保护边界。浏览器允许新标签页是原生链接行为，无自动弹窗或跨窗口文件传输。

创建弹窗回归：复用一次性项目测试库，在仓库根执行 `PROJECTS_URL=... node frontend/browser-tests/project-form.mjs`，或从 frontend 执行 `npm run test:project-form`。覆盖 input cancel 冒泡、空选片、单页字段、焦点恢复、失败重试、当前标签页/历史和 File 复用；不自动操作原生 macOS Finder 窗口。
