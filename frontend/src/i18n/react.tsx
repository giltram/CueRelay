import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMessage, type MessageValue } from './index';
/** Subscribe without changing any callback identities supplied to resource-owning effects. */
export function useLocale() { return useTranslation(undefined, { i18n: undefined }).i18n.language; }
export function useMessageState(initial: MessageValue | (() => MessageValue) = ''): [string, Dispatch<SetStateAction<MessageValue>>] {
  useLocale();
  const [value, setValue] = useState<MessageValue>(initial);
  return [formatMessage(value), setValue];
}
export function Message({ value }: { value: MessageValue }) { useLocale(); return <>{formatMessage(value)}</>; }
