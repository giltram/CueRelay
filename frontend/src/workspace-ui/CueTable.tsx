import type { Cue } from '../contracts/subtitles';
import { formatTime } from '../media/playback';
import { orderCues } from './cue-order';

interface Props {
  cues: Cue[];
  selectedId: string | null;
  currentTime: number;
  onSelect: (cue: Cue) => void;
  onLocate: (cue: Cue) => void;
}

export function CueTable({ cues, selectedId, currentTime, onSelect, onLocate }: Props) {
  const ordered = orderCues(cues);
  return <section className="cue-list">
    <div className="section-heading"><h2>字幕 <span className="count">{cues.length} 行</span></h2><span>按时间排列</span></div>
    <div className="table-scroll"><table>
      <thead><tr><th scope="col">行</th><th scope="col">入点</th><th scope="col">出点</th><th scope="col">字幕文本</th><th scope="col">样式</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{ordered.map((cue, index) => <tr key={cue.id}
        className={`${cue.id === selectedId ? 'selected' : ''} ${currentTime >= cue.start_ms && currentTime < cue.end_ms ? 'playing' : ''}`}>
        <td><button className="row-number" aria-label={`选择第 ${index + 1} 行`} aria-pressed={cue.id === selectedId} onClick={() => onSelect(cue)}>{index + 1}</button></td>
        <td className="time-cell">{formatTime(cue.start_ms)}</td>
        <td className="time-cell">{formatTime(cue.end_ms)}</td>
        <td><button className="cue-text" onClick={() => onSelect(cue)}>{cue.text || <em>空轴，待填写中文</em>}</button></td>
        <td>{cue.style}</td><td><button className="text-button" aria-label={`定位第 ${index + 1} 行`} onClick={() => onLocate(cue)}>定位</button></td>
      </tr>)}</tbody>
    </table>{!cues.length && <p className="empty">还没有字幕。选好入点和出点，按 G / Enter 提交并开始下一条。</p>}</div>
  </section>;
}
