/** One weighted LRU; callers account for every retained typed array. No persistence or global state. */
export class ByteCache<T> {
  private entries = new Map<number, { value: T; bytes: number }>();
  bytes = 0;
  constructor(readonly limit: number) {}

  get(key: number): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  put(key: number, value: T, bytes: number) {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    if (bytes > this.limit) return;
    while (this.bytes + bytes > this.limit && this.entries.size) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }
}
