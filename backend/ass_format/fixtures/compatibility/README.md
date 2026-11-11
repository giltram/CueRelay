# ASS compatibility corpus

All `.ass` files here are synthetic CueRelay-authored test data, distributable
under the repository license. They contain no third-party subtitle excerpts.
`expected.json` contains authored expected script values, **all** style fields,
ordered cue payloads, exact exported event records and preserved metadata lines.
It is not generated from the parser or serializer and must not be refreshed from
actual codec output. Internal UUIDs and source line IDs are intentionally excluded.

- `text-and-metadata.ass`: Unicode/combining characters, commas/quotes, literal
  markup, whitespace, N/n/h controls, b/i/u/s toggles, empty text, 10ms/time maximum,
  overlapping same-layer cues in nonchronological order, Comment, margins/actor,
  PlayRes, opaque Script Info, semicolon and Aegisub metadata.
- `reordered.ass`: same semantics, reordered style/event Format and records.
- `empty.ass`, `comments-only.ass`: no editable cues; absent script settings.
- Remaining files: complete invalid inputs with expected error text and source
  line in the manifest (audit F1/F2/F3, missing reference, unsupported tag, bad
  timestamp/Format, attachment section).
- Follow-up R1–R3 adds `script-key-nbsp.ass`, `script-value-nbsp.ass`,
  `style-number-nbsp.ass`, `style-name-nbsp.ass`,
  `style-name-trailing-space.ass`, `style-font-trailing-space.ass`, and
  `reserved-default-case.ass`. The NBSP fixtures contain actual U+00A0 characters,
  not visible escape sequences; expected errors and source lines are authored in
  the manifest. There are now 4 valid and 15 invalid complete files.

`ass_format.test_compatibility` also covers BOM, newline/whitespace variants,
additional invalid mutations, output-size normalization and style operations.
`ass_format.test_follow_up` checks raw field whitespace, reordered Format,
safe ASCII controls, Unicode text preservation and reserved-name operations.
`http_api.test_ass_compatibility` and `projects.test_ass_compatibility` reuse the
same expectations through actual conversion and project persistence boundaries.
Frontend file-byte decoding is tested in `project-data/ass-api.test.ts`.
