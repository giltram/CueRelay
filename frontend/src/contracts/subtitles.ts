/** Milliseconds on a 10ms grid. Raw ASS text uses \N, not HTML. */
export interface Cue {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  style: string;
}

/** source is a validated raw template, owned by the backend codec. */
export interface AssDocument {
  source: string;
  styles: string[];
  cues: Cue[];
}
