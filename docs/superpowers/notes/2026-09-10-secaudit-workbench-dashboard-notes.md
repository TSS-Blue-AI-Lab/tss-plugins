# Implementation Notes — secaudit Workbench Dashboard (Part 3 of 3)

**Plan:** `docs/superpowers/plans/2026-09-10-secaudit-workbench-dashboard.md`
**Branch:** `docs/secaudit-workbench-plans`

## Deviations

### D1 — Prototype palette kept, plan's sketch palette dropped

The plan's Task 4 CSS sketch declares an invented hex palette (`--charcoal:#1b1d1c`,
`--panel:#232624`, `--teal:#35d6a4`, …) while its own Fidelity rule and its parity checklist
name `output/secaudit-workbench.html` as the authority for colour. The two disagree. I took the
prototype: `app.css` is the prototype's own stylesheet with the `fieldnotes` theme removed (a
dead branch, per Fidelity category 2) and the base64 `@font-face` blocks replaced by local
`./fonts/` files. The five approved measurements the parity test names are declared as custom
properties at the top and substituted into the rules that used the literals, so drift shows up
in a diff.

### D2 — Icons are path data, not markup strings

The plan's `icons.js` exports SVG markup strings and its `icon()` does
`span.innerHTML = ICONS[name]`, which its own parity test forbids (`app.js must not assign
innerHTML`). I exported the viewBox plus shape/attribute descriptors instead and build the SVG
with `createElementNS`. Same rendered icons, no markup assignment anywhere in the page.

### D3 — Tasks 4 and 5 committed together

Task 4's `app.js` calls `wireDragAndDrop`, `wireColumnDrop`, `renderDetail` and
`renderRunDetail`, all of which Task 5 defines. Splitting them would have committed a UI that
throws on first render, so both tasks landed in one commit. Both tasks' test assertions are in
`tests/secaudit/issues-ui-parity.test.mjs` and both pass.

### D4 — `allowedActions` added to `detailView`

Task 5's detail sketch renders action buttons but Task 1's `detailView` returns no action list,
so the buttons would have had to be re-derived in the browser — the exact duplication Task 1
set out to avoid. `detailView` now returns `allowedActions` from the same `ALLOWED` table the
cards use.

### D5 — `render.mjs` not created

The plan's Architecture paragraph names four modules including `render.mjs`, but no task
creates one and rendering happens in the browser from JSON. Not written.

### D6 — Detail header facts that the store does not carry

The prototype's detail shows `Observed <date>` and a separate short card title. The store keeps
one title per issue and no per-observation date, so the detail shows the issue title in both
places and `Last observed in run <runId>` instead of a date. Inventing a date would have put a
fact on screen the audit never recorded.

### D7 — Project name comes from the board response

The prototype's header shows a project name. Nothing in the store carries one, so
`GET /api/board` now returns `projectName` (the basename of the resolved project root) and the
header renders that.

### D8 — Persistence e2e second run is dated relative to now

The plan's e2e test stamps the reopening run `2026-02-01T00:00:00Z`, but the human "done" move
before it is stamped with the server's own clock (today). `attach()` deliberately only reopens
when the run STARTED after the human decision, so the fixed past date made `reopened` 0. The
run is now dated one day after the transition, which is what the assertion was actually
testing.

### D9 — The manual visual parity pass could not be run in this environment

Task 6 requires a side-by-side visual comparison in a browser. Headless Chrome
(`/Applications/Google Chrome.app`) hangs before producing a screenshot here, and there is no
other browser or automation driver installed, so the visual half of the verification is
OUTSTANDING and must be done by a human against `output/secaudit-workbench.html`. CLOSED on
2026-09-14: the user ran that pass against the live board and accepted it, after the release. What was
verified instead: the parity test's measurements and security properties, that every asset
(page, CSS, module, fonts, licence) is served with the right content type and a strict CSP,
and that the rebuilt stylesheet is the prototype's own rules with only the `fieldnotes` theme
and the inlined fonts removed.

### D10 — Refuted findings are archived by the audit, not triaged by a human

Reported by the user against the running board: refuted findings were sitting in the inbox.
`run-import.mjs` mapped every finding in `report-data.json` into an observation with no regard
for `classifyFinding`, so a `NOT-A-DEFECT` or `UNREACHABLE` verdict still demanded human
triage — against the spec's "the inbox is observations requiring human triage". No plan task
covered this; the user chose "import, auto-archive" from three options.

What changed: observations now carry the audit's `bucket`; a refuted observation creates an
issue in `suppressed` with `suppressedBy: 'audit'`. Two rules keep that distinct from a human
dismissal, which is what makes auto-archiving safe:

- A human dismissal is absolute — it suppresses the finding at publication in every later run
  and only an explicit Restore lifts it. `suppressedIndex` therefore skips `suppressedBy:
  'audit'` issues: marking a refuted finding "dismissed" in a report would move it out of the
  refuted count and imply a review nobody did.
- An audit refutation is provisional. The moment a later run observes the same fingerprint
  without refuting it, the issue returns to the inbox (`unrefuted`). Without that, a defect the
  audit once called unreachable would stay buried after the audit changed its mind.

Existing board issues are NOT auto-archived when a later run refutes them — a card a human has
already seen stays where it is. Only newly created issues open in the archive.

### D11 — Register cells overlapped on the archive and run-detail pages

Also reported against the running board. The flat register lays cards out on a fixed
`76px 1fr 115px 67px 16px` grid, and I had filled the 67px severity cell with the invented
string "Severity not stated" whenever severity was null — which, by the report contract, is
exactly every refuted and defect-determination finding. The cell now stays empty (no invented
label), the ambiguity flag moved inside the title cell instead of becoming a fifth grid child,
and the register's id/class/severity cells got `min-width:0` plus wrapping so real class names
cannot push into their neighbours.
