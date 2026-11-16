import type { MessageKey } from './message-keys';
/** Language-independent presentation request. Domain modules never resolve a locale. */
export interface MessageDescriptor {
  key: string;
  params?: Record<string, unknown>;
  /** Legacy text for older callers; the UI resolves key/params at render time. */
  fallback?: string;
}
export type MessageValue = string | MessageDescriptor | Error;
export function legacyMessage(value: MessageValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return (value.fallback ?? value.key).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const item = value.params?.[key];
    return item && typeof item === 'object' && ('key' in item || item instanceof Error)
      ? legacyMessage(item as MessageValue) : String(item ?? '');
  });
}
export class MessageError extends Error {
  readonly descriptor?: MessageDescriptor;
  constructor(value: MessageValue, options?: ErrorOptions) {
    super(legacyMessage(value), options);
    this.descriptor = typeof value === 'object' && !(value instanceof Error) ? value
      : value instanceof MessageError ? value.descriptor : undefined;
  }
}
export function describe(key: MessageKey, fallback: string, params?: Record<string, unknown>): MessageDescriptor {
  return { key, fallback, params };
}

export interface WireMessage { message: string; reason?: string; params?: Record<string, unknown>; line?: number; details?: WireMessage[] }
/** Preserve exact details from old servers; never infer a reason by matching translated text. */
export function messageFromWire(value: WireMessage): MessageValue {
  if (value.details?.length) return { key: 'common.messageList', params: { messages: value.details.map(messageFromWire) }, fallback: value.message };
  const reason: MessageValue = value.reason ? { key: value.reason, params: value.params, fallback: value.message } : value.message;
  return value.line ? { key: 'common.sourceLine', params: { line: value.line, reason }, fallback: `第 {{line}} 行：{{reason}}` } : reason;
}
export function messagesFromWire(values: WireMessage[]): MessageDescriptor {
  return { key: 'common.messageList', params: { messages: values.map(messageFromWire) }, fallback: values.map(value => legacyMessage(messageFromWire(value))).join('\n') };
}
/** Structured-clone-safe error payload for Worker boundaries. */
export function errorMessage(value: unknown): MessageValue {
  return value instanceof MessageError && value.descriptor ? value.descriptor
    : value instanceof Error ? value.message : String(value);
}
