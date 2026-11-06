import type { ReactNode } from 'react';
import { HomeLink } from '../navigation/HomeLink';
import type { Route } from '../navigation/routes';
import { PageLayout } from '../page-ui/PageLayout';
import handbook from './handbook.md';
import './handbook.css';

/** The imported module contains repository Markdown precompiled by Vite. */
export function HandbookPage({ header, navigate }: { header: ReactNode; navigate: (route: Route) => void }) {
  return <PageLayout className="handbook-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <h2 className="handbook-title">使用手册</h2>
    <div className="handbook-layout">
      <nav className="handbook-toc" aria-label="手册目录">
        {handbook.chapters.map(({ id, title }) => <a key={id} href={`#${id}`} onClick={event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          // Chapter jumps scroll the article without adding unmanaged hash history.
          event.preventDefault(); document.getElementById(id)?.scrollIntoView();
        }}>{title}</a>)}
      </nav>
      <article className="handbook-content" aria-label="CueRelay 使用手册">
        {/* Only build-generated HTML from the trusted repository Markdown enters here. */}
        <div dangerouslySetInnerHTML={{ __html: handbook.introduction }} />
        {handbook.chapters.map(chapter => <section key={chapter.id} id={chapter.id}>
          <h2>{chapter.title}</h2>
          <div dangerouslySetInnerHTML={{ __html: chapter.html }} />
        </section>)}
      </article>
    </div>
  </PageLayout>;
}
