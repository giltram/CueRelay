import type shortcuts from '../../../shared/timing-shortcuts.json';
type TimingShortcut = keyof typeof shortcuts;
import { t } from './index';
/** Physical codes stay in the shared shortcut contract; only labels are localized. */
export const shortcutName = (action: TimingShortcut) => t(`shortcuts.${action}`);
export const roleName = (role: 'organizer' | 'member' | null) => t(`common.roles.${role ?? 'dev'}`);
