# Security policy

## Reporting a vulnerability

Report privately through GitHub's **Report a vulnerability** button under this repository's
[Security tab](https://github.com/AI-Lab-Yonder/tss-plugins/security/advisories/new). Please do
not open a public issue — a public report on security tooling is itself a disclosure.

Include the affected plugin and version, what an attacker can do, and the smallest steps that
reproduce it. Expect an acknowledgement within a few working days. There is no bug bounty.

## Scope

In scope — this repository's own code:

- the deterministic Node runtime under `plugins/secaudit/skills/run/scripts/` (path handling,
  run-directory ownership, symlink containment, the isolated work-tree copy)
- the artifact pipeline under `plugins/secaudit/skills/secaudit-generate-artifacts/scripts/`
  (report rendering and publication, including HTML output)
- the marketplace and plugin manifests, and the CI workflow

Out of scope:

- **Missed findings.** secaudit reports vulnerabilities with evidence; it never certifies that a
  codebase is secure. A vulnerability it fails to detect is a product limitation, not a security
  flaw in this repository.
- **False positives.** Same reason — file a normal issue.
- Vulnerabilities in Claude Code, Codex, or Node.js. Report those to their maintainers.
- Anything requiring the attacker to already control the machine running the audit.

## What running an audit does to your machine

Worth knowing before you report, and worth knowing generally:

- secaudit makes a verbatim copy of the target directory — **including dotfiles, so including
  real secrets in `.env` files** — into the run directory, in order to audit an isolated tree.
  Every run directory carries its own `.gitignore` so the copy cannot be committed by accident.
- Run directories are ephemeral. Delete `<target>/.secaudit/runs/<run-id>/` when you are done;
  it holds that copy of your source.
- The runtime uses Node built-ins only. It makes no network requests and spawns no processes.
  The agent driving it, however, sends source code to whichever model provider you have
  configured. **Do not audit a repository you are not permitted to send to that provider.**
- `report.md` and `report.html` quote source excerpts from the audited code. Evidence is escaped
  before rendering, so a hostile repository cannot inject live markup into a report — but the
  report still **contains your source**, so treat it as confidential as the code it describes.
