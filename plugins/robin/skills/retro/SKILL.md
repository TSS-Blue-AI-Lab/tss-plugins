---
name: retro
description: "Conduct a retrospective on a coding session."
disable-model-invocation: true
version: 1.0.0
---

# Retro

Reads a finished coding session and proposes changes to the agent's **environment**: checks, pointers, standards, tooling, access. The goal is a next run on the same kind of task that goes better. Output is a ranked list of candidates.

The code the session produced is out of scope. A verdict on that code is a code review's job. Retro asks what in the repo let the struggle happen, and what would stop it next time.

Sibling: `quiz-me` is for *"I don't understand what got built"*. This one is for *"that was harder than it should have been"*.

## Constraints

- **Propose only.** Nothing changes until the user picks a candidate. Then make that change and nothing else.
- **Every candidate cites the session.** Name the moment it came from: the twenty calls to find one file, the error a lint rule would have caught, the fact the agent could not reach. Generic best practice with no moment behind it gets dropped, however sound it is.
- **Checks over prose.** A rule a machine can enforce becomes a check that fails. Only judgement calls become written rules.
- **Steering files stay short.** `CLAUDE.md` and `AGENTS.md` load into every session, relevant or not. They carry navigation pointers and little else. A repeated mistake earns a check or a review rule, not a new line there.

## Phase 1 — Source

Default source is the current session. If the user names another, read its log:

- Claude Code: `~/.claude/projects/<project-path-with-dashes>/<session-id>.jsonl`
- Codex: `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`

If the current session was compacted, the struggles from its middle are summarised away. Say so, and offer to read the log instead.

Read `references/writing-for-agents.md` before writing any candidate. Every rule, pointer, or skill you propose follows it.

## Phase 2 — Find the review step and the guardrail

Before proposing a standard or a check, find what the repo already has. Look, don't ask.

- **Review standards**: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, a review checklist, a reviewer agent's definition, a code-review skill or command.
- **Reviewer**: whatever reads those standards against a diff. An agent, a skill, a CI bot, or a person.
- **Guardrail**: the repo's own lint, typecheck, and test commands (`package.json` scripts, `Makefile`, `pyproject.toml`, and so on), its pre-commit config, its CI workflows.

Record each as found or missing. A missing guardrail is a finding of its own: a repo with no pre-commit hook and no CI job running lint, typecheck, and tests is a standing missed opportunity, not a neutral default.

## Phase 3 — Find candidates

Walk the session for the moments the agent struggled. Classify each one, and the class decides where the fix lands:

| What went wrong in the session | Fix it with |
|---|---|
| The agent took a long time to find a file or fact | A **navigation pointer** from a file it already reads |
| It made a mistake a tool could have caught | An **automated check**: lint rule, type, test, pre-commit hook, CI job |
| A judgement-call mistake got past review | A rule in the review standards |
| `CLAUDE.md` or `AGENTS.md` is large (repo or user scope) | Move its steering out, into standards or checks |
| A tool call was expensive for what it returned | Streamline the tool, or replace it |
| A steering file holds lines that change nothing | Delete the **no-ops** |
| The agent needed information it could not reach | Widen its access: tee the dev server log to a file, give read-only access to a service |

Three rules sharpen the table:

- **Wire before you build.** If a check already exists but nothing runs it, or it is silently broken, the candidate is to connect it. Read the repo's check commands and CI first.
- **Mechanical or judgement.** Classify a violation before writing any rule for it. A mechanical one (a banned API, an import shape, a file-location rule, any fixed syntactic pattern) gets a deterministic check: a custom rule in the repo's own linter, a pre-commit hook, or a CI job, whichever the repo's language and existing guardrail make cheapest. A judgement call (cross-file consistency, matching the surrounding style) goes to the review standards.
- **Standards need a home.** If Phase 2 found review standards, the rule goes there. If it found a reviewer but no standards file, propose creating `CODING_STANDARDS.md` and pointing the reviewer at it. If there is no review step at all, that is the candidate, ahead of any rule.

A check that fired on good code during the session is a candidate for removal. Retro sees one session, so it cannot audit old checks beyond that.

## Phase 4 — Present

Rank by cost, not by noise: how much the struggle cost in this session (calls spent, time lost, a wrong result shipped) times how likely it is to recur. A quiet, expensive mistake outranks a loud, cheap one.

For each candidate:

```
### <n>. <category> — <one-line change>
Moment: <what happened in the session, specific enough to find in the log>
Change: <the file to touch and what goes in it>
Lands here because: <one line>
```

Then ask which candidates to apply, and stop.

## Reference

### Implementation vs review

Work goes through two stages. Implementation carries the most **context pressure**: it explores, writes code, and debugs failures. Review carries the least: it gets a diff, needs no exploration, and rarely writes code.

So standards belong to review. A rule in a file the implementer always loads competes with everything else in its context. The same rule in the review standards is applied where there is room to apply it.

### Where each kind of file earns its place

- `CLAUDE.md` / `AGENTS.md`: pushed into every session in the repo. Use them sparingly, mostly for **navigation pointers** to other files.
- Review standards: read during review, not implementation. Once the file passes about 1,000 lines, move detail into docs and leave pointers.
- Docs: reference material reached by a pointer from another file. Look for an existing doc before writing a new one.
- Skills: for reference whose description should sit in the agent's context, or for commands the user types. `references/skill-mechanics.md` covers the invocation choice.
