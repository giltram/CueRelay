interface Props {
  label: string;
  value: string;
  captureKey: string;
  decreaseKey: string;
  increaseKey: string;
  onChange: (value: string) => void;
  onCapture: () => void;
  onNudge: (delta: number) => void;
}

/** The same controls for each endpoint; interval validity belongs to the parent. */
export function TimePointControl(props: Props) {
  return (
    <div className="time-point">
      <label>
        {props.label}
        <input aria-label={props.label} value={props.value} onChange={event => props.onChange(event.target.value)} />
      </label>
      <div className="point-actions">
        <button aria-label={`设为当前 [${props.captureKey}]`} onClick={props.onCapture}>
          当前时间 <kbd>{props.captureKey}</kbd>
        </button>
        <button aria-label={`−10ms [${props.decreaseKey}]`} onClick={() => props.onNudge(-10)}>
          −10ms <kbd>{props.decreaseKey}</kbd>
        </button>
        <button aria-label={`+10ms [${props.increaseKey}]`} onClick={() => props.onNudge(10)}>
          +10ms <kbd>{props.increaseKey}</kbd>
        </button>
      </div>
    </div>
  );
}
