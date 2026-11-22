# Project reference comparison

Read-only presentation of project SRT references; no local-workspace support.

## Public UI and ownership

`ReferencePanel` accepts a stable DOM `id`, controlled `collapsed`, cues, the selected applied subtitle interval, existing video/current time, audition playing state/real position getter and workspace visibility. It owns matching preparation, scroll and a leaf-only animation subscription. It never seeks media, mutates subtitles or issues requests. Collapsing hides its section, removes its scroll content and stops animation sampling.

`ReferenceToggle` accepts `collapsed`, `panelId` and `onToggle`. EditorWorkbench owns collapse state and composes this button into LocalVideoPlayer's generic `additionalActions` slot beside the formal-preview toggle. It reads “展开参考字幕” / “收起参考字幕” (Expand/Collapse reference subtitles); video import lives in the video-stage center until verification succeeds. The button uses `aria-expanded` / `aria-controls`; mouse activation preserves the current input focus. The reference body has no title row: its former 22px belongs to the text viewport. Removing reference/read access resets collapse; replacing reference cues within the same workspace preserves it.

Reference body and toggle use `data-reference-subtitles` / `data-reference-toggle` to isolate timing/search shortcuts and background focus capture. Native text selection/copy remains available. Media has no reference business dependency.

## Matching and scroll

`matching.ts` owns stable start/end/source-order sorting, half-open interval/point overlap, all matches and one preceding/following context. Zero-length references match an exact playback point or a selected interval containing that point; empty bodies remain matches. Gaps return zero matches and nearest ended/upcoming context. `referenceContext` chooses real audio clock > running video > selected applied interval > current video position. Preparation/finish/error return to editing context; uncommitted timing inputs do not change the selected interval. No line-number pairing.

Rendering uses plain React text nodes. On context or saved-reference changes, the panel reveals the first current match (or no-match notice), with up to 24px preceding context; it does not continuously reset user scroll within the same group.

## Layout constraints

EditorWorkbench places the panel in ResizableWorkbench's optional media footer below video/controls. It fills the footer, with a 4px gap matching the desktop timing-to-text input gap, and a 4px bottom margin matching the editor textarea’s bottom margin. Text uses 1.25 line height, zero paragraph margins, 4px side / 2px bottom padding. Long blocks/multiple matches scroll inside the column. CSS reserves 86px expanded, including 4px top/bottom gaps and a 2px border: at least 76px is available to reference text. Collapsed panels reserve zero space; their toolbar action remains available. No reference leaves neither body nor toggle.

The progress-to-transport gap is 2px. ResizableWorkbench measures actual progress/transport geometry, returns unused initial control reserve and removes bottom padding from the upper row. Its existing divider can transfer height from the subtitle list while preserving the 144px minimum. A tight budget shrinks the 16:9 frame. Narrow screens retain video/controls → content-sized reference (maximum 120px) → audio/editor → subtitle list. The two reference/preview actions share one row; on narrower columns this group can wrap below playback/time using the existing transport behavior.

## Dependencies and verification

`workspace-ui → reference-subtitles → {contracts, i18n, React, browser read APIs}`. Matching depends only on contracts. Backend parsing/ownership: `srt_format` and `projects/reference_services.py`; transport: `project-data`; request identity/order: `app-workspace`. Project observations adopt only reference/status/permissions, never document/revision. Equal reference versions retain the same cue array through status polls, preserving manual scroll/native selection. Visibility requires current project read access (`mediaOwnerId`); identity/project replacement and read-denial fences belong upstream.

Tests: `matching.test.ts`, `project-data/subtitle-api.test.ts`, `frontend/browser-tests/reference-layout.mjs` (`npm run test:reference-layout`) and the three `test_reference_*` Django entries for `frontend/regression/reference-subtitles.spec.mjs`. Original integration/deployment: `docs/plans/project-reference-subtitles.md`; current layout decisions and actual evidence: `docs/plans/reference-below-video.md`.
