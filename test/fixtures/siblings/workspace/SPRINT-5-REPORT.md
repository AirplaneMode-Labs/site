unchanged): pagetriage `1de5ff5..eb28e49`, glyphsift `b3ea291..ec6b108`, dockit `f8abddc..840ec8b`, site
`5974bb6..fe2b00b`. runtime `4f5b011`, localdata `da39477` and control-plane `436ecb5` are unchanged. Every clone is
- pagetriage: every Windows leg green (D2-01 proven); ubuntu `Script tests` red (44325732090): the duplicate-id
- glyphsift: the wheel job red on ubuntu (44325740893): the wheel check compared a compressed PEP 425 tag set as a string.
- dockit: `pages` deployed, live at `f8abddc`; `check (windows-latest)` red (44325772916: a drive-letter path
- site: `ci` and `pages` red on all OSes (44325781731, 44325781916): build-id tests read the runner's `GITHUB_SHA`.
- **Done-when: build done on Apple M5 Pro 48 GB; 8 GB Windows done-when NOT met (owner runbook step 5).**
