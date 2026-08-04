# JWT — Concept, Examples, and Verify Heuristics

## What is an Insecure JWT Implementation

JWTs consist of three Base64URL-encoded parts: `header.payload.signature`. The header declares the signing algorithm (`alg`), the payload carries claims (e.g., `sub`, `role`, `exp`), and the signature is a cryptographic proof of integrity. Vulnerabilities arise when the server trusts the token's own claims about how it was signed, fails to verify the signature at all, uses a guessable secret, or trusts attacker-controlled key material embedded in the token itself.

The core pattern: *the server does not fully verify the JWT's authenticity and integrity before trusting its claims.*

### What JWT Vulnerabilities ARE

**1. Algorithm confusion — `alg: none`**
The server accepts a JWT whose header declares `"alg": "none"`, bypassing signature verification entirely. An attacker crafts an arbitrary payload, sets `alg` to `none`, and omits the signature. If the library processes it, the forged token is accepted.

**2. Algorithm confusion — RS256 → HS256**
A server configured for RS256 (asymmetric: sign with private key, verify with public key) can be tricked into HS256 mode if the library allows the algorithm to be specified by the token. Since the public key is often retrievable, the attacker signs a forged token with HS256 using the server's public key as the HMAC secret. The server verifies the HMAC using the same public key and accepts the token.

**3. Missing or disabled signature verification**
The server decodes the JWT payload without actually verifying the signature. Common patterns:
- Python (PyJWT): `jwt.decode(token, options={"verify_signature": False})`
- Node.js (jsonwebtoken): `jwt.decode(token)` instead of `jwt.verify(token, secret)`
- Manual base64 decode of the payload with no signature check
- `algorithms=["none"]` accepted in the decode call

**4. Weak or hardcoded HMAC secret**
The server signs tokens with a short, guessable, or hardcoded secret (e.g., `"secret"`, `"password"`, `"changeme"`, `"jwt-secret-key"`). An attacker who captures a valid token can brute-force the secret offline with tools like `hashcat` or `jwt_tool`, then forge arbitrary tokens.

**5. Embedded JWK (`jwk` header injection)**
The token header contains an embedded JSON Web Key (`jwk` parameter). If the verification code trusts the embedded key to verify the token's own signature, an attacker generates their own key pair, signs a forged token with their private key, and embeds their public key in the header. The server verifies the signature using the attacker's embedded public key and accepts the token.

**6. JKU / X5U header injection**
The `jku` (JWK Set URL) or `x5u` (X.509 certificate URL) header value is used to fetch the verification key from a URL. If the server does not validate the URL against an allowlist, the attacker can point it to their own server hosting a crafted key set.

**7. Key ID (`kid`) header injection**
The `kid` header is used to look up the signing key, often from a database or the filesystem. If the `kid` value is interpolated into a SQL query without sanitization, it becomes an SQL injection vector. If it is concatenated into a file path, it becomes a path traversal vector.

**8. Missing claim validation**
- `exp` not checked → expired tokens remain valid forever
- `iss` (issuer) not checked → tokens issued by other services are accepted
- `aud` (audience) not checked → tokens intended for other services are accepted
- `nbf` (not-before) not checked → tokens used before their valid window

**9. No token revocation**
There is no token blacklist or revocation mechanism. Stolen or logged-out tokens remain valid until they expire. This matters most when token lifetimes are long.

### What JWT Vulnerabilities are NOT

Do not flag these as JWT vulnerabilities:

- **IDOR**: Changing a `user_id` claim to access another user's data is an authorization flaw, not a JWT forgery — only flag if the token itself can be forged
- **XSS via JWT payload**: Injecting `<script>` into a claim that is later rendered unescaped — that's XSS, not a JWT bug
- **CSRF**: JWT in cookies without `SameSite` — that's a CSRF concern, not a JWT integrity issue
- **Properly restricted verification**: `jwt.verify(token, secret, { algorithms: ['HS256'] })` with a strong secret — not vulnerable

### Patterns That Prevent JWT Vulnerabilities

**1. Algorithm allowlist in verification call**
```python
# Python — PyJWT: explicitly specify allowed algorithms
payload = jwt.decode(token, secret, algorithms=["HS256"])

# Node.js — jsonwebtoken: restrict algorithms
jwt.verify(token, secret, { algorithms: ['HS256'] })

# Java — jjwt: specify expected algorithm
Jwts.parserBuilder().setSigningKey(key).build().parseClaimsJws(token)
# (jjwt does not use the header's alg; it uses the key type)
```

**2. Strong, randomly generated secret**
```python
# Strong secret: at least 256 bits of entropy, not hardcoded
import secrets
SECRET_KEY = secrets.token_hex(32)  # load from env in production
```

**3. Full claim validation**
```python
payload = jwt.decode(
    token, secret, algorithms=["HS256"],
    options={"require": ["exp", "iss", "aud"]},
    issuer="https://myapp.example.com",
    audience="myapp-api"
)
```

**4. Asymmetric keys with no algorithm ambiguity**
```javascript
// Use RS256 with public key for verification; never accept HS256 on the same endpoint
jwt.verify(token, publicKey, { algorithms: ['RS256'] })
```

**5. JWK/JKU URL allowlist**
```python
# Only fetch keys from a known, trusted JWKS endpoint
ALLOWED_JWKS_URLS = {"https://accounts.google.com/.well-known/jwks.json"}
if jku not in ALLOWED_JWKS_URLS:
    raise ValueError("Untrusted JWK URL")
```

## Vulnerable vs. Secure Examples

### Python — PyJWT

```python
# VULNERABLE: signature verification disabled
def get_current_user(token: str):
    payload = jwt.decode(token, options={"verify_signature": False})
    return payload["user_id"]

# VULNERABLE: accepts alg:none because no algorithm restriction
def get_current_user(token: str):
    payload = jwt.decode(token, SECRET_KEY)  # PyJWT < 2.x default: accepts any alg
    return payload["user_id"]

# VULNERABLE: weak hardcoded secret
SECRET_KEY = "secret"
payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])

# SECURE: algorithm restricted, strong secret from env
SECRET_KEY = os.environ["JWT_SECRET"]  # strong, random, from environment
def get_current_user(token: str):
    payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    return payload["user_id"]
```

### Node.js — jsonwebtoken

```javascript
// VULNERABLE: jwt.decode() — no signature verification
function getUser(token) {
  const payload = jwt.decode(token);  // decode only, never verify
  return payload.userId;
}

// VULNERABLE: algorithms not restricted — susceptible to alg:none or RS256→HS256
function getUser(token) {
  const payload = jwt.verify(token, SECRET);  // no algorithms option
  return payload.userId;
}

// VULNERABLE: weak hardcoded secret
const SECRET = "password123";
jwt.verify(token, SECRET, { algorithms: ['HS256'] });

// SECURE: algorithm restricted, strong secret from env
const SECRET = process.env.JWT_SECRET;
function getUser(token) {
  const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  return payload.userId;
}
```

### Java — jjwt

```java
// VULNERABLE: deprecated parser (accepts alg from header)
Jwts.parser().setSigningKey(key).parseClaimsJws(token);

// VULNERABLE: no expiry check — the library default may not enforce exp
Claims claims = Jwts.parserBuilder()
    .setSigningKey(key).build()
    .parseClaimsJws(token).getBody();
// claims.getExpiration() never checked

// SECURE: parserBuilder (does not trust header alg; uses key type)
Claims claims = Jwts.parserBuilder()
    .requireIssuer("myapp")
    .requireAudience("myapp-api")
    .setSigningKey(key)
    .build()
    .parseClaimsJws(token)
    .getBody();
```

### Go — golang-jwt / dgrijalva/jwt-go

```go
// VULNERABLE: accepts any algorithm including "none"
token, _ := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
    return []byte(secret), nil  // no algorithm check
})

// VULNERABLE: weak secret
var jwtKey = []byte("secret")

// SECURE: validate signing method before returning key
token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
    if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
        return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
    }
    return jwtKey, nil
})
```

### kid header SQL injection

```python
# VULNERABLE: kid used in SQL query without sanitization
def get_signing_key(kid):
    result = db.execute(f"SELECT key FROM jwt_keys WHERE id = '{kid}'")
    return result.fetchone()[0]

token_header = jwt.get_unverified_header(token)
key = get_signing_key(token_header["kid"])  # attacker controls kid
jwt.decode(token, key, algorithms=["HS256"])

# SECURE: kid validated against allowlist or parameterized lookup
def get_signing_key(kid):
    result = db.execute("SELECT key FROM jwt_keys WHERE id = %s", (kid,))
    row = result.fetchone()
    if not row:
        raise ValueError("Unknown key id")
    return row[0]
```

### Embedded JWK injection

```javascript
// VULNERABLE: trusts the jwk embedded in the token header
const { publicKey } = getPublicKeyFromHeader(decoded.header);  // attacker-supplied
jwt.verify(token, publicKey);

// SECURE: only use keys from a pre-configured, trusted source
const trustedKey = loadKeyFromConfig();
jwt.verify(token, trustedKey, { algorithms: ['RS256'] });
```

## Verify heuristics (verification-site analysis)

For each JWT verification site found during lifecycle mapping, determine whether it is
exploitable. Check for algorithm confusion, missing signature verification, weak secrets,
header injection attacks, and missing claim validation.

**Check 1 — Algorithm restriction**
- Is the allowed algorithm explicitly specified in the verification call?
- If no algorithm restriction is present, can the token's `alg` header be set to `none` to skip signature verification?
- If the server uses an asymmetric algorithm (RS256, ES256), does the verification code also accept HMAC algorithms (HS256)? If so, the server may be vulnerable to the RS256→HS256 confusion attack.

**Check 2 — Signature verification enabled**
- Is the token passed through a verify/parse call that actually checks the signature, or only through a decode-only call?
- Look for options like `verify_signature: False`, `complete=False`, or the use of `jwt.decode()` (Node.js) instead of `jwt.verify()`
- Manual base64-decode of the payload without any signature check is always vulnerable

**Check 3 — HMAC secret strength**
- Is the secret hardcoded in source code? If so, is it a common word or short string?
- Is the secret loaded from an environment variable or config? Even then, note if the default or example value is weak
- A secret shorter than 32 characters or composed of dictionary words is likely brute-forceable

**Check 4 — Embedded JWK / JKU / X5U header injection**
- Does the verification code read the `jwk` field from the token header and use it to verify the same token?
- Does the code fetch a key from a URL specified in the `jku` or `x5u` header without validating the URL against an allowlist?
- If either is true, the verification is fully bypassable

**Check 5 — `kid` header injection**
- Is the `kid` header value extracted from the token before verification and used to look up a key?
- Is the `kid` value interpolated into a SQL query without parameterization? → SQL injection
- Is the `kid` value used to construct a file path without sanitization? → path traversal / key substitution

**Check 6 — Claim validation**
- Is `exp` (expiry) checked? If not, expired tokens are valid forever
- Is `iss` (issuer) checked? If not, tokens from other issuers are accepted
- Is `aud` (audience) checked? If not, tokens for other services are accepted
- Are security-sensitive claims like `role` or `permissions` present but not validated against a server-side source?

**Check 7 — Token revocation**
- Is there a token blacklist, revocation endpoint, or short-lived token + refresh-token pattern?
- If tokens are long-lived (hours or more) with no revocation mechanism, stolen tokens remain valid

**Confidence selection** (report every verification-site check as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: The weakness is clearly present with no effective mitigation — the attack path is directly exploitable.
- **Medium confidence**: The weakness is probably present but requires confirming a secondary condition (e.g., library version behavior, default option value); or you cannot determine the vulnerability status with confidence from static analysis alone.
- **Low confidence**: The implementation correctly addresses this check — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Vulnerability class**: [e.g., "Missing signature verification" / "alg:none accepted" / "Weak HMAC secret" / "JWK header injection" / "kid SQL injection" / "Missing exp validation"]
- **Issue**: [Clear description of what is wrong]
- **Attack scenario**: [Step-by-step: what the attacker does, what token they craft or modify, what access they gain]
- **Impact**: [What an attacker can achieve — forge arbitrary identity, escalate privileges, access other users' data, etc.]
- **Remediation**: [Specific fix — add algorithms restriction, enable verify_signature, load secret from env, pin JWKS URL, parameterize kid lookup, add exp validation, etc.]
- **Dynamic Test**:
  ```
  [Proof-of-concept using jwt_tool, hashcat, or curl.
   Show the exact command to reproduce the issue.
   Examples:
   - jwt_tool <token> -X a   (test alg:none)
   - jwt_tool <token> -X s   (test RS256→HS256 confusion)
   - hashcat -a 0 -m 16500 <token> wordlist.txt   (brute-force HMAC secret)
   - Manual: modify payload, set alg:none, send to endpoint]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Vulnerability class**: [class]
- **Issue**: [What appears to be wrong]
- **Uncertainty**: [What needs to be confirmed — e.g., "Library version determines default behavior"]
- **Remediation**: [Fix]
- **Dynamic Test**:
  ```
  [payload or command to attempt exploitation]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "Algorithm restricted to HS256 with strong env-loaded secret; exp validated"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [Why the vulnerability status cannot be determined statically]
- **Suggestion**: [What to inspect manually — e.g., "Confirm what JWT library version is installed; older versions of PyJWT accept alg:none by default"]
```

The most critical checks are: signature verification disabled, algorithm not restricted (alg:none / RS256→HS256 confusion), and weak or hardcoded HMAC secret. These lead directly to full authentication bypass.

`jwt.decode()` in Node.js's `jsonwebtoken` library is a decode-only function — it never verifies the signature. Only `jwt.verify()` validates the signature. Confusing the two is a common and critical mistake.

In Python's PyJWT, versions before 2.0 accepted `alg: none` by default and did not require an `algorithms` parameter. If the codebase does not pin the version or restrict algorithms, flag it.

Algorithm confusion (RS256→HS256) requires: (a) the server uses RS256 with a key pair, (b) the public key is accessible, and (c) the verification code does not restrict the algorithm. All three must be present.

`kid` injection is often overlooked: always check how the key lookup is implemented when `kid` is present in the token header.

When in doubt, record it as a `[FINDING]` with `**Confidence:** low` — never drop it; downstream Challenge/Trace decide. False negatives are worse than false positives in security assessment.
