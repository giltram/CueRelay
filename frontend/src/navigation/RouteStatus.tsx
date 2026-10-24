import type { ReactNode } from 'react';
import { RouteLink } from './RouteLink';
import { HomeLink } from './HomeLink';
import type { Route } from './routes';

export function RouteStatus({ header, loading, error, notFound, organizationId, navigate, retry, exportDraft }: {
  header: ReactNode; loading?: boolean; error?: Error; notFound?: boolean; organizationId?: number;
  navigate: (route: Route) => void; retry?: () => void; exportDraft?: () => void;
}) {
  const code = (error as { code?: string } | undefined)?.code;
  const text = loading ? '正在加载项目…' : notFound ? '页面不存在。' : code === 'permission_denied' ? '无权访问此组织或项目。'
    : code === 'not_found' ? '组织或项目不存在，或项目不属于指定组织。'
      : code === 'authentication_required' || code === 'account_changed' ? '请登录后继续打开此项目。' : '项目加载失败，请重试。';
  return <main className="projects-page">
    <header className="app-header"><h1><HomeLink navigate={navigate} /></h1>{header}</header>
    <p role={loading ? 'status' : 'alert'}>{text}</p>
    {error && <p>{error.message}</p>}
    <div className="controls">
      {!loading && retry && <button onClick={retry}>重试加载</button>}
      <RouteLink className="button-link" target="_self" route={{ kind: 'projects', organizationId }} navigate={navigate}>返回项目列表</RouteLink>
      {organizationId !== undefined && <RouteLink className="button-link" target="_self" route={{ kind: 'projects' }} navigate={navigate}>选择可访问的组织</RouteLink>}
      {exportDraft && <button onClick={exportDraft}>导出保留的工作区 ASS</button>}
    </div>
  </main>;
}
