A subtitle has text, a start time, an end time and a style. Timing aligns that interval with speech. If you already use Aegisub, jump to the Aegisub quick reference.

For your first subtitle, follow the steps below. CueRelay uses familiar audio timing interactions while keeping video on your device.

## Make your first subtitle {#first-cue}

1. **Prepare the video.** Open a project by clicking its name in Projects, then select its reference video. Video is never uploaded. A compatible browser can try to reopen the remembered local file after a refresh; permission or another manual selection may be required. If verification fails, ask the project organizer for the same source. For practice, open Local workspace and select a video to begin with empty subtitles.
2. **Find a line of speech.** Use the video play button and position slider to get close, then inspect the spectrum on the right. Time runs left to right; brighter areas usually indicate stronger sound.
3. **Set start and end.** Left-click the spectrum at the start of speech and right-click at the end. Press `S` or `Space` to play the selection. Check for missing speech or the next line spilling into the selection. Press `G` or `Enter` to apply the times and move to the next line, or enter text first. Unapplied time inputs are replaced when you select another line.
4. **Enter text.** Press `Tab` to focus the subtitle text input. Enter the dialogue, then press `Tab` to return to timing. Press `G` or `Enter` to commit and move to the next line. Committing the last line creates a new empty line.
5. **Review and save.** Click the line in the subtitle grid to pause and seek to its applied start. Play the video to review picture and subtitles. In a project, click Save project to store applied subtitles on the server. In a local workspace, use Export ASS to download the document.

## Timing in detail {#timing}

**Adjust boundaries:** Drag start with the left mouse button and end with the right mouse button. With a boundary focused, arrow keys adjust by 10ms; hold Shift for 100ms. You can also edit Start and End directly. Start must not be after end; press `G` / `Enter` to apply your inputs. A zero-duration line is allowed and is reported by QC as short.

Mouse timing and boundary dragging snap to another subtitle boundary, the opposite boundary or the playhead within 8px. Hold Shift to bypass snapping while keeping 10ms precision. The time represented by 8px depends on zoom; keyframes are not included.

**Adjust the audio view:** Scroll to pan, or Shift+scroll to zoom around the pointer. You can also drag the canvas or the horizontal scrollbar. The vertical slider adjusts spectrum intensity or waveform amplitude; double-click it to reset.

**Audio playback and video playback:** `S` / `Space` plays selection audio. `Q` / `W` checks just outside the boundaries; `E` / `D` checks the beginning or end of the selection. Video and subtitle preview stay still during audio playback. Use the video play button to review the picture. In fullscreen, Space plays or pauses the video.

**While entering text:** Letters and `Enter` enter text instead of running ordinary timing shortcuts. A line break is stored as ASS `\N`. `Tab` toggles timing and text input focus; the alternate Ctrl+Space binding is available in personal settings. Shift+Tab keeps the normal tab order.

**Commit before selecting another line:** Selecting a grid row loads its applied times and replaces unapplied time inputs. Jump to selected line also uses the applied start. A valid time draft can appear in the preview without being committed or saved.

**Shift subtitle times.** Click Shift times above the subtitle grid. Selected lines is the default scope. To shift the whole document, choose All subtitles. Enter an offset in milliseconds. For example, `+500` delays the lines by half a second and `-500` moves them half a second earlier. Use a multiple of 10 milliseconds. The start and end times move together and each line keeps its duration. If any target time falls outside 0:00:00.00 to 9:59:59.99, the shift is rejected. Apply any time draft or restore the original start and end times first. You can undo or redo the entire shift in one step. In a project, click Save project to persist the change.

Use Personal settings → Audio display to choose Spectrum or Waveform. Save and return to the workspace to apply it. Clicking the waveform or ruler seeks the video; spectrum clicks set boundaries. If Set subtitle boundaries with mouse clicks is disabled, left-clicking the spectrum also seeks; dragging boundaries still adjusts timing.

## Aegisub quick reference {#aegisub}

Open a project by its name and select its fixed reference video. The video remains local; reopening a remembered file depends on browser support and permission. If verification fails, obtain the matching source from the organizer.

**Timing:** Left-click to set start, right-click to set end, and `G` / `Enter` to commit and move to the next line. The table below lists supported shortcuts. Commit on the last line creates a new empty line.

**Styles Manager:** For organization projects, open Project settings → Project styles → Manage project styles. The workspace Style selector assigns a style to every selected line. Cmd-click on macOS or Ctrl-click on Windows/Linux changes individual selections; Shift-click selects a range. A local workspace provides Manage styles.

CueRelay does not reproduce all Aegisub menus, automation scripts or typesetting tools. Project styles and organization templates are independent snapshots; changing a template does not update existing project styles.

## Shortcuts {#shortcuts}

The table lists default bindings. `Ctrl` is for Windows/Linux, `Cmd` for macOS; `/` means alternatives. Commit, audio playback, focus, line commands, Undo/Redo and the four unbound editing actions can be changed in Personal settings → Shortcuts. Other controls depend on focus and context as described below.

| Action | Default binding |
| --- | --- |
| Commit and move to next line <!-- shortcut:commit --> | `G` / `Enter` / `Numpad Enter` |
| Play audio selection <!-- shortcut:selection --> | `S` / `Space` |
| Play 500 ms before selection <!-- shortcut:before-start --> | `Q` |
| Play 500 ms after selection <!-- shortcut:after-end --> | `W` |
| Play first 500 ms of selection <!-- shortcut:first-500 --> | `E` |
| Play last 500 ms of selection <!-- shortcut:last-500 --> | `D` |
| Toggle timing and subtitle input focus <!-- shortcut:toggle-text-focus --> | `Tab` |
| Delete Lines <!-- shortcut:delete-row --> | `Ctrl+Delete` / `Cmd+Delete` / `Ctrl+Backspace` / `Cmd+Backspace` |
| Undo <!-- shortcut:undo --> | `Ctrl+Z` / `Cmd+Z` |
| Redo <!-- shortcut:redo --> | `Ctrl+Shift+Z` / `Cmd+Shift+Z` |
| Set start to video position: use the current video position as start <!-- shortcut:set-start-playhead --> | Unbound by default |
| Set end to video position: use the current video position as end <!-- shortcut:set-end-playhead --> | Unbound by default |
| Split empty line at video position <!-- shortcut:split-playhead --> | Unbound by default |
| Split at cursor (estimate times): divide time in proportion to text length; requires text on both sides and no ASS tags or escapes <!-- shortcut:split-text --> | Unbound by default |
| Insert (before) <!-- shortcut:insert-before --> | `Ctrl+Alt+I` / `Cmd+Alt+I` |
| Insert (after) <!-- shortcut:insert-after --> | `Ctrl+Alt+Shift+I` / `Cmd+Alt+Shift+I` |
| Insert at video time (before) <!-- shortcut:insert-video-before --> | `Ctrl+Alt+V` / `Cmd+Alt+V` |
| Insert at video time (after) <!-- shortcut:insert-video-after --> | `Ctrl+Alt+Shift+V` / `Cmd+Alt+Shift+V` |
| Duplicate Lines <!-- shortcut:duplicate-lines --> | `Ctrl+Shift+U` / `Cmd+Shift+U` |
| Split lines before current frame <!-- shortcut:split-frame-before --> | `Ctrl+D` / `Cmd+D` |
| Split lines after current frame <!-- shortcut:split-frame-after --> | `Ctrl+Shift+D` / `Cmd+Shift+D` |
| Cut Lines <!-- shortcut:cut-lines --> | `Ctrl+X` / `Cmd+X` |
| Copy Lines <!-- shortcut:copy-lines --> | `Ctrl+C` / `Cmd+C` |
| Paste Lines <!-- shortcut:paste-lines --> | `Ctrl+V` / `Cmd+V` |
| Paste Lines Over <!-- shortcut:paste-lines-over --> | `Ctrl+Shift+V` / `Cmd+Shift+V` |
| Open Find or focus and select its query | `Ctrl+F` / `Cmd+F` |
| Find next match (Find input focused) | `Enter` |
| Find previous match (Find input focused) | `Shift+Enter` |
| Close Find and return to timing | `Esc` |
| Insert a line break stored as ASS `\\N` (subtitle text focused) | `Enter` |
| Play / pause video in fullscreen | `Space` |
| Exit fullscreen | `Esc` |
| Adjust a focused boundary by 10ms | `←` / `→` |
| Adjust a focused boundary by 100ms | `Shift+←` / `Shift+→` |
| Pan audio by 20% of the view (canvas focused) | `←` / `→` |
| Pan audio by 10% of the view (horizontal scrollbar focused) | `←` / `→` |
| Pan audio by one view (horizontal scrollbar focused) | `PageUp` / `PageDown` |
| Move audio view to start / end (horizontal scrollbar focused) | `Home` / `End` |
| Pan audio under the pointer | `Wheel` |
| Zoom audio around the pointer | `Shift+Wheel` |
| Resize video by 16px, or 48px with Shift (divider focused) | `←` / `→`;`Shift+←` / `Shift+→` |
| Set minimum / maximum video width (divider focused) | `Home` / `End` |
| Resize a column by 8px, or 24px with Shift (column divider focused) | `←` / `→`;`Shift+←` / `Shift+→` |
| Set minimum / maximum column width (column divider focused) | `Home` / `End` |

**Find and replace.** Select Find or press Ctrl/Cmd+F. The count shows both matches and matching lines. Previous and Next visit each match, including multiple matches on the same line. When editing is available, open Replace and choose Replace current match to change the highlighted occurrence. Replace all works left to right on non-overlapping matches across the document. Leave the replacement text empty to delete matches. Each action is one undo step and keeps unapplied time inputs. Use Save project to submit project edits.

Find treats `\N`, `\n` and `\h` as spaces. When a match crosses formatting tags, the replacement uses the formatting at the start of the match and keeps the existing tags. Press Enter in the replacement field to insert a line break stored as `\N`. Braces and backslashes are rejected. If ASS validation fails, CueRelay shows the reason and keeps the original draft.

**Line menu:** Right-click a subtitle row to open commands. Ctrl/Cmd-click selects multiple lines; Shift-click selects a range in visible time order. Right-clicking a selected row keeps the selection and does not seek video. Delete, Cut, Copy, Duplicate and frame splits act on selected lines. Use `Shift+F10` on a row button to open the menu from the keyboard, arrows to move and Esc to close. The grid stays sorted by time; insertion position is retained in document and exported ASS order.

Ordinary insertion creates empty text with the current style and a default duration of 3 seconds, shortened to nearby boundaries. Touching boundaries can produce a zero-duration line; QC reports it as short. Video-time insertion starts at the current frame. Split lines before current frame starts the second half at the current frame; split after starts it at the next frame. Both halves keep the full text. If the frame lies outside the interval, a copy covering that frame is added. Times remain non-negative and aligned to 10ms; frame splits require positive duration.

The clipboard uses ASS Dialogue text and can interoperate with Aegisub within CueRelay's ASS subset. Each non-empty plain-text line becomes a 0–3 second subtitle using the current style; unknown clipboard styles also use the current style. Paste inserts before the active line. Paste Lines Over defaults to text, with Start, End and Style available as fields. Multiple selections are matched in document order; a single selection overwrites from the active line down. Extra clipboard lines are ignored. Inputs keep native text Cut/Copy/Paste. Edits can be undone; Copy does not add a history step.

## Styles and ASS import {#styles}

The Style selector applies the chosen style to all selected lines. Mixed styles are shown when the selected lines differ. Batch assignment is one Undo/Redo step and preserves unapplied time inputs. Project changes still require Save project.

**Supported subset:** Import accepts UTF-8 ASS with an optional BOM, up to 1MiB and 5000 events. Standard styles, Unicode text, commas, line breaks, whitespace escapes and bold/italic/underline/strikeout tags are supported. Export preserves supported content and format semantics, without promising byte-for-byte identity.

**When import is rejected:** Drawings, animation, karaoke, local font/color/position overrides, attachments and unsupported fields or tags reject the whole import. Keep the original; save a separate compatible copy in Aegisub. Do not overwrite your typeset original to make it importable. Text cursor splitting is stricter: lines with ASS tags or backslash escapes (including line breaks) cannot currently be split.

After editing, wait for “Local draft saved.” Open the same workspace with the same browser and account after a refresh or tab closure, then select “Restore draft.” You can restore subtitles before verifying the video. If the server version has changed, “Export draft ASS” downloads the applied subtitles. Any unapplied times appear in the draft notice. “Use server version” or “Use original version” closes the notice, and “View local drafts” opens it again. “Discard draft” deletes that draft. Clearing site data also deletes local drafts.

**QC and saving:** QC checks applied subtitle times, not unapplied time inputs. Editing invalidates a previous report; run the check again. Errors block export; warnings remain reviewable. Project Save does not submit time inputs until you apply them. If another operation changed the project, your local input is kept. Export a backup before discarding or reloading. A safe merge of remote style definitions can happen on explicit Save when subtitles on the server have not changed; it does not replace your video or history.

**Split-and-save exception:** Text-cursor and empty-line playhead splitting inside a project immediately save the full current subtitle snapshot, using the current valid time inputs. Undo restores local edits; it does not reverse that server save. The line menu's frame-before/frame-after splits remain local edits and require Save project. In a local workspace, Export ASS downloads a standalone subtitle file and keeps the local recovery copy. Use Save project to submit project subtitles to the server.

## Acknowledgements {#acknowledgement}

CueRelay's own code is licensed under GPL-3.0-only. Its workflow references Aegisub; subtitle preview, audio processing and fonts use third-party open-source components under their respective licenses.

[Open-source licenses and corresponding source](/open-source/index.en.html) provides the full notices, font licenses and source downloads for this build.

Contact the developer with questions or suggestions.
