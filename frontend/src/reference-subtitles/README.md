# Project reference comparison

Read-only presentation of project SRT references; no local-workspace support.

## Public UI and ownership

`ReferencePanel` accepts a stable DOM `id`, controlled `collapsed`, cues, the selected applied subtitle interval, existing video/current time, audition playing state/real position getter, workspace visibility and an optional monotonic `locateRequest`. EditorWorkbench increments this request on every accepted main-table selection, including a repeated click on the same cue; it is a transient intent, outside subtitle/history/persistence state. The panel owns matching preparation, following, scroll and its leaf-only animation subscription. It never seeks media, mutates subtitles or issues requests.

`ReferenceToggle` accepts `collapsed`, `panelId` and `onToggle`. EditorWorkbench owns collapse state and composes it into LocalVideoPlayer's generic `additionalActions` slot beside the formal-preview toggle. It reads “展开参考字幕” / “收起参考字幕” (Expand/Collapse reference subtitles), exposes `aria-expanded` / `aria-controls`, and preserves input focus on mouse activation. The body has no title row. Removing reference/read access resets collapse; replacing cues within the same workspace preserves it. Media has no reference business dependency.

Reference body/toggle use `data-reference-subtitles` / `data-reference-toggle` to isolate timing/search shortcuts and background focus capture. All text is plain React text, without reference-row controls. Native selection/copy works within mounted paragraphs; scrolling mounts the rest. Windowing does not offer a native select-all/copy of the entire unmounted reference document.

## Matching and following

`matching.ts` continues to own stable start/end/source-order sorting, half-open interval/point overlap, all matches and nearest preceding/following context. Zero-length references match an exact playback point or a selected interval containing that point; empty bodies remain matches and display the localized empty marker. Gaps have an explicit no-match paragraph before the nearest upcoming cue (or after the final cue). This paragraph participates in the same height/scroll model. There is no line-number pairing.

`referenceContext` chooses real audio clock > running video > selected applied interval > current video position. Preparation/finish/error return to editing context; uncommitted timing inputs do not change that interval. Every overlapping reference remains a match; only the visible subset and buffer need DOM nodes.

Video play/resume, entering actual audio `playing`, a main-table locate request, expanding/restoring the workspace and a new reference collection resume following and reveal the first match/no-match paragraph. An unchanged matching group can still be explicitly revealed again. While following, a changed match group reveals its first match with up to 24px preceding context. Sampling compares the matching group before committing React state; unchanged frames do not rerender the list.

Wheel/touch/scrollbar/scroll keys and pointer text selection pause following immediately. Other native/scripted scroll changes also take over the reading anchor. Following stays paused across subsequent frames, matching transitions and pause/finish; the next explicit locate resumes it. Equal-version observations retain the same cue array upstream and never create a locate request. Programmatic writes synchronously record the actual clamped scrollTop; there is no timer-based ignore window that could consume a later user scroll.

## Window geometry and lifecycle

`ReferencePanel → use-reference-window → window` stays inside this module; there is no dependency on workspace-ui's table internals. `ReferenceLine` has a stable measurement ref and memoized content. `window.ts` supplies height estimates, cumulative offsets, binary viewport lookup and six rows of buffer on each side; pending targets/reading anchors are retained until measured. Unmounted proportional text is estimated by explicit/soft line lengths; mounted paragraphs always use actual DOM height, including bold matching text and wrapping.

`use-reference-window` alone owns ResizeObserver, measured/estimated height caches, viewport, pending reveal and a reading key/in-row pixel offset. Data remains the complete immutable collection; scrolling never loads more data. Caches are scoped to the mounted list, bounded by its rows, invalidated on effective width/text changes, and reused when only the transient gap paragraph moves. Cue indices/base geometry stay cached when the transient gap moves; measured heights correct numeric offset suffixes rather than rescanning all text. The spacer and real measurements settle before a distant reveal completes. Width/height changes preserve the reading row and clamp its inset if the row becomes shorter. `overflow-anchor: none` prevents competing browser scroll correction. Synchronous restoration is distinguished from user input and browser clamping during a geometry update.

Collapsing unmounts the list, discards its DOM caches and stops sampling. A hidden retained workspace disconnects measurement/listeners and cancels its sampling frame; document-hidden tabs stop their media sampling loop until visibility resumes. Unmount cleans observers/listeners/frames. Reference replacement reuses measurements only for identical text and explicitly locates against the new collection.

## Layout constraints

EditorWorkbench places the panel in ResizableWorkbench's media footer below video/controls. It fills the footer with the existing 4px gaps and bottom inset matching the editor textarea. Text uses 13px / 1.25 line height, zero paragraph margins and 4px side / 2px bottom padding. Expanded CSS reserves 86px including gaps/borders (at least 76px reference text); collapsed reserves zero. No reference leaves no body/toggle/footer. The existing divider transfers height from the subtitle list while retaining its 144px minimum and the 16:9 video. Narrow screens preserve video/controls → reference (maximum 120px) → audio/editor → subtitle list. This change adds no controls or resize mechanisms.

## Dependencies and verification

`workspace-ui → reference-subtitles → {contracts, i18n, React, browser read APIs}`. Matching depends only on contracts; geometry has no React/DOM/media dependency. Backend parsing/ownership stays in `srt_format` and `projects/reference_services.py`; transport stays in `project-data`; request identity/order and permission fences stay in `app-workspace`. Observations never replace the editable document/revision.

Pure checks: `matching.test.ts`, `window.test.ts`. Browser commands: `npm run test:reference-scroll`, `npm run test:reference-layout`, `npm run test:reference-performance`. The new suites use actual Chromium/media/Web Audio and real reference-parser-validated fixtures with isolated HTTP responses; they do not write a database. Existing real Django integration remains `test_reference_*` / `regression/reference-subtitles.spec.mjs`. Reproduction, measured costs and limitations: [reference scrolling evidence](../../../docs/experiments/reference-scroll.md). Historical layout decisions: [reference below video](../../../docs/plans/reference-below-video.md).
