import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';
import { Modal } from '../page-ui/Modal';

/** Confirmation is account-owned; opening the handbook keeps native new-tab behavior. */
export function HandbookPrompt({ organizationId, navigate, onDismiss }: {
  organizationId?: number; navigate: (route: Route) => void; onDismiss: () => void;
}) {
  return <Modal title="开始使用 CueRelay" showCloseButton={false} onClose={onDismiss}>
    <p>使用手册包含第一条字幕的制作流程、试听与快捷键，以及从 Aegisub 迁移时需要适应的操作。</p>
    <p>之后也可以从「个人设置 → 使用手册」随时打开。</p>
    <div className="controls">
      <RouteLink className="button-link primary" route={{ kind: 'handbook', organizationId }} navigate={navigate}
        onClick={onDismiss} onAuxClick={event => { if (event.button === 1) onDismiss(); }}>打开使用手册</RouteLink>
      <button onClick={onDismiss}>稍后阅读</button>
    </div>
  </Modal>;
}
