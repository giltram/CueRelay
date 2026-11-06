import { useState } from 'react';
import { downloadDiagnostics } from './export';

export function ExportDiagnostics({ onError }: { onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <div className="diagnostic-export">
    <button disabled={busy} onClick={() => {
      setBusy(true); onError('');
      void downloadDiagnostics().catch(() => onError('诊断信息导出失败，请重试。')).finally(() => setBusy(false));
    }}>{busy ? '正在导出…' : '导出诊断信息'}</button>
    <span>包含用户名、用户 ID、权限、近期操作和环境信息。</span>
  </div>;
}
