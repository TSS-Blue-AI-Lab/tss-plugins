# Question Sources and Ranking

## Where ambiguity hides

Eight places. Sweep all of them before ranking — the queue is only as good as the enumeration.

### 1. Undefined nouns

Terms used as if their meaning were agreed, never pinned down. "The sync", "a session", "the record", "valid". Two people reading the same plan carry different definitions and neither notices until the code disagrees.

### 2. Unstated defaults

A choice made implicitly by phrasing rather than deliberately. The plan says "store it in the database" — that decided persistence, durability, and probably transactionality, without anyone treating it as a decision.

### 3. Branch points

Places where the design genuinely works either way and nobody picked. These are the questions worth the most, because they are the ones that stay open silently.

### 4. Boundary and failure behaviour

What happens on empty, on error, on retry, on concurrent access, at ten times the volume. Brainstorming produces the happy path; the ambiguity is everywhere else.

### 5. Scope edges

In scope versus out. What happens to the thing this replaces. Who owns the part that touches someone else's system. Migration of what already exists.

### 6. Decision dependencies

Questions that only matter if an earlier question went one way. Map them — this is the decision tree, and asking a child before its parent wastes both turns.

### 7. Success criteria

How the user would know it worked. What "done" means. What would make them roll it back. A plan with no stated success criterion has one implicitly, and it is usually wrong.

### 8. Unstated constraints

Deadline, backwards compatibility, existing consumers, data volume, budget, who has to review it. Constraints the user holds in their head and has not said out loud are the most common cause of a plan that gets rebuilt.

## Ranking by blast radius

The test, applied to every question:

> If the opposite answer were given, would something already agreed have to be rebuilt?

| Level | Meaning |
|-------|---------|
| `HIGH` | Changes the architecture, an interface, or the scope. Different answers produce different implementations, and switching later means rework. |
| `MED` | Changes a component's internals or the order of work. Contained, but decide now or pay later. |
| `LOW` | Preference, naming, or a detail that is cheap to change after the fact. |

Rank by consequence, not by how interesting the question is or how unsure the skill is about the answer.

**Override.** If the user named a priority axis at invocation — "prioritize questions where my answer would change the architecture", "focus on anything that affects the API" — that axis replaces the default ordering within the high tier.

## Asking well

Each question carries:

- **The question**, one line, specific enough that a one-word answer means something.
- **A recommended answer**, with the reason — what in the source or the codebase points that way.
- **The alternatives**, so the user can pick one or write their own.
- **What it settles**, when the consequence isn't obvious. "Either answer works, but this one commits us to X."

Do not explain the whole decision tree while asking. One question, its options, and why. The user is answering, not reading.
