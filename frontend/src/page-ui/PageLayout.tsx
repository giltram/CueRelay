import { createContext, useContext, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const NoticeTarget = createContext<HTMLDivElement | null>(null);

/** Shared page shell; notices use this page's header, including retained workspaces. */
export function PageLayout({ title, actions, navigation, children, ...props }: Omit<ComponentPropsWithRef<'main'>, 'title'> & {
  title: ReactNode; actions?: ReactNode; navigation?: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return <NoticeTarget.Provider value={target}>
    <main {...props}>
      <header className="app-header">
        <h1>{title}</h1>
        {actions}
        <div className="header-notices" ref={setTarget} />
        {navigation}
      </header>
      {children}
    </main>
  </NoticeTarget.Provider>;
}

/** Presentation only: callers retain message state and render no extra body row. */
export function HeaderNotice({ children, ...props }: ComponentPropsWithRef<'div'>) {
  const target = useContext(NoticeTarget);
  return target ? createPortal(<div role="status" {...props}>{children}</div>, target) : null;
}
