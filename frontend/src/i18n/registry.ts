import languages from '../../../shared/languages.json';
import { pseudoResource } from './pseudo';

export type ProductLanguage = keyof typeof languages;
export type SupportedLanguage = ProductLanguage | 'en-XA';
export type LanguagePreference = 'system' | SupportedLanguage;
const resourceFiles = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', { eager: true, import: 'default' });
const resourcesFor = (id: string) => Object.fromEntries(Object.entries(resourceFiles)
  .filter(([path]) => path.startsWith(`./locales/${id}/`))
  .map(([path, resource]) => [path.split('/').at(-1)!.replace(/\.json$/, ''), resource]));
/** The registry owns menus, resources, negotiation and fallback. en-XA never reaches the server. */
export const languageOptions = [
  ...Object.entries(languages).map(([id, config]) => ({ id: id as SupportedLanguage, ...config,
    resources: resourcesFor(id), testOnly: false })),
  ...(import.meta.env.DEV || import.meta.env.MODE === 'test' ? [{
    id: 'en-XA' as const, label: 'Pseudo (expanded)', browserLanguages: [] as string[], handbook: 'handbook.en.md', fallback: false,
    resources: pseudoResource(resourcesFor('en')) as Record<string, unknown>, testOnly: true,
  }] : []),
];
export const locales = Object.fromEntries(languageOptions.map(option => [option.id, option]));
export const fallbackLanguage = languageOptions.find(option => option.fallback)!.id;
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || typeof value === 'string' && Object.hasOwn(locales, value);
}
export function resolveLanguage(preference: LanguagePreference, browserLanguages: readonly string[]): SupportedLanguage {
  if (preference !== 'system' && Object.hasOwn(locales, preference)) return preference;
  for (const language of browserLanguages) {
    const code = language.toLowerCase();
    const match = languageOptions.find(option => !option.testOnly && option.browserLanguages.some(prefix => code === prefix || code.startsWith(prefix + '-')));
    if (match) return match.id;
  }
  return fallbackLanguage;
}
