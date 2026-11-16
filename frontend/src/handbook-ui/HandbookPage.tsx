import { t } from "../i18n";
import { useLocale } from "../i18n/react";
import type { ReactNode } from 'react';
import { HomeLink } from '../navigation/HomeLink';
import type { Route } from '../navigation/routes';
import { PageLayout } from '../page-ui/PageLayout';
import type { HandbookContent } from './content';
import { locales, fallbackLanguage } from '../i18n/registry';
import { pseudolocalize } from '../i18n/pseudo';
const handbooks = import.meta.glob('./handbook*.md', { eager: true, import: 'default' });
import './handbook.css';

/** The imported module contains repository Markdown precompiled by Vite. */
export function HandbookPage({ header, navigate }: { header: ReactNode; navigate: (route: Route) => void }) {
  const language = useLocale();
  const config = locales[language] ?? locales[fallbackLanguage];
  const original = handbooks[`./${config.handbook}`] as HandbookContent;
  const handbook = config.testOnly ? { introduction: pseudolocalize(original.introduction), chapters: original.chapters.map(chapter => ({ ...chapter, title: pseudolocalize(chapter.title), html: pseudolocalize(chapter.html) })) } : original;
  return <PageLayout className="handbook-page" title={<HomeLink navigate={navigate} />} navigation={header}>
    <h2 className="handbook-title">{t("handbookUi.handbook")}</h2>
    <div className="handbook-layout">
      <nav className="handbook-toc" aria-label={t("handbookUi.handbookContents")}>
        {handbook.chapters.map(({ id, title }) => <a key={id} href={`#${id}`} onClick={event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          // Chapter jumps scroll the article without adding unmanaged hash history.
          event.preventDefault(); document.getElementById(id)?.scrollIntoView();
        }}>{title}</a>)}
      </nav>
      <article className="handbook-content" aria-label={t("handbookUi.cuerelayHandbook")}>
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
