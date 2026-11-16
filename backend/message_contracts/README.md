# Message metadata

A pure leaf with no Django, HTTP, locale state or translation engine. `localized(reason, text, params)` returns a string-compatible `Message` with stable reason/params. Existing Chinese exception messages and machine error codes stay compatible. Message construction substitutes parameters for old callers; the browser formats the original descriptor in its current language.

`wire_messages` adds reason/params alongside message fields at HTTP serialization boundaries, without changing source content or protocol identifiers. ASS errors attach the same metadata to their issue, so direct codec inspection and HTTP agree. Django validation aggregates retain every specific error in `error.details`; password validators keep their standard error codes and parameters. Unknown/older errors retain their original details.

Dependencies: `{accounts, organizations, projects, glossary, ass_format, HTTP serialization} → message_contracts → Python stdlib`. No reverse dependencies. UI resources live in `frontend/src/i18n/locales/*/server.json`; the resource checker validates literal backend reason references. HTTP and account coverage: `http_api/test_i18n.py`, `accounts/test_language.py` and the existing suites.
