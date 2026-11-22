import { describe, expect, it } from 'vitest';
import defaults from '../../../shared/member-permissions.json';
import { permits, memberPermissionKeys } from './permissions';

describe('business authority stays independent from identity authority', () => {
  it('uses the compatibility defaults only when effective data is absent', () => {
    for (const key of memberPermissionKeys) {
      expect(permits({ can_manage: false }, key)).toBe(defaults[key]);
      expect(permits({ can_manage: true }, key)).toBe(true);
      expect(permits(undefined, key)).toBe(false);
    }
  });
  it('keeps every grant and restriction independent', () => {
    for (const selected of memberPermissionKeys) {
      const permissions = Object.fromEntries(memberPermissionKeys.map(key => [key, key === selected])) as typeof defaults;
      for (const key of memberPermissionKeys) {
        expect(permits({ can_manage: false, effective_permissions: permissions }, key)).toBe(key === selected);
      }
    }
  });
});
