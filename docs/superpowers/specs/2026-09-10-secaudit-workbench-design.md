# secaudit: persistent issues and approved Workbench design

Date: 2026-09-10

Status: Workbench visual design approved by the user. This document consolidates the agreed product behavior and proposes the technical boundaries for written-spec review before implementation planning.

## Approved visual reference

The approved interactive HTML is [secaudit-workbench.html](../../../output/secaudit-workbench.html).

SHA-256 of the approved file:
`5dc114ce29421c166bbeb11c0153ed1049739b8e277989780aa9ba4d8add5e41`.

The HTML is a local design artifact containing actual audit excerpts from the sibling invoice-engine repository. It is intentionally not committed with this document. Its human workflow states and activity entries are illustrative, not evidence that those issues have been triaged or fixed. Changes in the mockup reset on reload.

The selected design is Workbench, not Fieldnotes or the earlier board variants. The reference for its identity is the user's `BeyondVibeScanning.html` presentation. No further visual candidate selection is needed.

## Problem and outcome

Make audit preparation and output placement deterministic, then use the run information already retained in the target repository to build a persistent issue dashboard. Repeated observations should contribute to one issue's history. Human decisions must survive subsequent audits and browser sessions.

This work covers four connected parts: source-copy ownership and cleanup, predictable run artifacts, persistent issue identity and lifecycle, and the approved dashboard. It does not change the security hunters' purpose or replace their evidence with abbreviated dashboard summaries.

## Existing implementation and reference data

- `plugins/secaudit/skills/run/scripts/secaudit-runtime.mjs` already inspects and copies a target into `<runDir>/work`, records a corpus hash, and writes an ownership marker.
- `plugins/secaudit/skills/run/scripts/run-paths.mjs` resolves project/output paths. Today, the artifact root can fall back to the caller's Git repository when the target lacks one. `--output` means an exact run directory.
- `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/publish-artifacts.mjs` verifies source integrity, publishes report files, and removes the contents of `work` except `sast`. It does not currently advance the run marker beyond preparation.
- `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/report-contract.mjs` derives observation IDs from class, path, line, and title hash. These IDs cannot serve as stable cross-run issue IDs.
- The sibling `tss-invoice-engine/.secaudit` demonstrates both `runs/<id>/sast/report-data.json` and `runs/<id>/work/sast/report-data.json`. Existing history must remain usable across both layouts.
- Its September run also illustrates staging outside the owned work tree. Cleanup of the normal work tree cannot remove such staging reliably.

The existing reports are the audit record. A new issue store adds identity, relationships, and human decisions; it does not rerun old audits to recreate their data.

## Agreed product behavior

### Target, scope, and output

Keep persistent run history in the target project's `.secaudit`. Select audit scope afresh on each run; do not silently restore the previous scope. Show the resolved target, scope, and final output directory before launching the audit.

Create all source copies through one runtime-owned path. Preserve the original target's project identity when copying a selected scope. Do not let a temporary staging directory become the inferred project or artifact root.

Copied source is temporary and must be removed after successful publication. Retain reports, structured findings, coverage, and stage evidence. The source copy must not remain available as part of a successful run's history.

Preserve the documented exact-directory meaning of `--output`. Explicit output selection must be used consistently by preparation, workflow, publication, and dashboard discovery. The runtime remains responsible for validating ownership, overlapping paths, and symlink aliases.

### Issue lifecycle

The board has three columns:

1. **Audit inbox**: observations requiring human triage.
2. **Confirmed**: findings a human has confirmed.
3. **Done**: confirmed findings marked solved by a human.

There is no Fix in progress column. Audit verdicts and reachability remain separate from human workflow status; an audit's CONFIRMED bucket does not constitute human confirmation.

Inbox findings can be confirmed or marked false positive. Confirmed findings can be marked done. Done findings can be reopened. Do not allow inbox-to-done to bypass human confirmation. Corrections to human triage remain possible and produce history entries.

A matching later observation attaches to the existing issue instead of creating another card. A previously done issue rediscovered as an actionable finding reopens the same issue into Confirmed, retaining its earlier human confirmation and resolution history. Absence from a later audit does not automatically mark an issue done: scope and coverage can differ.

Human false positives live in a separate archive. Once suppressed, matching later audit observations must never raise that issue again or restore it to the inbox. Only an explicit human restore action lifts suppression and returns it to the inbox. The archive retains evidence and observation history.

Historical run reports remain an accurate record of what each audit emitted. The current actionable board and post-run summary must distinguish new, repeated, reopened, and suppressed observations, so repeats are not presented as new findings.

### Detail content

Show the complete original title and all emitted report fields, preserving text without summarization or truncation: Location, Challenge, Trace evidence, Impact, Remediation, and Dynamic test. Show optional sections only when the source record contains them. Preserve code, paths, and line breaks. Missing severity is not an invitation to invent one.

Keep the original audit verdict visible and distinguish it from human state. Let users inspect observations from different runs; changing human state never edits historical audit evidence. Activity is secondary to the finding content.

## Approved interface specification

- Use the presentation's charcoal and dark green palette with clear, high-contrast text. `/sec` is teal green and `audit` is white. Use IBM Plex Sans for body content and IBM Plex Mono for navigation, labels, IDs, headings, and the wordmark.
- Sidebar starts expanded, approximately 212 px wide; collapsed width is approximately 78 px. Use the `/s` wordmark as the expansion control when collapsed and change its color on hover.
- Use the approved consistent 18 px SVG line icons for Issues, Runs, and False positives. Align icons and labels on shared centers and baselines; do not reintroduce Unicode menu glyphs.
- Keep navigation readable: sidebar labels approximately 14 px, action text 13 px, report body 15 px. Uppercase labels must remain legible against their background.
- App fills the browser's height. Sidebar and top bar remain fixed in the shell and never scroll. The board's three columns fill the remaining height and each scrolls independently.
- Use a 58 px top bar. Logo, collapse control, contextual back control, and workspace name share the same vertical center. Back and collapse use the same 28 px chevron-button treatment.
- Show back only when a parent view exists. Finding details return to their originating board, archive, or run. Nested run navigation returns to the run detail, then the run list. Remove extra Back to issues/run links.
- Use slight translucency and blur on the top bar and the sticky section tabs inside details.
- Details span the available screen width and meet the sidebar and top bar without an exterior gap. Retain comfortable internal report padding, approximately 24 px. Only the detail content scrolls.
- Use full-width cards on Runs, with a clear card interaction instead of a detached arrow. Run details also span the available width.
- Issue cards are compact and draggable between allowed columns; update counts and history when a move succeeds. Provide equivalent button actions so dragging is optional. Remove diagonal up-arrow decorations.
- Keep the presentation focused: representative issues and severity, concise card metadata, full evidence inside details. Do not center the experience on reopened issues or add unnecessary metrics.

The HTML is the visual authority for spacing, colors, borders, density, and interaction treatment. Production code should implement this design in focused components rather than carry forward exploratory CSS overrides from the prototype.

## Proposed technical design for implementation planning

These are implementation proposals supporting the agreed behavior, not claims that the backend already exists.

### One run context

Resolve and persist one immutable context containing project root, source target, selected scope, run ID, exact run directory, owned work directory, and source hash. Pass this context through both the Claude workflow and Codex runbook. Neither agent instructions nor later stages should reconstruct paths from the current working directory or create independent staging copies.

Keep the current `work/sast` evidence layout for new runs to minimize disruption. Record explicit preparation, publication, and cleanup status in the marker. A run is complete only when artifacts are published and source cleanup succeeds. Preserve the current source-integrity gate: a changed source aborts publication and pruning. Failed/interrupted runs retain owned diagnostic state and expose incomplete cleanup rather than claiming success.

### Run catalog and issue store

Add versioned repository-local state under `.secaudit`, with a catalog of run locations and a separate issue store. Register explicitly selected output directories in the target project's catalog so they remain discoverable. Default runs can also be rediscovered from `.secaudit/runs`.

Import structured evidence from both existing layouts without modifying the original reports. Use the run ID plus observation ID as the ingestion key. Re-importing or restarting ingestion must not duplicate observations or human transitions. Unsupported or malformed runs appear as unavailable with a reason, rather than blocking all other history. Do not infer human decisions from audit verdicts or unstructured notes.

Each issue has a generated stable ID, matching aliases, human state, first/last observation references, and ordered human/system events. Evidence stays associated with its original run. Store updates are serialized and atomic; stale browser writes receive a conflict response and refresh the issue instead of overwriting newer decisions. A failed save must not leave a card appearing successfully moved.

### Cross-run matching

Keep legacy report IDs as observation identifiers. Add a separate versioned fingerprint based on vulnerability class, normalized project-relative location, and a root-cause/code anchor that excludes title wording and absolute line numbers. Generate anchors while the source copy exists and persist them before cleanup. Multiple independent defects in one file must remain distinct.

Use exact known aliases first, then a unique verified structural match. Do not merge unrelated findings just because their titles or file paths resemble one another. Historical findings without enough anchor information require an explicit merge decision when matching is ambiguous. Human merges retain all observation aliases, including suppression aliases.

The implementation plan must specify the anchor algorithm and its supported languages/legacy fallback before coding it. The matching tests must cover title edits, line shifts, multiple same-class findings in one file, and false-positive aliases. Suppression guarantees apply to matched identities; uncertain legacy identity must be surfaced rather than hidden behind a claim of perfect deduplication.

### Local dashboard

Use a local server to read run evidence and persist human actions. Keep it within the plugin's existing Node runtime approach. Separate run discovery/import, issue matching/storage, HTTP routing, and UI rendering into independently testable modules.

Bind to loopback and scope file access to the selected project and registered run artifacts. Validate mutation requests and reject foreign origins. Render audit content as untrusted text or safely rendered Markdown; report excerpts must not execute in the dashboard. Keep font/assets local so the approved appearance works offline.

## Delivery order and verification

1. **Run lifecycle:** unify target/scope/output context, remove ad hoc staging, track publication and cleanup, and update both client launch paths and stale README cleanup guidance.
2. **History and issue identity:** import current/legacy runs, add idempotent ingestion and matching, implement human transitions and suppression, and cover crash/retry behavior.
3. **Dashboard:** connect the approved Workbench to the local store, load full evidence, persist drag/button actions, and expose saved history and failures accurately.

Extend the existing runtime-paths, runtime-prepare, source-corpus, artifact-publisher, report-contract, and integration tests as appropriate. New persistence tests must establish that repeated import is harmless, done findings reopen on later actionable observations, suppressed findings stay suppressed, and old runs imported later cannot reopen a currently done issue merely because ingestion happened out of order.

Exercise output paths containing spaces, target subdirectories, separate project/corpus roots, explicit external outputs, symlink aliases, and interrupted publication. Verify only runtime-owned copies are removed and original source remains untouched.

For the dashboard, verify expanded/collapsed alignment, contextual navigation, full-height independent scrolling, long evidence, keyboard/button alternatives to drag, successful persistence after restart, and visible rollback on failed writes. Compare the result against the approved HTML at desktop and narrow viewport widths.

The mockup has already been checked for full-height layout, fixed shell, aligned controls/icons, zero exterior detail gaps, contextual back navigation, independent column scrolling, drag transitions, and equality of the eleven embedded audit records with the source data. These checks validate the prototype only; production verification remains required.

## Scope boundaries

No hosted service, accounts, external issue-tracker integration, automatic remediation, automatic human confirmation, or automatic resolution from absence is included. Do not silently import the prototype's illustrative workflow decisions. Do not delete pre-existing unowned staging folders as part of the new cleanup mechanism.

Visual approval is recorded. Next is written-spec review and a detailed implementation plan, including the exact matching algorithm and file-level tasks; this document does not authorize starting a full security audit.
