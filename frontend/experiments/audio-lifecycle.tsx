// Development-only harness: permit rapid replacements that the production fixed-file workflow disallows.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioAnalysis } from '../src/media/audio/use-audio-analysis';

function Session({ file }: { file: File | null }) {
  const [start, setStart] = useState(0);
  const state = useAudioAnalysis(file, start, start + 10, 'spectrum');
  return <>
    <button onClick={() => setStart(value => (value + 7) % 30)}>换区间</button>
    <output data-state={state.status} data-tiles={state.tiles.length} data-cache={state.cacheBytes}>{state.message || state.status}</output>
  </>;
}
function Probe() {
  const [file, setFile] = useState<File | null>(null);
  const [mounted, setMounted] = useState(true);
  return <>
    <input aria-label="验证文件" type="file" onChange={event => setFile(event.target.files?.[0] || null)} />
    <button onClick={() => setFile(null)}>清除文件</button>
    <button onClick={() => setMounted(value => !value)}>装卸组件</button>
    {mounted && <Session file={file} />}
  </>;
}
createRoot(document.querySelector('#root')!).render(<Probe />);
