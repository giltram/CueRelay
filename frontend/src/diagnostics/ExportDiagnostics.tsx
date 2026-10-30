import { useState } from 'react';
import { downloadDiagnostics } from './export';

export function ExportDiagnostics() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="diagnostic-export">
    <button disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void downloadDiagnostics().catch(() => setError('诊断信息导出失败，请重试。')).finally(() => setBusy(false));
    }}>{busy ? '正在导出…' : '导出诊断信息'}</button>
    <span>包含近期操作和环境信息，不包含密码等认证信息。</span>
    {error && <span role="alert">{error}</span>}
  </div>;
}
