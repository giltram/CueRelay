import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { TranslationResources } from './resource-types';
import { fallbackLanguage, languageOptions, resolveLanguage, type LanguagePreference } from './registry';
import type { MessageDescriptor, MessageValue } from '../contracts/messages';
export { MessageError } from '../contracts/messages';
export { locales, languageOptions, isLanguagePreference, resolveLanguage } from './registry';
export type { LanguagePreference } from './registry';
export type { MessageDescriptor, MessageValue } from '../contracts/messages';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    returnNull: false;
    strictKeyChecks: true;
    resources: { translation: TranslationResources };
  }
}
import type { MessageKey } from '../contracts/message-keys';
export type { MessageKey } from '../contracts/message-keys';
export function msg(key: MessageKey, params?: Record<string, unknown>): MessageDescriptor { return { key, params }; }
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(languageOptions.map(option => [option.id, { translation: option.resources }])),
  lng: fallbackLanguage, fallbackLng: fallbackLanguage, supportedLngs: languageOptions.map(option => option.id),
  initAsync: false, interpolation: { escapeValue: false }, react: { useSuspense: false }, returnNull: false,
});
/** Stable identity: subscriptions rerender views without invalidating resource-owning effects. */
export const t = i18n.t.bind(i18n);
export function formatMessage(value: MessageValue | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const descriptor = (value as Error & { descriptor?: MessageDescriptor }).descriptor;
    return descriptor ? formatMessage(descriptor) : value.message;
  }
  const formatParam = (item: unknown): unknown => Array.isArray(item) ? item.map(formatParam).join('\n')
    : item && typeof item === 'object' && ('key' in item || item instanceof Error) ? formatMessage(item as MessageValue) : item;
  const params = Object.fromEntries(Object.entries(value.params ?? {}).map(([key, item]) => [key, formatParam(item)]));
  // Network descriptors are checked at this presentation boundary; unknown reasons retain exact legacy details.
  return i18n.t(value.key as MessageKey, { ...params, defaultValue: value.fallback ?? value.key });
}
export function applyLanguage(preference: LanguagePreference) {
  void i18n.changeLanguage(resolveLanguage(preference, typeof navigator === 'undefined' ? [] : navigator.languages));
}
function syncDocument(language: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = t('common.pageTitle');
}
i18n.on('languageChanged', syncDocument);
syncDocument(i18n.language);
