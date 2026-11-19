# Resource read ordering

`ReadOrder` owns monotonic data and feedback versions for one resource/query. `start()` identifies a read; `acceptData()` orders successful payloads and authoritative permission/resource denials; `acceptFeedback()` orders error display and successful error clearing. A transient failure must only call `acceptFeedback()`, so it cannot hide an older valid revocation or initial payload. A pending newer request never invalidates completed data.

App owns account/membership epochs and ignores reads from older epochs. ProjectsPanel creates one order per organization/query/enabled lifetime and ignores callbacks from replaced orders. It separately counts outstanding requests and always settles them, even when their result is ignored. `isLatest()` guards automatic page correction: older rows may be displayed, but older totals must not change the current page while a newer check exists.

app-workspace shares an order across route reads, explicit reload and background status observations for the same actor/project. Clear, replacement or disabled session invalidates that context. A stale successful status cannot clear a newer denial; a stale reload cannot replace the editor or authorize draft deletion. These consumers do not use this class for session identity decisions, writes or editor state.

Dependencies: none. Public API and invariants are covered in `read-order.test.ts`; browser integration is in `browser-tests/context-refresh.mjs` and `browser-tests/resource-response-races.mjs`.
