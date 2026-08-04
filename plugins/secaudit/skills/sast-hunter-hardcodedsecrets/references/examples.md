# Hardcoded Secrets — Concept, Types, and Verify Heuristics

## What Are Hardcoded Secrets in Public Code

Hardcoded secrets are sensitive credentials — API keys, access tokens, private keys, passwords, signing secrets, database connection strings — embedded directly in source code as string literals.

This skill focuses specifically on secrets that end up in **publicly accessible code**, meaning an attacker can extract them **without any server-side access**. A secret hardcoded in backend server code is bad practice but not directly exploitable by an external attacker inspecting the deployed application. A secret hardcoded in frontend JavaScript or a mobile app binary **is** directly extractable.

The core question: *Can an external attacker obtain this secret from the deployed application without server access?*

### What to Report (Publicly Accessible Code)

These code paths are accessible to attackers after deployment:

- **Frontend JavaScript/TypeScript** — any `.js`, `.ts`, `.jsx`, `.tsx` file that runs in the browser. This includes:
  - React, Angular, Vue, Svelte components and pages
  - Next.js client components (files with `"use client"` or files under `app/` without `"use server"`)
  - Nuxt.js pages and client plugins
  - Vanilla JS in `public/`, `static/`, or `assets/` directories
  - Webpack/Vite/Rollup entry points and their imported modules
  - Any file imported by a client-side entry point (even if it lives in a `utils/` or `lib/` folder)
- **Mobile application code** — extractable via reverse engineering (decompiling APK, inspecting IPA):
  - Android: Java/Kotlin source files
  - iOS: Swift/Objective-C source files
  - React Native: JavaScript bundles
  - Flutter: Dart source files
  - Xamarin: C# source files
- **HTML files and templates served to clients** — inline `<script>` blocks, `data-` attributes, meta tags
- **Client-side configuration files** — files in `public/`, `static/`, `assets/`, `www/` directories
- **Electron/desktop app source** — extractable from ASAR archives
- **WebAssembly source/companion JS** — secrets in JS glue code or extractable from WASM

### What NOT to Report (Backend-Only Code)

Do not flag secrets in these locations — they are not publicly accessible:

- **Server-side application code** — Express route handlers (server-only), Django views, Flask routes, Spring controllers, Rails controllers, Go HTTP handlers, PHP controllers — code that runs exclusively on the server
- **Server-side API route files** — Next.js `app/api/` routes, Nuxt server routes, SvelteKit `+server.ts` files
- **Environment files** — `.env`, `.env.local`, `.env.production` (unless served statically)
- **Server-side configuration** — `config/database.yml`, `settings.py`, `application.properties`, `appsettings.json`
- **CI/CD pipeline files** — `.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`
- **Docker/infrastructure files** — `Dockerfile`, `docker-compose.yml`, Kubernetes manifests
- **Backend utility/service files** — files that are only imported by server-side code
- **Test files** — test fixtures and test configuration (unless the test files are shipped to the client)
- **Migration files** — database migrations

### Distinguishing Frontend from Backend

This is critical and requires understanding the project architecture:

**Next.js**: Files under `app/` with `"use client"` directive or without `"use server"` are client components. Files under `app/api/` are server-only. Files under `pages/api/` are server-only. Files under `pages/` (non-api) render on both server and client — secrets here ARE exposed. `next.config.js` runs server-side only but `NEXT_PUBLIC_*` env vars are embedded in client bundles.

**Nuxt.js**: Files under `pages/`, `components/`, `composables/` are client-accessible. Files under `server/` are server-only.

**React (CRA/Vite)**: Everything in `src/` is bundled for the client. `REACT_APP_*` and `VITE_*` env vars are embedded in client builds.

**Angular**: Everything in `src/` is bundled for the client.

**Vue (Vite)**: Everything in `src/` is bundled for the client. `VITE_*` env vars are embedded.

**Express/Fastify/Koa**: All server-side unless serving static files from a `public/` or `static/` directory.

**Django/Flask**: Python code is server-side. Templates are rendered server-side (secrets in template context don't reach the client unless explicitly rendered into JS). Static files in `static/` are client-accessible.

**Rails**: Ruby code is server-side. Assets in `app/assets/javascripts/` or `app/javascript/` are client-accessible.

**Mobile apps**: ALL source code is considered publicly accessible via reverse engineering.

## Types of Secrets to Look For

### High-Confidence Patterns (Regex-Identifiable)

These have distinctive formats that make them identifiable with high confidence:

| Secret Type | Pattern |
|---|---|
| AWS Access Key ID | `AKIA[0-9A-Z]{16}` |
| AWS Secret Access Key | 40-character base64 string near an `AKIA` key |
| Google API Key | `AIza[0-9A-Za-z\\-_]{35}` |
| Google OAuth Client Secret | `GOCSPX-[0-9A-Za-z\\-_]{28}` |
| GitHub Personal Access Token | `ghp_[0-9A-Za-z]{36}`, `github_pat_[0-9A-Za-z_]{82}` |
| GitHub OAuth App Secret | `gho_[0-9A-Za-z]{36}` |
| GitLab Personal Access Token | `glpat-[0-9A-Za-z\\-_]{20}` |
| Slack Bot/User Token | `xoxb-[0-9A-Za-z\\-]+`, `xoxp-[0-9A-Za-z\\-]+` |
| Slack Webhook URL | `hooks.slack.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+` |
| Stripe Secret Key | `sk_live_[0-9A-Za-z]{24,}` |
| Stripe Publishable Key | `pk_live_[0-9A-Za-z]{24,}` (publishable keys are designed for client-side — skip unless paired with a secret key) |
| Twilio Account SID + Auth Token | `AC[0-9a-f]{32}` (SID), 32-hex auth token nearby |
| SendGrid API Key | `SG\.[0-9A-Za-z\\-_]{22}\.[0-9A-Za-z\\-_]{43}` |
| Mailgun API Key | `key-[0-9a-zA-Z]{32}` |
| Firebase Config | `apiKey`, `authDomain`, `projectId` together in a config object — only flag if it includes a server/admin key, not the standard client config |
| Private RSA/EC/SSH Key | `-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----` |
| JWT Secret / Signing Key | String assigned to variables like `JWT_SECRET`, `jwt_secret`, `signingKey`, `HMAC_KEY` |
| Database Connection String with Password | `postgresql://user:pass@`, `mysql://user:pass@`, `mongodb://user:pass@`, `redis://:pass@` |
| Generic API Key Assignment | Variable named `*api_key*`, `*apiKey*`, `*API_KEY*`, `*secret*`, `*SECRET*`, `*token*`, `*TOKEN*`, `*password*`, `*PASSWORD*` assigned a string literal that looks like a real credential |
| Heroku API Key | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` in a Heroku context |
| Azure Storage Key | Base64 string ~88 chars assigned to storage account key variables |
| OpenAI API Key | `sk-[A-Za-z0-9]{48}` or `sk-proj-[A-Za-z0-9\\-_]{100,}` |
| Anthropic API Key | `sk-ant-[A-Za-z0-9\\-_]{90,}` |

### Variable Name Patterns (Require Value Inspection)

Search for variables/constants with these name patterns and check if the assigned value looks like a real credential:

- `api_key`, `apiKey`, `API_KEY`, `ApiKey`
- `secret`, `SECRET`, `secret_key`, `secretKey`, `SECRET_KEY`
- `access_token`, `accessToken`, `ACCESS_TOKEN`
- `auth_token`, `authToken`, `AUTH_TOKEN`
- `private_key`, `privateKey`, `PRIVATE_KEY`
- `password`, `PASSWORD`, `passwd`, `PASSWD`
- `client_secret`, `clientSecret`, `CLIENT_SECRET`
- `signing_key`, `signingKey`, `SIGNING_KEY`
- `encryption_key`, `encryptionKey`, `ENCRYPTION_KEY`
- `bearer_token`, `BEARER_TOKEN`
- `credentials`, `CREDENTIALS`
- `connection_string`, `connectionString`, `DATABASE_URL`

### What is NOT a Real Secret (False Positives to Ignore)

- **Placeholder values**: `"your-api-key-here"`, `"TODO"`, `"xxx"`, `"changeme"`, `"REPLACE_ME"`, `"INSERT_KEY"`, `"<api_key>"`, `"dummy"`, `"test"`, `"example"`, `"sample"`, `"placeholder"`
- **Empty strings**: `""`, `''`
- **Environment variable references**: `process.env.API_KEY`, `os.environ["SECRET"]`, `ENV["KEY"]` — these read from the environment at runtime, not hardcoded
- **Public keys**: Public keys (not private) are designed to be shared — not a secret
- **Publishable/public API keys**: Stripe `pk_test_*`, `pk_live_*`; Firebase client config `apiKey` (designed for client-side use); Google Maps client key (restricted by HTTP referrer)
- **Test/development keys**: `sk_test_*` (Stripe test), keys in files clearly named as test fixtures
- **Type definitions / interfaces**: TypeScript `interface Config { apiKey: string }` — no actual value
- **Documentation strings**: Comments explaining what a key looks like
- **Hash values**: SHA256/MD5 hashes that are not secrets (e.g., content hashes, checksums)
- **Build-time constants**: Version strings, build IDs, commit hashes

## Verify heuristics (public-accessibility and secret confirmation)

**Goal**: For each candidate, determine (1) whether it is a real secret and (2) whether it
is in publicly accessible code.

**Question 1: Is this a real secret?**

Check whether the value is an actual credential vs. a false positive:
- Does the string have the entropy and format of a real key/token? (Real API keys are typically 20+ random characters)
- Is it a known placeholder or example value? ("your-key-here", "changeme", "test", "example", "TODO", "xxx", "REPLACE_ME", etc.)
- Is it a test/development key? (Stripe `sk_test_*`, sandbox credentials, keys in test fixtures)
- Is it a public/publishable key by design? (Stripe `pk_live_*`, Firebase client `apiKey`, Google Maps browser key)
- Is it actually an environment variable reference that got picked up by mistake?
- Is it a hash, checksum, or non-secret identifier?

If the value is NOT a real secret, record it as a `[FINDING]` with `**Confidence:** low` and explain why.

**Question 2: Is this in publicly accessible code?**

Determine whether an external attacker can extract this secret from the deployed application:

**PUBLICLY ACCESSIBLE (report these):**
- Frontend JavaScript/TypeScript that runs in the browser (React, Angular, Vue, Svelte components/pages)
- Next.js client components (files with `"use client"` or client-rendered pages)
- Nuxt.js `pages/`, `components/`, client-side `plugins/`
- Any `.js`/`.ts` file that is imported by a client-side entry point (trace the import chain)
- Files in `public/`, `static/`, `assets/`, `www/` directories that are served directly
- HTML files with inline `<script>` blocks
- Mobile app source code — Android (Java/Kotlin), iOS (Swift/Objective-C), React Native JS, Flutter Dart, Xamarin C# — ALL mobile code is extractable via reverse engineering
- Electron app source (extractable from ASAR)
- Client-side configuration objects embedded in JavaScript (e.g., Firebase config, analytics init)

**NOT PUBLICLY ACCESSIBLE (do not report):**
- Server-side route handlers (Express, Django, Flask, Rails, Spring, Go, PHP controllers)
- Server-side API routes (Next.js `app/api/`, Nuxt `server/`, SvelteKit `+server.ts`)
- Backend services, middleware, utilities only imported by server code
- `.env` files, server config files, Docker/CI files
- Test files and fixtures not shipped to clients
- Database migrations
- Build scripts and tooling

**How to determine if a file is client-side:**
1. Check the file path — is it under a client-side directory? (`src/` in CRA/Vite React, `pages/` in Next.js, `app/` in Angular, `src/` in Vue)
2. Trace the import chain — is this file imported (directly or transitively) by a client-side entry point?
3. Check for server-only markers — `"use server"` directive, file under `api/` or `server/` directories
4. Check `sast/architecture.md` for the project's frontend/backend separation pattern
5. For ambiguous cases (e.g., shared utility files), err on the side of caution — if it COULD be bundled for the client, treat it as publicly accessible

If the secret is NOT in publicly accessible code, record it as a `[FINDING]` with `**Confidence:** low` and explain why (e.g., "Server-side only — Express route handler").

**Confidence selection** (report every candidate secret as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: Confirmed real secret in confirmed publicly accessible code. An attacker can extract this from the deployed application.
- **Medium confidence**: Appears to be a real secret and the file is likely client-accessible, but cannot fully confirm one or both conditions (e.g., ambiguous import chain, uncertain if the value is a real production key); or you cannot determine if the value is a real secret or if the file reaches the client.
- **Low confidence**: Either not a real secret (placeholder, test key, public key) OR not in publicly accessible code (backend-only) — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Secret type**: [AWS key / Google API key / etc.]
- **Exposure path**: [How an attacker extracts it — e.g., "Bundled into client JS via Webpack, visible in browser DevTools Sources tab" or "Embedded in Android APK, extractable via `apktool d app.apk`"]
- **Issue**: [Clear description — e.g., "AWS access key hardcoded in React component that is bundled for the browser"]
- **Impact**: [What an attacker can do with this secret — e.g., "Full access to AWS S3 buckets, potential data exfiltration", "Send emails via SendGrid on behalf of the organization", "Access user data via the API"]
- **Evidence**:
  ```
  [Code snippet with the secret value partially redacted]
  ```
- **Remediation**: [Move the secret to a server-side environment variable. If the client needs to call this API, proxy through your backend. For mobile apps, use a backend proxy or OAuth flow instead of embedding keys.]
- **Verification Steps**:
  ```
  [How to confirm this finding:
   - For web apps: "Open browser DevTools > Sources > search for 'AKIA' in bundled JS files"
   - For mobile apps: "Run `apktool d app.apk` and grep for the key pattern"
   - For Electron: "Extract ASAR archive and search for the key"]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Secret type**: [type]
- **Exposure path**: [Best guess at how it reaches the client]
- **Issue**: [What's uncertain]
- **Concern**: [Why it's still a risk]
- **Evidence**:
  ```
  [Code snippet]
  ```
- **Remediation**: [Fix recommendation]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Reason**: [e.g., "Placeholder value — 'your-api-key-here'" or "Server-side only — Django view, never reaches the client" or "Stripe publishable key — designed for client use"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Uncertainty**: [Why automated analysis couldn't determine the status]
- **Suggestion**: [What to check manually]
```

**Trace the import chain when uncertain**: A file at `src/utils/config.ts` might be imported by both server and client code. Check who imports it. If ANY client-side code path imports it, the secrets are exposed.

**Mobile apps are always public**: All source code in Android, iOS, React Native, Flutter, and Xamarin apps should be treated as extractable. APKs can be decompiled with `apktool`/`jadx`, IPAs can be inspected, JS bundles in React Native are plaintext.

**Firebase client config is generally NOT a secret**: The standard Firebase client config (`apiKey`, `authDomain`, `projectId`, etc.) is designed for client-side use and protected by Firebase Security Rules. Only flag Firebase **admin/service account** keys or **server keys** (e.g., `FIREBASE_ADMIN_SDK`, service account JSON with `private_key`).

**Stripe publishable keys are NOT secrets**: `pk_live_*` and `pk_test_*` are designed for client-side use. Only flag `sk_live_*` and `sk_test_*` (secret keys).

**`NEXT_PUBLIC_*`, `REACT_APP_*`, `VITE_*` env vars**: These are embedded into client bundles at build time. If the code references `process.env.NEXT_PUBLIC_API_KEY`, that IS client-accessible — but the actual hardcoded value would be in the `.env` file, which is typically gitignored. Only flag if the actual secret value is hardcoded in source code, not if it's read from an env var.

**Redact secrets in output**: When showing code snippets, always partially redact the secret value (e.g., `AKIA****WXYZ`, `sk_live_****abcd`). Never write the full secret value in the results file.
