import type { useCueSearch } from './use-cue-search';

export function CueSearchBar({ search, enabled }: { search: ReturnType<typeof useCueSearch>; enabled: boolean }) {
  return <div className="cue-search-bar" data-cue-search onKeyDown={event => {
    // Keep every key, including configured timing keys, inside this form surface.
    event.stopPropagation();
    if (event.target === search.input.current && event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
      && !search.composing.current && !event.repeat) {
      event.preventDefault(); search.navigate(event.shiftKey ? 'previous' : 'next');
    }
  }}>
    <input ref={search.input} aria-label="查找字幕文本" placeholder="输入要查找的文本……" value={search.query}
      disabled={!enabled} onChange={event => search.changeQuery(event.target.value)}
      onCompositionStart={() => { search.composing.current = true; }}
      onCompositionEnd={() => { search.composing.current = false; }} />
    <span className="cue-search-status" role="status" aria-live="polite" aria-atomic="true">{search.status}</span>
    <button disabled={!enabled || !search.matches.length} onClick={() => search.navigate('previous')}>上一个</button>
    <button disabled={!enabled || !search.matches.length} onClick={() => search.navigate('next')}>下一个</button>
  </div>;
}
