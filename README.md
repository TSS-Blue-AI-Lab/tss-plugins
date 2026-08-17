# tss-plugins

Public plugin marketplace by TSS Blue AI Lab. One canonical skill tree per plugin serves
Claude Code, Codex (CLI + desktop app), and any agent that reads standard `SKILL.md`
folders.

## Plugins

| Plugin | Description |
|---|---|
| [secaudit](plugins/secaudit/) | Agentic source-code security audit: Recon → Hunt → Challenge → Dedupe → Trace → report generation. Deterministic Node runtime, never mutates the target repo. |
| [robin](plugins/robin/) | Skills for the whole build: `blindspot-pass`, `strawman` and `interview-me` before implementation, `quiz-me` after, and a Claude Code hook that keeps implementation notes during. |

## Install

### Claude Code

```
/plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
/plugin install secaudit@tss-plugins
/plugin install robin@tss-plugins
```

### Codex CLI

```
codex plugin marketplace add TSS-Blue-AI-Lab/tss-plugins
```

Then open `/plugins` and install `secaudit`, `robin`, or both.

### Codex desktop app

No CLI needed — the app has a UI for this:

1. Open **Plugins**, then **Create** → **Add Marketplace**, and add
   `TSS-Blue-AI-Lab/tss-plugins`.
2. Back in **Plugins**, open the **Personal** tab, find **secaudit** and **robin** under
   **TSS Plugins**, and hit **Install** on the ones you want.

## Contributing

This repository is the development home for its plugins. Plugin content lives under
`plugins/<name>/`, its tests under `tests/<name>/`. Run the suite with:

```
for t in tests/*/*.test.mjs; do node "$t"; done
```

Releases: bump `version` in the plugin's `.claude-plugin/plugin.json` AND
`.codex-plugin/plugin.json` (must match), commit conventionally (`feat(<plugin>): v0.2.0`).

A plugin that ships a `hooks/` directory must declare `"hooks": {}` in its
`.codex-plugin/plugin.json`. Codex auto-discovers `hooks/hooks.json` when the field is absent
— and an absent field, `[]`, and an empty inline list all fall back to that discovery, so it
must be exactly an empty object. `tests/robin/validate-manifests.test.mjs` asserts this.

## License

MIT — see [LICENSE](LICENSE). Third-party notices: [NOTICE](NOTICE).
