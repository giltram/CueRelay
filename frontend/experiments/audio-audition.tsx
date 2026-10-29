// Development-only lifecycle probe. The production workbench uses the same hook/controller.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAudioAudition } from '../src/media/audio/use-audio-audition';

function Probe() {
  const [file, setFile] = useState<File | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(true);
  const audio = useAudioAudition(file, video, visible);
  const position = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const timer = setInterval(() => { if (position.current) position.current.textContent = String(audio.getPosition()); }, 25);
    return () => clearInterval(timer);
  }, [audio.getPosition]);
  return <>
    <input id="file" type="file" onChange={event => setFile(event.target.files?.[0] ?? null)} />
    <video ref={setVideo} />
    <button id="start" onClick={() => void audio.start({ start: 1230, end: 1870 })}>short</button>
    <button id="long" onClick={() => void audio.start({ start: 0, end: 15000 })}>long</button>
    <button id="stop" onClick={audio.stop}>stop</button>
    <button id="hide" onClick={() => setVisible(value => !value)}>visibility</button>
    <output id="position" ref={position} />
    <output id="state">{JSON.stringify(audio.state)}</output>
  </>;
}
function App() {
  const [mounted, setMounted] = useState(true);
  return <><button id="mount" onClick={() => setMounted(value => !value)}>mount</button>{mounted && <Probe />}</>;
}
createRoot(document.getElementById('root')!).render(<App />);
