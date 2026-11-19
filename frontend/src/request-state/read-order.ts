/** Ordering for reads of one resource in one caller-owned context. */
export class ReadOrder {
  private sequence = 0;
  private dataVersion = 0;
  private feedbackVersion = 0;

  start(): number { return ++this.sequence; }

  /** Whether this is the newest issued read; callers separately track completion. */
  isLatest(version: number): boolean { return version === this.sequence; }

  /** Successful data or an authoritative denial supersedes older data. */
  acceptData(version: number): boolean {
    if (version < this.dataVersion) return false;
    this.dataVersion = version;
    return true;
  }

  /** A transient error affects feedback, never the accepted data version. */
  acceptFeedback(version: number): boolean {
    if (version < this.feedbackVersion) return false;
    this.feedbackVersion = version;
    return true;
  }
}
