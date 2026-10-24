import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog className="account-dialog" ref={ref} aria-label={title} onCancel={event => {
    // File inputs also emit a bubbling cancel event when their picker closes.
    if (event.target !== event.currentTarget) return;
    event.preventDefault(); onClose?.();
  }}>
    <div className="dialog-heading"><h2>{title}</h2>{onClose && <button onClick={onClose}>关闭</button>}</div>
    {children}
  </dialog>;
}
