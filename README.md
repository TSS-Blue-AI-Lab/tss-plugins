# tss-plugins

Public plugin marketplace by AI Lab Yonder. One canonical skill tree per plugin serves
Claude Code, Codex (CLI + desktop app), and any agent that reads standard `SKILL.md`
folders.

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [secaudit](plugins/secaudit/) | 0.1.0 | Agentic source-code security audit: Recon → Hunt → Challenge → Dedupe → Trace → report generation. Deterministic Node runtime, never mutates the target repo. |

## Install

### Claude Code

```
/plugin marketplace add AI-Lab-Yonder/tss-plugins
/plugin install secaudit@tss-plugins
```

### Codex CLI

```
codex plugin marketplace add AI-Lab-Yonder/tss-plugins
```

Then open `/plugins` and install `secaudit`.

### Codex desktop app

Add the marketplace via the Codex CLI command above, restart the app, then pick
`tss-plugins` as the source in the Plugins Directory and install from there.

### Other agents (Cursor, Copilot, Gemini CLI, OpenCode, …)

Via [skills.sh](https://skills.sh), pointing at the plugin's skill tree:

```
npx skills add AI-Lab-Yonder/tss-plugins --path plugins/secaudit/skills
```

## Contributing

This repository is the development home for its plugins. Plugin content lives under
`plugins/<name>/`, its tests under `tests/<name>/`. Run the suite with:

```
for t in tests/*/*.test.mjs; do node "$t"; done
```

Releases: bump `version` in the plugin's `.claude-plugin/plugin.json` AND
`.codex-plugin/plugin.json` (must match), commit conventionally (`feat(secaudit): v0.2.0`).

## License

MIT — see [LICENSE](LICENSE).
