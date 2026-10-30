import { audioStatus, diagnostics, workspaceStatus } from './index';
import { backendBuild } from './http';
import { FORMAT_VERSION } from './schema';
const build = import.meta.env.VITE_CUERELAY_BUILD || 'unknown';
export const frontendBuild = /^[\w.-]{1,80}$/.test(build) ? build : 'unknown';
const moduleLabels: Record<string, string> = { http: 'HTTP 请求', editor: '字幕编辑', workspace: '工作区', 'audio-analysis': '音频分析', 'audio-audition': '音频试听', 'ass-preview': '字幕预览', account: '账号', app: '页面', 'project-ui': '项目', 'style-ui': '样式', 'account-ui': '账号设置', media: '媒体' };
const outcomeLabels: Record<string, string> = { error: '错误', conflict: '冲突', unknown: '未收到响应，结果未知' };
export async function diagnosticReport() {
  const { events, coverage } = await diagnostics.collect();
  const workspace = workspaceStatus();
  const failures = events.filter(event => ['error', 'conflict', 'unknown'].includes(event.outcome)).slice(-10);
  const missing = [
    ...(coverage.storage === 'memory_fallback' ? ['浏览器持久化不可用或写入失败；仅包含可用内存及已读取记录。'] : []),
    ...(!coverage.accountIsolated ? ['账号隔离校验已失效或不可用，账号相关记录和工作区状态已隐藏。'] : []),
    ...(frontendBuild === 'unknown' || backendBuild === 'unknown' ? ['部分构建版本未知。'] : []),
    ...(coverage.evicted ? [`本页观察到 ${coverage.evicted} 条记录因预算或保留时间淘汰。`] : []),
    ...(coverage.truncated || events.some(event => event.truncated) ? ['部分字段已脱敏或截断。'] : []),
    ...(!workspace ? ['当前无可用工作区状态。'] : []),
    '仅覆盖近期有限记录；突然退出可能丢失最后一批。淘汰计数不包含其他已关闭页面的全部淘汰。',
  ];
  return {
    summary: { title: 'CueRelay 诊断信息', versions: `前端：${frontendBuild}；后端：${backendBuild}`,
      timeRange: events.length ? `${events[0].timestamp} 至 ${events.at(-1)!.timestamp}` : '无可用记录',
      recentIssues: failures.length ? failures.map(event => `${moduleLabels[event.module] ?? event.module}：${outcomeLabels[event.outcome] ?? event.outcome}${event.data.status ? `（HTTP ${event.data.status}）` : ''}${event.data.requestId ? `，请求 ${event.data.requestId}` : ''}`) : ['近期记录中未发现错误或冲突；不代表所有模块均正常。'],
      unsaved: workspace?.unsaved === true ? '存在未保存修改或未提交时间输入。' : workspace?.unsaved === false ? '当前未观察到未保存修改。' : '未保存状态未知。',
      missingInformation: missing, conclusion: '摘要仅列出观测结果；证据不足以自动判定根因。网络请求未收到响应时，服务端是否已提交未知。' },
    environment: { frontendBuild, backendBuild, exportedAt: new Date().toISOString(),
      page: diagnostics.contextSnapshot(), browser: browserEnvironment(), workspace, audioAnalysis: audioStatus(), network: { browserOnline: navigator.onLine, serverReachability: 'unknown' } },
    events,
    metadata: { formatVersion: FORMAT_VERSION, coverage, source: { tabId: diagnostics.tabId, sessionId: diagnostics.sessionId },
      ordering: '同一 sessionId 按 sequence 分析先后，elapsedMs 为单调时钟；跨来源不能仅凭墙上时间断言因果。',
      collection: '默认有限记录。允许字幕业务正文；不含认证信息、媒体字节、文件名、摘要、原始请求/响应/console。不是文档备份或重放格式。' },
  };
}
function browserEnvironment() {
  const ua = navigator.userAgent;
  return { browser: /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'unknown',
    browserVersion: ua.match(/(?:Edg|Chrome|Firefox|Version)\/([\d.]+)/)?.[1] ?? 'unknown',
    system: /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown',
    viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio },
    capabilities: Object.fromEntries(['indexedDB', 'Worker', 'AudioContext', 'AudioDecoder', 'OffscreenCanvas', 'WebAssembly', 'VideoDecoder'].map(name => [name, name in globalThis])),
    secureContext: isSecureContext, crossOriginIsolated,
  };
}
export async function downloadDiagnostics() {
  const report = await diagnosticReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  // 2MiB event budget plus indentation/environment. Guard export independently of storage.
  if (blob.size > 8 * 1024 * 1024) throw new Error('export_size_limit');
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `cuerelay-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; anchor.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
