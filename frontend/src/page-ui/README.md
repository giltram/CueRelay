# 页面布局与顶栏提示

`PageLayout` 是共享页面容器，接收 main 的原生属性/ref，以及 title、actions、navigation 插槽。所有完整页面共用固定 44px 顶栏；消息区可在栏内滚动，消息出现、更新或消失不会增加页面高度。窄屏工具栏允许横向滚动，控件不换行撑高顶栏。

`HeaderNotice` 通过 React context/portal 将声明处的提示渲染到所属 PageLayout 的顶栏，默认 role=status，错误可指定 role=alert。消息文本、状态、重试动作及生命周期仍由调用模块持有；不建立全局消息队列、定时器或业务状态。隐藏保留的工作区拥有独立目标，不会向其他页面发布旧提示。组件必须位于 PageLayout 内；弹窗的表单校验/确认仍留在弹窗内，保证 dialog 的可访问性和焦点边界。

依赖：React / ReactDOM。页面、账号、项目、工作区、样式及诊断展示组件可向下依赖此模块；此模块不读取路由、业务数据或网络。

浏览器验证：`frontend/browser-tests/compact-layout.mjs`。
