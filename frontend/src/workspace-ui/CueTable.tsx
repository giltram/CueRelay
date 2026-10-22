import type { Cue } from '../contracts/subtitles';
import { formatTime } from '../media/playback';

interface Props {
  cues: Cue[];
  selectedId: string | null;
  currentTime: number;
  onSelect: (cue: Cue) => void;
  onLocate: (cue: Cue) => void;
}

export function CueTable({ cues, selectedId, currentTime, onSelect, onLocate }: Props) {
  // View order must not change the document's ASS event order.
  const ordered = cues.map((cue, order) => ({ cue, order })).sort((a, b) =>
    a.cue.start_ms - b.cue.start_ms || a.cue.end_ms - b.cue.end_ms || a.order - b.order);
  return <section className="cue-list">
    <div className="section-heading"><h2>字幕行 <span className="count">{cues.length}</span></h2><span>按时间浏览 · 保持 ASS 事件顺序</span></div>
    <div className="table-scroll"><table>
      <thead><tr><th>行</th><th>入点 / 出点</th><th>中文 / ASS 文本</th><th>样式</th><th>定位</th></tr></thead>
      <tbody>{ordered.map(({ cue }, index) => <tr key={cue.id}
        className={`${cue.id === selectedId ? 'selected' : ''} ${currentTime >= cue.start_ms && currentTime < cue.end_ms ? 'playing' : ''}`}>
        <td><button className="row-number" aria-label={`选择第 ${index + 1} 行`} onClick={() => onSelect(cue)}>{index + 1}</button></td>
        <td className="time-cell"><button onClick={() => onSelect(cue)}>{formatTime(cue.start_ms)}<br />{formatTime(cue.end_ms)}</button></td>
        <td><button className="cue-text" onClick={() => onSelect(cue)}>{cue.text || <em>空轴，待填写中文</em>}</button></td>
        <td>{cue.style}</td><td><button aria-label={`定位第 ${index + 1} 行`} onClick={() => onLocate(cue)}>↗ 定位</button></td>
      </tr>)}</tbody>
    </table>{!cues.length && <p className="empty">采集入点和出点，再创建第一条字幕。</p>}</div>
  </section>;
}
