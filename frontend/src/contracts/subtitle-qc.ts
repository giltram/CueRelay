/** Output of the existing ASS codec's read-only inspection. */
export interface AssFormatIssue {
  code: string;
  type: 'invalid-time' | 'missing-style' | 'unsupported-ass';
  message: string;
  reason?: string;
  params?: Record<string, unknown>;
  cue_id?: string;
  line?: number;
}
