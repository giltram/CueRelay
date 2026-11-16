# Chinese / English internationalization

Status: implementation and local acceptance complete (2026-11-15), with the verification limits below. No commit or push performed. The developer's existing database was not migrated.

## Plan
1. Add a typed i18next presentation boundary, centralized locale registry, language preference persistence and account isolation.
2. Migrate product UI by module; retain stable domain codes/parameters and translate at presentation time. Preserve editor/media ownership and effects.
3. Compile both handbook languages, verify upstream Aegisub terminology and update licenses/documentation.
4. Add semantic catalog validation, development pseudolocalization and reproducible browser layout/state checks; run unit/type/build/backend/browser checks and inspect screenshots.

## Invariants
- No language-dependent React keys or workspace remounts; language is absent from media/worker/rendering dependencies.
- Explicit preference > browser language (System) > Simplified Chinese fallback. Account preferences are never copied between identities; anonymous preference has separate storage.
- Translation concerns belong to presentation; machine protocols, user content, ASS/timecode formats and shortcut behavior remain stable.
- Browser layout checks allow explicitly owned table/list scrolling; first screenshots require visual inspection.

## Completion

- Integrated i18next/react-i18next with typed semantic keys and module resources. The single language registry drives negotiation, menus, resource discovery, backend validation and acceptance languages. Chinese remains the final fallback.
- Added anonymous and account-scoped immediate language selection, persisted through existing partial personal-settings updates; fenced old account responses. Title, HTML lang, retained feedback and QC update without rerunning operations.
- Migrated authored product UI, accessibility labels, media feedback, shortcuts and errors. Domain/Worker/backend messages carry stable descriptors/reasons/parameters; unknown legacy detail is preserved. User content, machine diagnostics, ASS formats, thresholds and physical shortcuts are unchanged.
- Added the English handbook through the existing build pipeline, matching stable chapter/action IDs; verified short English terms against versioned Aegisub 3.0/3.2 documentation. Added dependency notices and bilingual generated open-source navigation.
- Adapted shared controls, forms, headings, menus and compact toolbars. Added semantic plural/placeholder validation, dev/test pseudo resources, reusable scoped layout checks and deterministic screenshots. Existing browser suites explicitly select Chinese; representative real interactions also run in English.
- Updated architecture, affected module READMEs, testing and maintenance instructions. See [internationalization.md](../internationalization.md) and [i18n-terminology.md](../i18n-terminology.md).

## Decisions and interruption audit

- The interrupted predecessor had installed packages and an unused skeleton. Retained those intended dependencies, completed integration and corrected missing license records and runtime/build-only dependency classification. No predecessor business changes were discarded.
- Translation state belongs to presentation; pure contracts remain leaves. Moved the diagnostics export control to page-ui so the diagnostics module does not depend on i18n. Unit dependency checks enforce direction and cycles.
- Retain message descriptors rather than translated strings in notification/error/QC state. Backend string subclasses preserve existing Chinese callers while adding wire metadata; no matching of Chinese error strings.
- Keep workspace/history/media ownership and effect inputs independent of locale. Do not invalidate every virtual-row measurement for translated headers; preserve the logical row/inset anchor.
- Own scrolling explicitly in dense headers, timing fields, tables and bounded menus. Internal menu scrolling must not trigger outside-scroll dismissal. No language CSS branches or site-wide font reduction.
- Final screenshot review found browser-language native ASS input labels; reused the existing file-picker control, then reran the matrix and style/project-form suites. The OS dialog itself remains browser/OS-owned.
- Resuming after quota interruption checked existing logs and source rather than assuming prior passes. Repaired stale Chinese handbook content/heading expectations and the project-form test's pre-existing assumption that a hidden native video input was visible. Both suites were actually rerun successfully.

## Executed verification

Commands run from the repository root; standalone suites target owned local Vite servers and isolated HTTP fixtures unless stated otherwise. Raw logs are temporary local artifacts, not repository fixtures.

| Check | Actual result | Local evidence |
| --- | --- | --- |
| `npm run i18n:check --prefix frontend` | 861 typed entries; semantic coverage, placeholders, plurals and backend reason references pass | build/unit prechecks |
| `npm run typecheck --prefix frontend` | Pass, also included in successful builds | `/tmp/cuerelay-build.txt` |
| `npm test --prefix frontend -- --run` | 56 files, 481 tests pass, including dependency boundaries | `/tmp/cuerelay-tests-final.txt` |
| Django `accounts ass_format http_api organizations projects glossary diagnostics`, `application.test_settings` | 209 tests, one Nginx-dependent skip, no failures; includes language preference migration preservation | `/tmp/cuerelay-backend-tests.txt` |
| Django system check and `makemigrations --check --dry-run` | Pass; no missing migrations | local command output |
| Django `browser_tests.regression`, `application.test_settings` | Seven real PostgreSQL/Django/browser scenarios pass, including English save/reload/preferences | `/tmp/cuerelay-real-browser.txt` |
| `npm run test:ass-compatibility --prefix frontend` | Real JASSUB/WASM compatibility and round trips pass | `/tmp/cuerelay-ass-test.txt` |
| `npm run test:i18n --prefix frontend` | 78 checks, 76 PNGs; Chinese/English/pseudo, layouts, state and account isolation pass | `/tmp/cuerelay-browser-i18n.txt`; artifact directory below |
| Existing `test:subtitle-qc`, `test:style-management`, `test:workspace-history`, `test:cue-window`, `test:video-restore` | Pass; real rendering/media/history/virtual-list coverage | `/tmp/cuerelay-{qc-browser,style-browser,history-browser,window-browser,video-restore}.txt` |
| Existing `test:project-form` with seeded disposable real backend | Pass, including native cancel, invalid ASS, failed/retried create, File reuse and browser history | `/tmp/cuerelay-project-form.txt` |
| Production `test:handbook`, `HANDBOOK_PRODUCTION=1` | Chinese content/prompting, account isolation, responsive layout, no Markdown requests pass | `/tmp/cuerelay-handbook-production.txt` |
| `test:i18n-production` | Precompiled English chapters, stable IDs, no pseudo option, no Markdown requests, bilingual license pages/source links pass | `/tmp/cuerelay-i18n-production-final.txt` |
| `npm run build --prefix frontend` | Pass, including generated license/source artifacts; existing large-chunk advisory remains | `/tmp/cuerelay-build.txt` |
| Python license/source tooling unittest discovery | Five tests pass | `/tmp/cuerelay-license-tests.txt` |
| `git diff --check` | Pass | local command output |

The latest multilingual screenshots/report are at `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-i18n-pMNzo9`. Reviewed the earlier full contact sheet and targeted full-resolution English/pseudo settings, organization/style forms, constrained workspace/QC, line menus and Paste Over. Inspected the corrected final `en-XA-800-organization.png` and the real `form-390.png` in `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-project-form-o2Fh04`. Controls remain readable and reachable; data tables/compact headers use their owned scrollports.

## Limits and next release action

- Screenshots were inspected as evidence; **no pixel baseline was automatically approved**. The report deliberately retains `screenshotsReviewed: false`; this is not a claim that every PNG has individual pixel approval. Future features review their changed regions and reuse the matrix.
- Browser acceptance ran in Chromium/Chrome. Firefox/Safari, actual OS permission/chooser dialogs, production Nginx integration and every unrelated standalone browser/performance suite were not run. One backend Nginx integration test skipped. Real serializable file handles, video/audio Workers and JASSUB were exercised; permission decisions are controlled test inputs.
- Build succeeds with the existing advisory for a chunk over 500 kB. No unrelated bundling refactor or CI service was introduced. RTL remains a separate future task, as requested.
- Before serving the updated backend against an existing environment, run `.venv/bin/python backend/manage.py migrate` with that environment's normal configuration. Migration was exercised on disposable databases only; existing development data was not touched.
- To add a language: extend the shared registry, add module resources and a handbook with stable IDs/action markers, regenerate types, then run semantic/type/unit/build and registry-driven language acceptance. See the maintenance guide for exact commands and review steps.
