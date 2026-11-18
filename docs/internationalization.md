# Internationalization and layout acceptance

Implemented for Simplified Chinese and English on 2026-11-15. Runtime: i18next 27.1.2 + react-i18next 18.0.1, local module resources, no translation service or locale routes. The interrupted predecessor had installed these packages and an unused skeleton; this implementation completed the integration and corrected its missing license records/type-only dependency classification. Implementation history and actual evidence are in [the execution record](plans/internationalization.md).

## Ownership and contracts

`shared/languages.json` is the product language registry: IDs, native names, browser aliases, handbook entry and a single fallback. `frontend/src/i18n/registry.ts` discovers per-module JSON resources and derives menu entries/types. Explicit language wins; System uses ordered browser matches, then `zh-CN`. `zh-*` matches the supported Simplified Chinese experience, not an additional Traditional Chinese locale. Browser `languagechange` updates System. HTML `lang`, document title and human-facing date display update immediately; ASS timing, physical shortcut codes and numeric QC rules do not.

The language selector appears only in Settings → Personal settings. Signed-in users persist `language_preference` (`system` by default) through the existing account settings partial PATCH and migration `accounts.0007`. Reads do not create settings rows. The sign-in page uses any existing anonymous localStorage preference, otherwise System. The anonymous value is never promoted into an account. Account IDs and monotonically increasing request sequences fence pending replies and optimistic selections; unsupported and test-only preferences are rejected atomically by the server. A failed preference write keeps the immediate UI selection and exposes an inline retry.

Presentation uses typed `t` while rendering. Retained notifications/errors use `msg`, `useMessageState` and `formatMessage`, so switching language updates existing feedback without repeating a password change, save, inspection or other operation. Older/unknown error reasons keep their exact message instead of being guessed from a broad code or Chinese text. The network `MessageDescriptor` permits an unknown key plus fallback at the boundary; authored `t`, `msg` and pure `describe` keys are checked against generated `contracts/message-keys.ts`.

Pure frontend validators, QC and media/preview controllers output `contracts/messages` descriptors or `MessageError`, not resolved text. Workers send structured-clone-safe descriptors. Backend `message_contracts` is a standard-library leaf: string-compatible messages carry a stable reason/params, and HTTP boundaries add that metadata while retaining existing `code`, `message`, source lines and statuses. Validation aggregates include every specific error in `error.details`; standard Django password reasons retain their parameters. This distinguishes, for example, an incorrect old password from an unsupported setting even though both use `invalid_request`. Unknown legacy detail is never discarded.

Frontend dependency direction is presentation → i18n → contracts/shared/external runtime. Data and pure rules do not import the translation instance. Backend direction is business/HTTP → message_contracts → standard library. Diagnostic JSON labels/schema remain stable; only the export control and its feedback are translated. The export component now belongs to `page-ui`, keeping diagnostics independent of presentation. See module READMEs for local contracts.

## Coverage and protected state

Resources cover workspace controls/menus/search/QC/accessibility, account/organization settings, projects, styles/templates, glossary, media/preview/audio feedback, navigation states, dialogs, errors and success messages. Shortcut identities still come from `shared/timing-shortcuts.json`; only their display names are translated. [The terminology table](i18n-terminology.md) records versioned Aegisub sources and deliberate behavior differences.

The Chinese `handbook.md` and English `handbook.en.md` use the original build-time Marked pipeline. Chapters have identical stable IDs. Configurable shortcut rows carry invisible `<!-- shortcut:action-id -->` markers; checks compare physical bindings and each locale's readable key labels, not translations of action names. Production ships precompiled HTML, not a Markdown parser. Open-source navigation pages are built for each registered locale from `openSource.json`; license/source bytes and machine manifests remain unchanged.

Subtitles, project names/descriptions, term content, imported style names, edited style-name drafts and ASS identifiers are not translated. The controlled organization-default glossary heading is a presentation label; its stored name is not rewritten. The fixed bilingual style-rendering sample is deliberate test content. Legacy Chinese fallback messages inside `describe`/`localized`, comments, fixtures, diagnostic JSON and shared shortcut labels are not evidence of untranslated UI.

Locale never enters workspace React keys, document/history ownership, video/File/handle identity, Object URL or media/Worker/renderer effects. Stable translator identities let view subscriptions update without restarting resources. QC retains its existing snapshot/IDs and re-formats it; it is recomputed only on its existing explicit triggers. Subtitle edits still invalidate reports normally. Virtualized rows continue to measure user text and preserve logical row/inset anchors when header geometry changes; they do not discard all row measurements simply because the locale changes.

## Layout rules and acceptance

Ordinary controls wrap at word boundaries and use content sizing. Member forms no longer reserve 104px/40px for an action regardless of text. Dialog and QC headings wrap, style lists/fields adapt, and action columns retain room for a whole control. Compact workspace headers and timing fields intentionally own horizontal scrolling when space is exhausted; controls remain keyboard/mouse reachable. Tables/list scrollports keep their existing ownership. No language-specific CSS, global font reduction or blanket clipping was introduced. Context menus remeasure translated content and allow internal scrolling without being dismissed.

`browser-tests/layout-checks.mjs` is reusable: it checks the document boundary, caller-selected surface bounds, and critical controls after scrolling them into view. It checks hit reachability and clipped button content. It does not flag every overflowing descendant: table data, inputs, virtual spacers and explicitly owned toolbar/list scrollports are legal. Add the controls relevant to a feature rather than weakening a global overflow heuristic.

`en-XA` is available only in dev/test, generated from English with visible brackets and expanded prose (typically about 1.5–2×). Keys/plural suffixes, interpolation, code spans, ASS tokens, numeric time values and technical identifiers survive. It is transient for accounts and absent from production menus. It tests layout, not translation quality or RTL.

The browser matrix covers registry languages plus pseudo, project list/create/archive, personal and organization settings, project settings, style/template dialogs, handbook, QC, glossary, line menus and Paste Lines Over. It includes 1440px and 800px pages and a 1120×680 constrained workspace/QC panel. Identity/HTTP fixtures are isolated; ASS transformations, hashing, audio Workers, JASSUB and video are real. The OS picker/permission decision is simulated using a real serializable OPFS handle; Paste Over layout uses synthetic browser-local clipboard text. No development database or actual user files are used.

Screenshots use the bundled Noto Sans SC, fixed fixture timestamps/media, disabled animations/transitions and hidden caret. They are reproducible review evidence, **not automatically approved pixel baselines**. The JSON report starts with `screenshotsReviewed: false`. Inspect new/changed regions before accepting a baseline; only deliberately reviewed baselines should later be used with Playwright screenshot comparisons. Chromium geometry checks do not establish Firefox/Safari or real OS picker support.

## Local commands

From the repository root:

```sh
npm run i18n:types --prefix frontend       # regenerate key/resource types after adding keys
npm run i18n:check --prefix frontend       # semantic coverage, placeholders, plurals, backend reasons
npm run typecheck --prefix frontend
npm test --prefix frontend -- --run
npm run test:ass-compatibility --prefix frontend
npm run build --prefix frontend
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

`npm test` and `npm run build` include the catalog check. The checker compares semantic plural families, using `Intl.PluralRules(locale)`: English needs one/other, Chinese only other; future languages may need additional categories. Singular forms may omit `count`; other interpolation names must match. No raw JSON key-equality rule is imposed.

Start Vite, then run the standalone acceptance command in another terminal:

```sh
npm run dev --prefix frontend -- --port 5238 --strictPort
I18N_URL=http://127.0.0.1:5238 npm run test:i18n --prefix frontend
```

The command prints a new temporary artifact directory with PNGs and `results.json`. Check changed screenshots there. Existing browser suites explicitly select Chinese; the real backend runner also includes an English save/reload/preference scenario. Use the disposable PostgreSQL setup from [testing.md](testing.md), then:

```sh
.venv/bin/python backend/manage.py test accounts ass_format http_api organizations projects glossary diagnostics --settings=application.test_settings --noinput
.venv/bin/python backend/manage.py test browser_tests.regression --settings=application.test_settings --noinput
```

For production-only checks, build first, start the preview, then run these in another terminal:

```sh
npm run preview --prefix frontend -- --port 5239 --strictPort
I18N_PRODUCTION_URL=http://127.0.0.1:5239 npm run test:i18n-production --prefix frontend
HANDBOOK_URL=http://127.0.0.1:5239 HANDBOOK_PRODUCTION=1 npm run test:handbook --prefix frontend
```

The production smoke checks precompiled English chapters, stable IDs, absence of the pseudo option, no Markdown fetches, and both static license pages. The existing handbook suite checks Chinese content and account-scoped prompting. These use isolated HTTP fixtures and do not need a backend database. Browser/OS-owned chooser dialogs retain the browser/OS language; the application file-selection controls use the selected UI language.

Use the normal configured deployment/development database migration command before serving this code: `.venv/bin/python backend/manage.py migrate`. Verification uses isolated test databases and does not migrate a developer's existing data. CI remains local-only as previously decided; no service/workflow was added.

## Maintaining a feature or adding a language

For a normal feature change, add stable semantic keys to the relevant Chinese/English module files and use interpolation/complete sentences. Keep user content and protocol names separate. Add descriptors/reason parameters at the original error site when detail matters; do not introduce text matching. Regenerate types, run catalog/type/unit checks and the relevant existing interaction suite. Review the changed region in English and pseudo; reuse the layout helper for new critical controls/dialogs. Existing untouched pages are checked automatically and do not need another manual tour.

For a language release:

1. Add one entry to `shared/languages.json` with native name, browser aliases, handbook filename and `fallback: false`.
2. Add `frontend/src/i18n/locales/<id>/` resources with the same semantic message families, correct locale plural categories and preserved interpolation/technical tokens. Translate `handbookUi` key labels and `openSource` navigation too.
3. Add its Markdown handbook, retaining chapter IDs, shortcut action comments and physical bindings. Existing languages/resources serve as templates; there is no business-code language switch to edit.
4. Run `i18n:types`, `i18n:check`, type/unit/build, the browser language matrix (derived from the registry), and representative real interactions. Review the new language's screenshots and terminology before release. RTL needs a separate design/acceptance task.
