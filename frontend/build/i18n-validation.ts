/** Locale-independent catalog validation shared by the CLI and its unit tests. */
export function flattenCatalog(value: unknown, prefix = ''): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid catalog at ${prefix}`);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') {
      if (!item.trim()) throw new Error(`Empty translation: ${path}`);
      return [[path, item]];
    }
    return Object.entries(flattenCatalog(item, path));
  }));
}
const pluralSuffix = /_(zero|one|two|few|many|other)$/;
const placeholders = (value: string) => [...new Set([...value.matchAll(/\{\{\s*-?\s*([\w.]+)(?:,[^}]+)?\s*\}\}/g)].map(match => match[1]))].sort();
function families(catalog: Record<string, string>) {
  const result = new Map<string, { forms: Map<string, string>; base?: string }>();
  for (const [key, value] of Object.entries(catalog)) {
    const match = pluralSuffix.exec(key), base = match ? key.slice(0, match.index) : key;
    const family = result.get(base) ?? { forms: new Map<string, string>() };
    if (match) family.forms.set(match[1], value); else family.base = value;
    result.set(base, family);
  }
  return result;
}
export function validateCatalogs(catalogs: Record<string, unknown>, referenceLanguage: string): string[] {
  const errors: string[] = [];
  const reference = families(flattenCatalog(catalogs[referenceLanguage]));
  for (const [language, resource] of Object.entries(catalogs)) {
    const catalog = families(flattenCatalog(resource));
    for (const key of new Set([...reference.keys(), ...catalog.keys()])) {
      const expected = reference.get(key), actual = catalog.get(key);
      if (!expected || !actual) { errors.push(`${language}: missing or unknown semantic key ${key}`); continue; }
      const plural = expected.forms.size > 0 || actual.forms.size > 0;
      if (plural) {
        const required = new Intl.PluralRules(language).resolvedOptions().pluralCategories;
        for (const form of required) if (!actual.forms.has(form)) errors.push(`${language}: missing plural ${key}_${form}`);
      }
      const expectedParams = [...new Set([...expected.forms.values(), ...(expected.base ? [expected.base] : [])].flatMap(placeholders))].sort();
      for (const [form, value] of [...actual.forms, ...(actual.base ? [['base', actual.base] as const] : [])]) {
        const params = placeholders(value);
        // A language may omit count in a singular sentence, but other interpolation names are semantic contracts.
        if (JSON.stringify(params.filter(key => !plural || key !== 'count')) !== JSON.stringify(expectedParams.filter(key => !plural || key !== 'count'))) {
          errors.push(`${language}: placeholder mismatch ${key} (${form})`);
        }
      }
    }
  }
  return errors;
}
