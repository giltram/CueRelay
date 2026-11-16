import { formatMessage, t } from '../i18n';
import { useLocale } from "../i18n/react";
import type { useCueSearch } from './use-cue-search';

export function CueSearchBar({ search, enabled }: { search: ReturnType<typeof useCueSearch>; enabled: boolean }) {
  useLocale();
  return <div className="cue-search-bar" data-cue-search onKeyDown={event => {
    // Keep every key, including configured timing keys, inside this form surface.
    event.stopPropagation();
    if (event.target === search.input.current && event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
      && !search.composing.current && !event.repeat) {
      event.preventDefault(); search.navigate(event.shiftKey ? 'previous' : 'next');
    }
  }}>
    <input ref={search.input} aria-label={t("workspaceUi.findSubtitleText")} placeholder={t("workspaceUi.enterTextToFind")} value={search.query}
      disabled={!enabled} onChange={event => search.changeQuery(event.target.value)}
      onCompositionStart={() => { search.composing.current = true; }}
      onCompositionEnd={() => { search.composing.current = false; }} />
    <span className="cue-search-status" role="status" aria-live="polite" aria-atomic="true">{formatMessage(search.status)}</span>
    <button disabled={!enabled || !search.matches.length} onClick={() => search.navigate('previous')}>{t("workspaceUi.previous")}</button>
    <button disabled={!enabled || !search.matches.length} onClick={() => search.navigate('next')}>{t("workspaceUi.next")}</button>
  </div>;
}
