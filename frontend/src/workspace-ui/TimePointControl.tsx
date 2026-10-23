interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** The same controls for each endpoint; interval validity belongs to the parent. */
export function TimePointControl(props: Props) {
  return (
    <div className="time-point">
      <label>
        {props.label}
        <input aria-label={props.label} value={props.value} onChange={event => props.onChange(event.target.value)} />
      </label>
    </div>
  );
}
