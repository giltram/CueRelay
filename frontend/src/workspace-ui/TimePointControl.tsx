import { useId } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (value: string, nativeHistory: boolean) => void;
}

/** The same controls for each endpoint; interval validity belongs to the parent. */
export function TimePointControl(props: Props) {
  const inputId = useId();
  return (
    <div className="time-point">
      <label htmlFor={inputId}>{props.label}</label>
      <input id={inputId} aria-label={props.label} value={props.value} onChange={event => props.onChange(event.target.value, ['historyUndo', 'historyRedo'].includes((event.nativeEvent as InputEvent).inputType))} />
    </div>
  );
}
