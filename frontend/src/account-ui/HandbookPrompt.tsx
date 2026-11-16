import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import { RouteLink } from '../navigation/RouteLink';
import type { Route } from '../navigation/routes';
import { Modal } from '../page-ui/Modal';

/** Confirmation is account-owned; opening the handbook keeps native new-tab behavior. */
export function HandbookPrompt({ organizationId, navigate, onDismiss }: {
  organizationId?: number; navigate: (route: Route) => void; onDismiss: () => void;
}) {
  useLocale();
  return <Modal title={t("accountUi.gettingStartedWithCuerelay")} showCloseButton={false} onClose={onDismiss}>
    <p>{t("accountUi.theHandbookCoversYourFirstSubtitleAudioPlayback")}</p>
    <p>{t("accountUi.youCanAlsoOpenItAnytimeFromPersonal")}</p>
    <div className="controls">
      <RouteLink className="button-link primary" route={{ kind: 'handbook', organizationId }} navigate={navigate}
        onClick={onDismiss} onAuxClick={event => { if (event.button === 1) onDismiss(); }}>{t("accountUi.openHandbook")}</RouteLink>
      <button onClick={onDismiss}>{t("accountUi.readLater")}</button>
    </div>
  </Modal>;
}
