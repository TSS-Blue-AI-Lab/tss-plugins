---
name: run
description: >-
  Launch the full secaudit source-code security audit against a repository.
  Explicit-only entry point: inspects the target read-only, recommends hunters
  with a token-cost bracket, asks the user which hunters + whether to run the
  blindspot sweep, prepares an isolated run via the deterministic runtime, then
  starts the deterministic workflow. The workflow itself never prompts.
disable-model-invocation: true
argument-hint: "[repo-path] [--output <exact-run-directory>]"
---

# secaudit:run — launch the audit

This skill is a thin launcher. It asks the user two things UP FRONT, then hands a fixed
config to the deterministic Workflow spine.

## Step 0 — preflight Node (hard prerequisite)

Run `node --version`. If it fails or reports a major version below 22, STOP and tell the
user: secaudit requires Node.js 22 or newer on PATH (https://nodejs.org) — nothing else
is attempted until that is installed. Do not work around it.

## Step 0b — resolve PLUGIN_ROOT (once, then reuse)

Every command below runs a script bundled with secaudit, not a script in the repository being
audited. The plugin root and the audit target are different roots and are never derived from
each other.

- **Claude Code:** PLUGIN_ROOT is `${CLAUDE_PLUGIN_ROOT}` — that placeholder is expanded to the
  plugin's absolute installation directory before you read this file. If you literally see the
  unexpanded placeholder text here, expansion did not happen; use the fallback rule below.
- **Any other client (Codex and friends):** PLUGIN_ROOT is the directory two levels above this
  file — this file is `<PLUGIN_ROOT>/skills/run/SKILL.md`.

Substitute that absolute path for `<PLUGIN_ROOT>` everywhere below, and always quote it — the
plugin may be installed under a path containing spaces. Never substitute the audit target for
it, and never assume the plugin lives inside the repository being audited.

## Step 1 — inspect the target (read-only, no subagents)

Run the deterministic inspection. If the user gave a repo path, pass it; if they gave
`--output`, remember it for Step 3 (inspect does not take it):

```
node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" inspect --target <repo-path>
```

Omit `--target` entirely when the user gave no path — the runtime resolves the Git
toplevel above the current directory, else the current directory. Parse the one-line
JSON: `{target, targetSource, artifactRoot, artifactRootSource, coverage, extensions, manifests,
exclusionsApplied, warnings, …}`. On `{"error":{code,message}}`, report the message and stop.

**Show the resolved `target` to the user before anything else** — they must see what
would be audited. Surface any `warnings` verbatim.

**Show where the report will be written**: `<artifactRoot>/.secaudit/runs/`. The run directory
follows the PROJECT root, not the audited tree — `artifactRootSource` says which one it found:
`targetGitRoot` (the audited tree's own repository), `cwdGitRoot` (the audited tree is in no
repository, so the run follows the one you are standing in — this is what keeps an audit of a
staged or copied workspace out of that copy), or `target` (nothing is a repository). When it is
not the target, say so plainly; the user can override the exact directory with `--output`.

`targetSource` says how that path was arrived at: `explicit` (the user named it), `gitToplevel`
(guessed by walking up from the current directory to the nearest repository root), or `cwd`
(guessed, no repository found). A guess can be wider than the user meant — running from
`repo/services/api` audits all of `repo` — so anything other than `explicit` MUST be confirmed
in Step 2 before Step 3 writes anything.

**Print the size line** from `coverage`:
`Repo: <sourceLines> source LOC, ~<estimatedSourceTokens> source tokens`.

**Estimate the full-scan token cost and tell the user.** Rough, tunable heuristic:
- `FIXED ≈ 150k` tokens — Recon + Dedupe + Trace + Generate Artifacts overhead.
- `PER_HUNTER ≈ 40k + coverage.estimatedSourceTokens` — each hunter reads its skill + the relevant slices of source.
- `est ≈ FIXED + nHunters × (40k + estimatedSourceTokens)`; the blindspot sweep roughly **doubles** the hunt+challenge portion.

Print an order-of-magnitude line, e.g. `Est. full scan (N hunters, blindspot sweep off):
~XXXk–YYYk tokens. Fewer hunters = proportionally fewer tokens — trim the list below to
cut cost.` Keep it a bracket, not false precision.

**Map `extensions` + `manifests` to a RECOMMENDED subset** of these 14 classes:
`businesslogic, fileupload, graphql, hardcodedsecrets, idor, jwt, missingauth, pathtraversal, rce, sqli, ssrf, ssti, xss, xxe`.
Rule of thumb: always include `sqli, idor, missingauth, hardcodedsecrets`. Add `ssrf`/`rce`
for services that make outbound calls or shell out; `xxe` when XML is parsed (`pom.xml`,
`.csproj` hint at XML-heavy stacks); `graphql` only if a `.graphql` schema/endpoint exists;
`fileupload`/`xss` only if upload or HTML-render surface exists (`.html`/`.cshtml` in
`extensions`); `jwt` if tokens are issued/verified. Exclude classes with no matching
surface and say why.

Also form a blindspot-sweep RECOMMENDATION: small/simple repo (few files, one service) →
recommend the blindspot sweep OFF; large or high-surface repo → recommend it ON. The
blindspot sweep adds one more full hunt+challenge round targeting what the first round missed.

## Step 2 — ask the user (AskUserQuestion)

`AskUserQuestion` allows at most **4 options per question**, so the 14 hunter classes cannot
all be shown as checkboxes. The user must still be able to SEE every available class — so the
hunter question text MUST list all 14 valid class names verbatim. Never leave the user
guessing what they can type.

Ask these in one AskUserQuestion call — the target question only when Step 1 reported
`targetSource` other than `explicit`:

0. **Target** (single select, ask ONLY when `targetSource !== "explicit"`). Question text:
   "No path was given, so I resolved the target by <`gitToplevel` → walking up to the nearest
   Git repository root / `cwd` → using the current directory>. Audit `<target>`?" State the
   size line from Step 1 alongside it, so the scope is visible as a number too.

   Options:
   1. **Yes, audit `<target>` (Recommended)** — the resolved path.
   2. **A different path** — the user supplies one via Other; re-run Step 1 `inspect` with
      `--target <their path>` and start Step 2 again with the new numbers.

   Never skip this question by inferring consent from the hunter answer. If the user picks a
   different path, the old `target`, `coverage` and recommendations are stale — discard them.

1. **Hunters** (multiSelect). Question text MUST include:
   - The full valid class list verbatim: `businesslogic, fileupload, graphql, hardcodedsecrets,
     idor, jwt, missingauth, pathtraversal, rce, sqli, ssrf, ssti, xss, xxe`.
   - Your Step-1 recommended subset and one-line why, plus the est-token line from Step 1.
   - A note: "Tick the presets below, or choose Other to type a custom space/comma-separated list
     from the classes above."

   Options (multiSelect; recommended first, labelled "(Recommended)"):
   1. **Recommended (N): `<your inspect-matched subset>`** — the classes with matching surface.
   2. **Core 4: `sqli, idor, missingauth, hardcodedsecrets`** — cheapest sensible floor.
   3. **Full 14-class sweep** — everything (maps to `hunters: "all"`).

   The user can tick presets or use Other to supply any custom subset by name. Validate typed
   names against the 14-class list; drop unknowns and tell the user which you dropped. If multiple
   presets are ticked, union them.

2. **Blindspot Sweep** — "Run the optional Blindspot Sweep? Off is cheaper and the default."
   Options: Off (recommended for this repo) / On. Flip the recommendation label to match your
   Step-1 recommendation.

If the user passed an explicit hunter list or blindspot-sweep choice in their message, skip the
corresponding question.

## Step 3 — prepare, then launch

Create the isolated run with the deterministic runtime, using the `target` from Step 1's
JSON (and the user's `--output` if they gave one):

```
node "<PLUGIN_ROOT>/skills/run/scripts/secaudit-runtime.mjs" prepare --target <target> [--output <exact-run-directory>]
```

Parse its one-line JSON: `{runId, runDir, work, target, artifactRoot, coverage, corpusSha256,
generatedDate, …}`. On `{"error":{code,message}}`, report the message and stop — never
improvise a workspace. **Print the resolved `runDir`** before launching: it is where every
artifact of this run will appear, and the only chance to redirect it is now.

Call the workflow with the chosen config, passing the prepare fields through verbatim. The
`hunters:` argument is MANDATORY — substitute the user's selected classes as a literal array
(or the literal string `"all"` if they chose the full 14-class sweep):

```
Workflow({
  name: "secaudit:secaudit",
  args: {
    target: "<target>",
    work: "<work>",
    runDir: "<runDir>",
    runId: "<runId>",
    coverage: <coverage object, verbatim>,
    corpusSha256: "<corpusSha256>",
    generatedDate: "<generatedDate>",
    pluginRoot: "<PLUGIN_ROOT>",
    hunters: ["sqli", "idor", "missingauth"],
    blindspotSweep: false,
    traceBatch: 5,
    launchToken: "secaudit:run"
  }
})
```

`name` is the installed plugin's namespaced workflow (plugin `secaudit` + workflow `secaudit`).
If the client reports no such workflow because you are running from an uninstalled checkout
rather than an installed plugin, retry with the bare name `"secaudit"`. `pluginRoot` is
mandatory: the workflow has no filesystem or environment access, so it cannot find its own
bundled skills and scripts — without it the run dies at the first agent dispatch.

Do NOT omit `hunters:`. The workflow HARD-FAILS if `hunters` is missing or empty (it
refuses to silently run all 14) — so a dropped selection errors immediately instead of
running an expensive full sweep. Pass `hunters: "all"` only when the user explicitly wants
every class. `launchToken` is the handshake that authorizes the full pipeline — the
workflow refuses to start without it, and nothing except this skill may supply it.

Optional `traceBatch: N` (default 5) raises records-per-Trace-agent if a run is still
too expensive. (Challenge itself is not batched — it runs one Challenger per hunter with findings.)

This orchestrates: Recon (map) → Hunt (one focused agent per chosen hunter) →
Challenge (adversarial, one Challenger per hunter) → [Blindspot Sweep] → Dedupe → Trace →
Generate Artifacts, with a guaranteed artifact generation step. Watch live progress in
`/workflows` and by tailing `<work>/sast/`.

## Step 3b — verify the selection took

Once the run reaches Recon, confirm its trace/ledger `Recon / Prepare:` line shows
`hunters=<the count you selected>`. If it shows a different count, the selection was dropped —
stop and re-launch with the correct `hunters:` array.

## Step 4 — report back

When the workflow finishes, report to the user: counts of CONFIRMED / REFUTED / MANUAL REVIEW,
the top 3 CONFIRMED findings, and the paths to `<runDir>/trace.md` and
`<runDir>/work/sast/report-data.json`. No report is rendered — the findings are read in the
`secaudit:issues` dashboard. Remind the user the run directory is ephemeral — it ignores its own
contents wherever it sits in a working tree, and holds a full copy of the audited tree including
its `.env` — so copy out anything worth keeping and delete it when done. Never claim the codebase is "secure."

**Fallback (no Workflow engine, e.g. Codex):** follow
`<PLUGIN_ROOT>/skills/secaudit-orchestrator/SKILL.md` stage-by-stage instead.
