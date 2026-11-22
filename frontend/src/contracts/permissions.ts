import defaults from '../../../shared/member-permissions.json';

export type BusinessPermission = keyof typeof defaults;
export type EffectivePermissions = Record<BusinessPermission, boolean>;
export const memberPermissionKeys = Object.keys(defaults) as BusinessPermission[];

/** can_manage remains identity management; business controls use these values. */
export function permits(organization: { can_manage: boolean; effective_permissions?: EffectivePermissions } | undefined, key: BusinessPermission): boolean {
  return Boolean(organization && (organization.effective_permissions?.[key] ?? (organization.can_manage || defaults[key])));
}
