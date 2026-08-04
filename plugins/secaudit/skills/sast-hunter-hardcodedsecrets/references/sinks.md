# Hardcoded Secrets — Recon Sink Catalog

Find every location in the codebase where a hardcoded secret (API key, access token,
private key, password, signing secret, connection string) appears as a string literal.

Scan the entire codebase. At this stage, flag ALL potential secrets regardless of whether
they are in frontend or backend code — the filtering happens in the verify phase.

## What to search for

1. **High-confidence regex patterns** — search for these distinctive formats:
   - AWS keys: `AKIA[0-9A-Z]{16}`
   - Google API keys: `AIza[0-9A-Za-z\-_]{35}`
   - GitHub tokens: `ghp_`, `github_pat_`, `gho_`, `ghs_`
   - Slack tokens: `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`
   - Stripe secret keys: `sk_live_`, `sk_test_`
   - SendGrid keys: `SG\.`
   - OpenAI keys: `sk-` followed by 48+ alphanumeric characters
   - Anthropic keys: `sk-ant-`
   - Private key headers: `-----BEGIN.*PRIVATE KEY-----`
   - Connection strings with embedded passwords: `://[^:]+:[^@]+@`

2. **Variable assignment patterns** — search for variables with secret-related names assigned string literal values:
   - Search for patterns like: `apiKey = "..."`, `api_key = '...'`, `API_KEY: "..."`, `secret: "..."`, `token = "..."`, `password = "..."`, `client_secret = "..."`
   - Include all casing conventions: camelCase, snake_case, SCREAMING_SNAKE_CASE, PascalCase
   - Look in JS/TS objects, JSON files, YAML/TOML config, Python dicts, environment-like configs

3. **Inline string literals** that match known key formats:
   - Long random alphanumeric strings (32+ characters) assigned to auth-related variables
   - Base64-encoded strings in authentication contexts
   - Hex strings (64+ characters) used as keys or secrets
   - UUIDs used as API keys or secrets

## What to skip during recon

- Environment variable reads: `process.env.*`, `os.environ[*]`, `ENV[*]`, `System.getenv(*)` — these are not hardcoded
- Type definitions with no values: `apiKey: string`, `type Config = { secret: string }`
- Obvious placeholders: `"your-key-here"`, `"TODO"`, `"xxx"`, `"changeme"`, `"REPLACE_ME"`, `"<api_key>"`, `"dummy"`, `"test-key"`, `"example"`, `"sample"`, empty strings
- Comments that merely describe or document secrets
- Public keys (non-private cryptographic keys)
- Hash values used as checksums or content identifiers
- Files in `.git/`, `node_modules/`, `vendor/`, `venv/`, `__pycache__/`, `dist/`, `build/` directories

## Recon output — record each candidate as

```markdown
# Hardcoded Secrets Recon: [Project Name]

## Summary
Found [N] potential hardcoded secret candidates.

## Candidates

### 1. [Descriptive name — e.g., "AWS Access Key in API config"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Secret type**: [AWS key / Google API key / Generic API key / Private key / Password / JWT secret / Connection string / etc.]
- **Variable/context**: [variable name or context where the secret appears]
- **Detection method**: [regex match / variable name pattern / inline literal]
- **Code snippet**:
  ```
  [Show the line(s) containing the secret — REDACT the middle portion of the actual value, e.g., "AKIA****EXAMPLE" or "sk_live_****abcd"]
  ```

[Repeat for each candidate]
```
