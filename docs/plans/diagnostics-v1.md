# 诊断 v1 实施

范围：有界浏览器事件、IndexedDB、HTTP 请求关联、只读中文 JSON 导出；不恢复字幕，不上传日志，不新增服务端下载接口。

实施边界：diagnostics 是叶子模块；编辑历史向独立只读观察器提供不可变 before/after 引用，诊断 flush 不结束历史分组。账号客户端明确发布身份，IndexedDB control fence 串行化跨标签页清理，BroadcastChannel 只传失效通知；状态提供者有账号代次约束。请求只记录方法、路由模板、编号、状态和耗时，不采集 body/header。

默认预算：1500 条、每条 16KiB、总 2MiB、24 小时；2 秒批写。字幕逐行差异和样式白名单；长正文截断并报告。服务器最外层中间件关联所有 HTTP 结果，以 JSON 行输出，可选单进程轮换文件。请求编号不作业务或权限依据。

验证：纯安全/预算/隔离/格式测试，真实 IndexedDB 与 Chrome 输入/IME/导出回归，Django middleware/HTTP 结果测试，现有历史回归、类型检查和构建。部署环境的日志轮换查询在模块 README 说明。

实现收尾：已完成记录/安全处理/批量存储/导出、账号 fence、HTTP 双端关联、编辑历史只读观察器、媒体与 Worker 边界接入。正常 Django PermissionDenied/Http404 等保持 4xx，不进入通用 500。额外隐私边界：持久化与跨标签页协调都不可用时隐藏账号内容；原始错误文本不采集，避免不可识别的密码回显。实际验证统一记在 docs/experiments/diagnostics-v1.md。
