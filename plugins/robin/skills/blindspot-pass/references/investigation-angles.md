# Investigation Angles

Five angles per route. One subagent per angle, all dispatched in parallel. The angles are chosen to be non-overlapping — each agent is blind to what the others find, which is what stops the pass from returning five versions of the same obvious fact.

## Briefing every agent

Every brief includes, regardless of angle:

- **The user's goal**, verbatim from calibration. Agents that don't know the goal return tours.
- **The user's familiarity level.** An agent briefed "user has never opened this" reports different things than one briefed "user has shipped here before".
- **Evidence requirement.** Every claim comes back with `file:line`, a commit SHA, a PR number, or a URL. A claim the agent cannot source is returned marked as inference, or not at all.
- **Return budget.** Ask for findings, not narration — roughly 400 words, densest first.
- **The surprise instruction.** Ask explicitly: *what here would surprise someone who assumed this worked the conventional way?* This is the line that produces unknown unknowns instead of documentation.

---

## CODE route

### 1. Structure and flow

Map the area: entry points, layers, the key types, and the path a call actually takes through it. Which files matter and which are noise.

Return: the mental model, plus the handful of files worth opening first with one line each on why.

### 2. History

Read the git history of the area — log, blame, merge commits, PR descriptions where available.

Look for: churn hotspots, reverts, and above all **prior attempts at the thing the user is now attempting**. Commits whose messages hedge (`temporarily`, `workaround`, `revisit`, `do not`) mark decisions someone regretted. Note who has worked here, since that is who the user can ask.

Return: what was tried, what was backed out, and what the history implies about why.

### 3. Extension precedent

Find the most recent change of the *same shape* as the user's goal — the last provider added, the last endpoint registered, the last migration of this type — and reconstruct everything that change had to touch.

Highest-yield angle. It recovers the unwritten checklist: the registration file nobody documents, the fixture that must be updated in lockstep, the second place the constant is duplicated.

Return: the full touch list of that precedent change, flagging anything a newcomer would not have predicted.

### 4. Tests and verification

What is covered, what conspicuously is not, how the tests are actually run, what fixtures or harnesses exist, and whether CI runs all of them or a subset.

Return: how the user verifies a change here, and which parts have no safety net at all.

### 5. Blast radius and local conventions

Who calls into this, what config, env vars, or feature flags gate it, whether any of it is generated, and which docs go stale when it changes.

Separately: conventions that hold *here* but not in the rest of the repo. Local exceptions are invisible to someone who learned the codebase elsewhere.

Return: what breaks outside the area, and every convention that applies only inside it.

---

## DOMAIN route

All five start from web research. Prefer practitioner sources — people who do the work — over introductory overviews, which tend to describe the field rather than its traps.

### 1. Mental model and vocabulary

The core concepts and how practitioners carve up the space. Include the terms themselves: not knowing the word for a thing is the blind spot that prevents every subsequent search.

Return: the model, plus the vocabulary the user needs to search independently.

### 2. What good looks like

How quality is judged in this field. Accepted standards, reference examples, and the specific things that separate professional output from competent-amateur output.

Return: the criteria a practitioner would apply, stated concretely enough to self-assess against.

### 3. Common mistakes

What newcomers reliably get wrong. For each, the part that matters is *why the mistake isn't self-evident* — what plausible-sounding reasoning leads people into it.

Return: the mistakes, each with the false intuition behind it.

### 4. Sequencing

What must happen before what. Focus on ordering errors that are expensive because they force rework rather than a quick correction.

Return: the canonical order, and the points where getting it wrong costs the most.

### 5. Current state

Tooling and versions, and specifically **what changed recently enough that older advice is now wrong**. Also where practitioners genuinely disagree, so the user isn't handed one camp's opinion as settled fact.

Return: the current landscape, what advice has expired, and which questions are contested rather than answered.
