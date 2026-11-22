# Reference below video layout experiment

Branch: `codex/reference-below-video`; no persistence or business behavior changes.

1. Compose ReferencePanel through an optional ResizableWorkbench media footer; media stays unaware of reference data.
2. Give the footer the video column's remaining height. Reserve a small expanded/collapsed footer budget in CSS and the existing 16:9 resize calculation; default upper-row height and subtitle minimum stay unchanged. Observe footer geometry so collapse/arrival updates bounds without storing another height state.
3. Keep narrow-screen order video/controls → reference → audio/editor → subtitle list, with bounded internal reference scrolling.
4. Verify actual geometry, focus, scroll, media identity and dragging with real Chromium at 1440×900, 1440×600, 1024×768 and 390×844; run existing resize/compact checks, unit tests and build. Update module/architecture docs and record evidence here.

Tradeoff: when the video column has insufficient spare height, the video frame shrinks at 16:9. Explicit widening can still transfer height from the subtitle list using its existing 144px lower bound, now reserving space for reference too.

## Actual validation (2026-11-22)

- `npm run typecheck`: passed.
- `npm run test -- --run src build`: 67 files / 554 tests passed.
- `npm run build`: passed (existing bundle-size warning remains).
- `npm run test:reference-layout`: passed in real Chrome 147.0.7727.101, generated MP4 and isolated HTTP fixtures. Covers reference arrival/removal without empty slots or upper/list height changes, collapse/expand preserving input focus at all four viewports, long text and multiple matches, automatic positioning after long context, gap notice, playback, same video node, pointer/keyboard divider resizing, collapse after resizing, double-click reset, no page-wide horizontal overflow, and all timing/style/text controls remaining within the desktop editor.
- Layouts: 1440×900 / 1440×600 / 1024×768 / 390×844. Desktop subtitle heights: 344 / 144 / 283.28px; reference text viewports: 110.02 / 76.02 / 110.02px. Narrow reference is bounded at 152px; the existing timing/style row retains local horizontal scrolling. Short-window video frame is 280.88×157.98px, preserving 16:9 and usable playback controls.
- Three real Django/Chromium reference regressions passed without retries: `test_reference_settings`, `test_reference_isolation`, `test_reference_creation`. Disposable PostgreSQL, cold isolated Vite caches and source snapshots: `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-9e5_7itv/`. Test DB destroyed; PostgreSQL stopped (status 3, no postmaster.pid). Final-code rerun: 3/3 passed in 23.336s; earlier 3/3 evidence is also retained at `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-v0jr65tl/`.
- Reviewed relative-import graph: no frontend/backend product module cycles. No new business dependency imports; media remains independent of reference-subtitles. Script syntax and `git diff --check` passed.

### Existing validation limitations

`npm run test -- --run` initially collected three `platform-tests` Playwright suites without their required Django fixture environment; all 554 unit tests passed but that command exited nonzero. Explicit `src build` selection above passed. The Vitest collection config was not changed in this layout task.

Both existing browser scripts fail on the unchanged baseline as well as this branch: `compact-layout.mjs:75` expects an obsolete exact 64px list-height gain; `workbench-resize.mjs:109` waits for the dirty workspace to hide after clicking Home while its leave guard remains active. All preceding resize geometry assertions passed. Baseline used in-memory `git show HEAD` source overrides for the four changed product files on a separate port 5188; that temporary server was stopped. Original failure artifacts: `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-workbench-resize-KfZyPT/`; baseline equivalent: `.../cuerelay-workbench-resize-22Srka/`. The new reference layout test independently exercises actual geometry rather than changing those unrelated checks.

### Evidence and local trial

Screenshots and final fixture report: `/private/tmp/cuerelay-reference-below-video/` (`before-1440x900.png`, `reference-1440x900.png`, `reference-1440x600.png`, `reference-1024x768.png`, `reference-390x844.png`, `reference-dragged.png`, `reference-long-no-match.png`, `without-reference.png`, `report.json`). Screenshots were visually inspected at desktop, short-window and narrow sizes.

Existing development services on http://127.0.0.1:5173 and port 8000 were reused and left running; no new preview service remains. Open a project with a reference SRT, select the matching local video, then try translation, collapse and divider dragging. If starting from stopped services, use the repository's normal local development setup. Repeat the isolated layout fixture with `cd frontend && npm run test:reference-layout` (or set `REFERENCE_LAYOUT_URL` to an already running frontend).

Branch remains `codex/reference-below-video`; no commit, merge, push or deployment. No matching/clock, project-refresh, persistence, media lifecycle, export or preview behavior changed. Architectural follow-ups are limited to the pre-existing test harness issues above and are intentionally outside this experiment.

## Follow-up: slightly wider default video area

User requested a small horizontal increase. Default media share is now 44% (38% at 901–1100px), with a 16px default upper-row height allowance so the existing reference/video height cap permits actual frame growth. This applies equally with and without reference, preserving stable reference arrival/removal. At 1440×900 the frame grows from 458.66px to 487.11px; at 1024×768 from 331.94px to 360.38px. Short 1440×600 and narrow 390×844 layouts retain their previous height constraints. No drag or module contracts changed.

Typecheck and all 6 sizing tests passed. The actual Chrome reference-layout check passed all four viewport sizes, including playback, editor visibility, reference scrolling/collapse/removal and divider dragging. Evidence: `/private/tmp/cuerelay-reference-width/`. An intermediate reference-only height allowance failed the stable-height assertion; the final shared allowance passed without weakening the check.

## Follow-up: compact reference spacing and return height to subtitle list

User requested minimal line/border spacing and the saved height for the subtitle list. Reference remains 13px, with 1.25 line height, zero paragraph margins, 4px side/2px bottom padding, a 22px title control and 4px transport gap. Short panels fit their text so the bottom border has only 3px of spacing; long panels remain capped and internally scrollable. Expanded/collapsed media-footer budgets are now 80px/32px; the default upper row is 32px shorter than the preceding width adjustment. Reducing both expanded footer and row budgets equally preserves the accepted default video width. Narrow reference height is 120px instead of 152px, bringing the editing/list sections 32px earlier.

Typecheck, all 10 matching/sizing tests and the actual Chrome four-viewport reference layout check passed. A rendered before/after assertion verifies the subtitle list gains exactly 32px at 1440×900 with unchanged video width; focus, long text, match positioning, playback, divider controls and overflow checks also pass. Evidence: `/private/tmp/cuerelay-reference-compact/`. Historical results above describe the earlier iterations.

## Follow-up: remove the reference-to-workbench bottom gap

The remaining gap came from the fixed 96px two-line video-control reserve when transport actually used 60px, plus 12px bottom padding. ResizableWorkbench now observes the public `.video-stage` / `.transport` layout nodes and measures their bottom-edge difference. CSS subtracts unused reserve and removed bottom padding from the default row; the same measured chrome feeds video/divider calculations. This preserves the accepted frame dimensions without another requested-height state or iterative gap trimming. Hidden/fullscreen geometry retains the current control budget. Media owns no reference business dependency.

Narrow reference wrappers now fit short content with a 120px maximum rather than occupying a fixed 120px slot. Long text remains internally scrollable. Actual Chrome checks passed at all four target sizes: reference-to-outer-bottom gap is under 3px at 1440×900; another 48px goes to the subtitle list with unchanged video width. Subtitle heights are now 408px (1440×900), 194px (1440×600), 347.28px (1024×768); narrow list remains 320px and starts earlier. Evidence: `/private/tmp/cuerelay-reference-bottom-gap/`. Typecheck and the 10 focused sizing/matching tests passed.

Final verification for this follow-up: all 554 unit/build tests (`src build`), production build, and the real Chrome fullscreen-playback scenario passed (no page errors or unexpected requests). Fullscreen evidence: `/var/folders/cb/g5d9zp7j4hscwq5bclqwmj7w0000gn/T/cuerelay-fullscreen-playback-pJqZmf/`. Relative-import graph check found no product-module cycles; `git diff --check` passed. Existing bundle-size warning remains. No commits, merges or pushes.

## Follow-up: smaller progress-to-playback gap

The screenshot identified the gap between progress slider and playback controls. Transport margin is now 2px instead of 8px. The initial control reserve is correspondingly 90px; expanded/collapsed reference budgets are 86px/38px. Thus the saved 6px increases reference capacity while preserving default video and subtitle-list dimensions. Short reference panels align to the footer bottom, retaining their tight text border and eliminating an external bottom gap; long references use the extra height and scroll internally.

The actual Chrome four-viewport layout check passed, including a rendered before/after comparison: progress-to-transport distance ≤2.5px, reference footer height +6px, video/list dimensions unchanged. All existing focus, playback, long-reference, resize and overflow assertions also passed. Script syntax and git diff checks passed. Evidence: `/private/tmp/cuerelay-reference-transport-gap/`.

## Follow-up: match control-to-reference gap to editor input spacing

The desktop editor timing row has a 4px gap before the subtitle textarea. The reference footer already had a 4px margin, but bottom-aligning a content-sized short panel added visible slack above its border. The panel now fills its existing footer and the bottom alignment rule is removed. The visible control-to-reference gap is consistently 4px while preserving outer bottom alignment, reserved reference capacity, video size and subtitle-list height. This supersedes the earlier short-panel natural-height/bottom-alignment presentation; content padding and line spacing remain compact.

Actual Chrome reference-layout checks passed at all four target sizes. A geometric assertion compares the visible reference gap directly with the right-side timing-to-text input gap; the previously covered 6px reference-space gain, video/list dimensions, internal scrolling, focus, playback and divider behavior also pass. Script syntax and diff checks passed. Evidence: `/private/tmp/cuerelay-reference-editor-gap/`.

## Follow-up (2026-11-23): reference toggle in the media action row

EditorWorkbench now owns collapse state and explicitly composes ReferenceToggle into LocalVideoPlayer.additionalActions, next to Hide subtitles and Import video. The slot is generic; media does not import reference-subtitles. ReferencePanel accepts controlled collapsed/id and retains matching, scroll and media subscriptions. The section and footer are hidden with zero budget when collapsed; clearing reference/access resets collapse. The moved button preserves mouse input focus, declares aria-expanded/aria-controls, and is excluded from timing/search/background-focus capture with its own marker. No changes to media lifecycle, persistence, reference clocks or matching.

Removing the standalone title row gives 22px to the reference text viewport without changing the desktop row/list/frame dimensions. All three actions stay on the same flex row at 1440×900, 1440×600, 1024×768 and 390×844; narrower columns put that action group below playback/time using existing transport wrapping. At 1440×900 the text viewport grows from 58px to 80px and the list remains 408px. At 1440×600 / 1024×768, wrapping uses another 34px of upper-row height; subtitle lists remain 160px / 313.28px, above the 144px lower bound.

Actual checks: typecheck, all 554 unit/build tests, production build, and the four-viewport Chrome layout scenario passed. Targeted real Django/Chromium reference regressions also passed 3/3 in 23.782s, including selection/copy, mouse focus, actual video/audition clocks, draft/history, permissions and save. New geometry checks verify the three action buttons share a row, the former 22px title row is available to text, and keyboard Space toggles reference without starting audition. CSS/script syntax and diff checks passed. Browser evidence: `/private/tmp/cuerelay-reference-inline-toggle/`; true-backend evidence: `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-f7xk092j/` (test DB destroyed, PostgreSQL stopped/status 3/no postmaster.pid). Existing bundle-size warning remains. Branch unchanged, no commit/merge/push/deployment.

## Follow-up (2026-11-23): media controls, import placement, wording and bottom inset

- Playback clock uses 13px text (12px in compact columns) and 11px total duration.
- VideoFilePicker is now centered in video-stage, with the existing local-only hint below it. The existing selection/hash/metadata flow is unchanged. Its button and hidden input disappear only once useVideoSource enters the verified locked state; cancellation, permission denial, restore failure and invalid selection retain the retry entry. The toolbar contains only reference and formal-preview toggles.
- Chinese actions are now 展开参考字幕 / 收起参考字幕 and 显示预览字幕 / 隐藏预览字幕, with corresponding English strings. Existing semantic locale keys remain unchanged; related test selectors were updated.
- The reference footer has 4px top and bottom margins. Its lower border aligns with the right subtitle textarea's lower border, giving both the same 4px inner margin to the outer workbench border. The 86px total footer budget now includes both margins and a 2px border, leaving at least 76px for reference text. Video size and desktop list height are preserved.

Actual verification: typecheck, locale consistency, all 554 unit/build tests and production build passed. Chrome reference-layout checks passed Chinese at 1440×900 / 1440×600 / 1024×768 / 390×844, plus direct English checks at desktop/narrow widths. Geometry assertions verify the import button's exact video-center position, disappearance after verified import, smaller clock, new labels, equal editor/reference bottom insets, internal scrolling, focus, keyboard isolation and divider constraints. Resize checks now wait for bounded stable geometry rather than sampling midway through control-row wrapping; a transient pre-settlement assertion failure was retained in the earlier run output, not treated as a pass. Screenshots/report: `/private/tmp/cuerelay-media-polish/`.

`video-restore.mjs` passed using the existing 5173 frontend (all cancellation, permission, restore, mismatch, native fallback and initial-media handoff cases); `video-progress.mjs` passed seeking, playback, audition isolation and media identity. Logs: `/private/tmp/cuerelay-media-polish-restore.log`, `/private/tmp/cuerelay-media-polish-progress.log`. Three real Django/Chromium reference regressions passed 3/3 in 23.442s: `/private/tmp/cuerelay-aux-media-failures-targeted-chromium-kjs0timc/`; test DB destroyed and temporary PostgreSQL stopped (status 3, no postmaster.pid). Product import graph has no cycles; changed script syntax/diff checks passed. Existing bundle-size warning remains.

Legacy harness limitations: the full i18n browser script initially targeted its unused default port, then stopped against 5173 because its unchanged fixture lacks `GET /api/organizations/1/member-permissions`; this broad suite is not reported as passed. The directly targeted English/Chinese checks above passed independently. The legacy cue-table script stalled at its dirty-workspace navigation guard and was stopped; a temporary copy with bounded waits confirmed central-button pointer/keyboard selection, verified disappearance, resize/pointer capture and playback selection all pass before the same navigation wait. Probe: `/private/tmp/cuerelay-media-polish-table-probe.log`. No unrelated fixture/leave-guard changes were made. No commit, merge, push, deployment or additional preview server.

## Accepted for local main (2026-11-23)

The user accepted the experiment and requested placing the current branch on main. The final layout, controls, locales, regression updates and documentation are being committed together, then fast-forwarded into local main. This supersedes the earlier experiment-only/no-commit restriction; the experiment branch is retained and no remote push or deployment is requested. The final clock-spacing adjustment reduces slash-adjacent word spacing by 3px; the existing video-progress Chrome check passed afterward.
