# Third-party notices

CueRelay's original code is licensed under GPL-3.0-only. This does not relicense
third-party code, fonts, or upstream source archives. Their original licenses,
copyright notices and disclaimers remain applicable. No upstream author endorses
CueRelay. All software is provided without warranty under its applicable license.

## Browser dependencies

The reviewed versions, license expressions and notice paths are recorded in
[licenses/npm.json](licenses/npm.json). Full notices are in
[licenses/texts](licenses/texts), including MIT, Apache-2.0, GPL-3.0 and MPL-2.0.
The build publishes these notices and matching installed-package source snapshots
at `/open-source/`. Those snapshots preserve upstream source and metadata, rather
than treating minified JavaScript as the preferred source form.

JASSUB's JavaScript wrapper is MIT-licensed, but its WASM binaries have additional
licenses. [licenses/upstream.json](licenses/upstream.json) records the exact
JASSUB source revision and its Brotli, FreeType, FriBidi, HarfBuzz and libass
submodules. Their full source archives and reproduced notices accompany every
build. FreeType's FTL alternative is used; portions of this software are
copyright © 1996–2026 The FreeType Project (https://freetype.org). All rights reserved.

The source releases for React/ReactDOM 19.3.1 and Scheduler 0.28.0 are also
provided at their npm release gitHead commits, including original sources and
build scripts. FreeType's recursive `subprojects/dlg` dependency is included.

## Aegisub references

The timeline ruler and contextual spectrum palettes reference Aegisub 3.2.2
rules/parameters. Relevant upstream file notices, including Rodrigo Braz Monteiro
and Niels Martin Hansen's BSD terms, are reproduced in
[licenses/texts/aegisub.txt](licenses/texts/aegisub.txt).
Timing shortcuts, snapping, marker shapes and subtitle-line operations also
reference Aegisub behavior; these references do not imply affiliation or endorsement.
Further sources and the distinction between behavior and code references are in
[licenses/README.md](licenses/README.md).

## Fonts

Noto Sans SC Regular 2.004 is © 2014–2021 Adobe. Noto is a trademark of Google Inc.
JASSUB's unchanged Liberation Sans 2.00.5 WOFF2 contains digitized data copyright
© 2010 Google Corporation and © 2012 Red Hat, Inc. Liberation is a Red Hat trademark.
Both fonts are distributed under SIL OFL 1.1, with their notices in
[fonts.txt](licenses/texts/fonts.txt) and the full [OFL](licenses/texts/OFL-1.1.txt).

## Server dependencies

Django 5.2.18, Django REST Framework 3.18.3 and asgiref 3.12.1 use BSD-3-Clause;
sqlparse 0.6.0 uses BSD terms; pysubs2 1.8.1 uses MIT;
psycopg / psycopg-binary 3.3.6 use LGPL-3.0-only;
typing-extensions 4.16.0 uses PSF-2.0. Versions are pinned in
`backend/requirements.txt` (typing-extensions is transitive).
These packages are installed separately, not included as server binaries in the
browser release or the application source archive. Distributing a server image
must additionally preserve its installed packages' notices, source obligations
and bundled native-library licenses; the browser release is not an image audit.
