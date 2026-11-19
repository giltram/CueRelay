import { useId } from 'react';
import { formatMessage, t } from '../i18n';
import { useLocale } from '../i18n/react';
import type { useCueSearch } from './use-cue-search';

export function CueSearchBar({ search, enabled, editable }: { search: ReturnType<typeof useCueSearch>; enabled: boolean; editable: boolean }) {
  useLocale();
  const replacementId = useId();
  const feedback = search.feedback;
  return <div className="cue-search-bar" data-cue-search onKeyDown={event => {
    // Leave native input undo, IME and button activation inside the search bar.
    event.stopPropagation();
    if (event.target === search.input.current && event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
      && !search.composing.current && !event.repeat) {
      event.preventDefault(); search.navigate(event.shiftKey ? 'previous' : 'next');
    }
  }}
    onCompositionStart={() => { search.composing.current = true; }}
    onCompositionEnd={() => { search.composing.current = false; }}>
    <div className="cue-search-row">
      <input ref={search.input} aria-label={t('workspaceUi.findSubtitleText')} placeholder={t('workspaceUi.enterTextToFind')} value={search.query}
        disabled={!enabled} readOnly={search.pending} onChange={event => search.changeQuery(event.target.value)} />
      <span className="cue-search-status" role="status" aria-atomic="true">{search.count
        ? <>{t('workspaceUi.searchMatchPosition', { position: search.position, count: search.count })}
          {' · '}{t('workspaceUi.searchMatchedLines', { count: search.matches.length })}</>
        : search.query ? t('workspaceUi.noMatches') : ''}</span>
      <div className="cue-search-actions">
        <button type="button" disabled={!enabled || search.pending || !search.count} onClick={() => search.navigate('previous')}>{t('workspaceUi.previous')}</button>
        <button type="button" disabled={!enabled || search.pending || !search.count} onClick={() => search.navigate('next')}>{t('workspaceUi.next')}</button>
        <button type="button" disabled={!enabled || !editable || search.pending} aria-expanded={search.expanded}
          aria-controls={search.expanded ? replacementId : undefined}
          aria-label={t(search.expanded ? 'workspaceUi.hideReplace' : 'workspaceUi.showReplace')}
          onClick={search.toggleReplacement}>{t('workspaceUi.replace')}</button>
      </div>
    </div>
    {search.expanded && <>
      <div className="cue-search-row" id={replacementId}>
        <textarea rows={1} ref={search.replacementInput} aria-label={t('workspaceUi.replacementText')} placeholder={t('workspaceUi.replaceWith')}
          disabled={!enabled || !editable} readOnly={search.pending} value={search.replacement}
          onChange={event => search.changeReplacement(event.target.value)} />
        <div className="cue-search-actions">
          <button type="button" aria-disabled={!search.canReplaceCurrent} onClick={() => void search.replace(false)}>{t('workspaceUi.replaceCurrentMatch')}</button>
          <button type="button" aria-disabled={!search.canReplaceAll} onClick={() => void search.replace(true)}>{t('workspaceUi.replaceAllMatches')}</button>
        </div>
      </div>
      <div className="cue-replace-feedback" role="status" aria-atomic="true">
        {search.pending ? t('workspaceUi.validatingReplacement')
          : !feedback ? null : 'message' in feedback ? formatMessage(feedback.message)
          : feedback.count ? t('workspaceUi.replacedMatches', { count: feedback.count }) : t('workspaceUi.replacementUnchanged')}
      </div>
    </>}
  </div>;
}
