import { EditDiagnostics } from './edit-diagnostics';
import { diagnostics } from '../diagnostics';
import { useEffect, useRef, useState } from 'react';
import { createHistory, endGroup, navigate, record, redo, sameEdit, undo, type EditState } from './edit-history';

/** Synchronous ref makes multi-event gestures and React batching deterministic. */
export function useEditHistory(initial: EditState, diagnosticOwner?: number) {
  const [observer] = useState(() => new EditDiagnostics(undefined, diagnosticOwner));
  useEffect(() => {
    const remove = diagnostics.addFlusher(() => observer.flush());
    return () => { observer.flush(); remove(); };
  }, [observer]);
  const history = useRef(createHistory(initial));
  const [state, setState] = useState(initial);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const composition = useRef(false);
  const input = useRef({ key: '', time: 0 });
  const publish = () => setState(history.current.present);
  function finish() { observer.flush(); history.current = endGroup(history.current); input.current.key = ''; generation.current++; }
  function apply(next: EditState, group: string | null = null) {
    const previous = history.current.present;
    history.current = record(history.current, next, group);
    observer.observe(previous, history.current.present, group); publish();
  }
  return {
    state, epoch,
    current: () => history.current.present,
    finish,
    beginComposition() { finish(); composition.current = true; },
    endComposition() { composition.current = false; finish(); },
    edit(next: EditState, inputKey?: string, nativeHistory = false) {
      if (sameEdit(history.current.present, next)) return;
      if (nativeHistory) {
        // Browser undo stacks are opaque. An observed native history input is
        // an explicit safe boundary, never replayed again by workspace redo.
        finish(); observer.observe(history.current.present, next, null, 'native_history'); history.current = createHistory(next); publish(); return;
      }
      let group: string | null = null;
      if (inputKey) {
        const now = Date.now();
        if (input.current.key !== inputKey || (!composition.current && now - input.current.time > 1000)) finish();
        input.current = { key: inputKey, time: now };
        group = `input:${inputKey}:${generation.current}`;
      } else finish();
      apply(next, group);
    },
    navigate(next: EditState) { finish(); history.current = navigate(history.current, next); publish(); },
    baseline(next: EditState) { finish(); history.current = createHistory(next); setEpoch(value => value + 1); publish(); },
    travel(direction: 'undo' | 'redo') {
      finish();
      const previous = history.current.present;
      history.current = direction === 'undo' ? undo(history.current) : redo(history.current);
      observer.observe(previous, history.current.present, null, direction);
      if (!sameEdit(previous, history.current.present)) setEpoch(value => value + 1);
      publish();
    },
    beginGesture() {
      finish();
      const token = generation.current;
      const group = `gesture:${token}`;
      return {
        change: (update: (state: EditState) => EditState) => {
          if (generation.current === token) apply(update(history.current.present), group);
        },
        end: () => { if (generation.current === token) finish(); },
      };
    },
  };
}
