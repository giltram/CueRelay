# Project and ASS transport

`projects-api` exposes authenticated project requests through an injected JsonRequest. `project-style-save` and `project-document-save` own the existing one-shot safe retry policies; document/source/style equality stays in explicit lower-level contracts/helpers. They do not own editor state or translate messages.

`ass-api` is the stateless conversion boundary for import/export/inspection/split/clipboard. `styles-api` also exposes template requests and local pure style transformations. Non-success responses preserve all specific issues, source lines and reason/params as contracts/messages descriptors inside MessageError; request IDs remain attached. Older servers retain exact legacy message details. Display code formats errors in its current language; changing language never repeats a request or retries a save.

Dependencies: project-data → contracts/subtitle-model/diagnostics/browser APIs. No React, i18n instance, workspace internals or navigation lifecycle ownership. Focused tests are colocated; real integration and language acceptance commands are in docs/testing.md and docs/internationalization.md.

`subtitle-api` dispatches `.ass` files to the existing `importAss` and strictly decodes `.srt` UTF-8 (optional BOM, 1MiB) before `/api/srt/import`. The response is the same v2 document with canonical ASS source, so ProjectForm sends it through the unchanged project creation contract. `exportSrt` sends only the supplied applied document to `/api/srt/export`; it does not submit timing drafts or persist anything. Parsing, precision, markup and escaping belong exclusively to backend `srt_format`, which depends on the ASS public boundary. Transport/error/encoding tests: `subtitle-api.test.ts`; full subset: `backend/srt_format/README.md`.
