/** Same-origin authenticated JSON transport supplied by the application root. */
export type JsonRequest = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
