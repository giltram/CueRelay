import { useEffect, useRef, useState } from 'react';
import type { JsonRequest } from '../contracts/http';
import type { MessageValue } from '../contracts/messages';
import { applyLanguage, isLanguagePreference, type LanguagePreference } from './index';

const anonymousKey = 'cuerelay.anonymous-language';
interface AccountChoice {
  userId: number;
  preference: LanguagePreference;
  sequence: number;
  phase: 'pending' | 'saved' | 'failed' | 'transient';
  error: MessageValue;
}
function anonymousPreference(): LanguagePreference {
  try { const value = localStorage.getItem(anonymousKey); return isLanguagePreference(value) ? value : 'system'; }
  catch { return 'system'; }
}
/** Identity-scoped optimistic preference. Neither account values nor pending replies leak to another account. */
export function useLanguagePreference(userId: number | null, ready: boolean, saved: LanguagePreference | undefined,
  request: JsonRequest, onSaved: (preference: LanguagePreference) => void) {
  const [anonymous] = useState(anonymousPreference);
  const [choice, setChoice] = useState<AccountChoice | null>(null);
  const sequence = useRef(0);
  const actor = useRef(userId); actor.current = userId;
  const previousActor = useRef(userId);
  if (previousActor.current !== userId) { previousActor.current = userId; sequence.current++; }
  const activeChoice = choice?.userId === userId && choice.sequence === sequence.current ? choice : null;
  // A successful choice only bridges initial hydration. Once ready, App's saved
  // preference owns display even when a newer remote write differs from our choice.
  const preference: LanguagePreference = userId === null ? anonymous
    : activeChoice && (activeChoice.phase !== 'saved' || !ready) ? activeChoice.preference
      : ready && saved && isLanguagePreference(saved) ? saved : 'system';
  useEffect(() => {
    if (ready && activeChoice?.phase === 'saved') {
      setChoice(current => current === activeChoice ? null : current);
    }
  }, [ready, activeChoice]);
  useEffect(() => {
    applyLanguage(preference);
    const changed = () => { if (preference === 'system') applyLanguage(preference); };
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, [preference]);
  async function select(next: LanguagePreference) {
    const id = userId;
    if (id === null) return;
    const serial = ++sequence.current;
    applyLanguage(next);
    const selected = { userId: id, preference: next, sequence: serial };
    // Development pseudo language is transient and never becomes an account preference.
    if (next === 'en-XA') { setChoice({ ...selected, phase: 'transient', error: '' }); return; }
    setChoice({ ...selected, phase: 'pending', error: '' });
    try {
      const result = await request<{ language_preference: LanguagePreference }>('/me/settings', 'PATCH', { language_preference: next });
      if (actor.current !== id || sequence.current !== serial) return;
      onSaved(result.language_preference);
      setChoice({ ...selected, preference: result.language_preference, phase: 'saved', error: '' });
    } catch (reason) {
      if (actor.current === id && sequence.current === serial) setChoice({ ...selected, phase: 'failed', error: reason as Error });
    }
  }
  return { preference, select, pending: activeChoice?.phase === 'pending',
    error: activeChoice?.phase === 'failed' ? activeChoice.error : '' };
}
