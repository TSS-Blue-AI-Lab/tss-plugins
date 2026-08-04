# JWT — Lifecycle Mapping (Recon)

Map how the application creates, transmits, and verifies JWTs. Identify every JWT issuance
and verification site, the library used, the signing algorithm and key/secret
configuration, and the claims that are used for authorization. Do not yet decide whether
any site is exploitable — that is the verify phase's job.

## What to search for

**1. JWT library imports** — identify which JWT library is in use:
- Python: `import jwt`, `from jose import`, `from authlib import`, `import python_jose`
- Node.js: `require('jsonwebtoken')`, `import jwt from 'jsonwebtoken'`, `jose`, `@nestjs/jwt`
- Java: `io.jsonwebtoken`, `com.auth0.jwt`, `nimbus-jose-jwt`
- Go: `github.com/golang-jwt/jwt`, `github.com/dgrijalva/jwt-go`, `github.com/lestrrat-go/jwx`
- Ruby: `jwt` gem (`require 'jwt'`)
- PHP: `firebase/php-jwt`, `lcobucci/jwt`
- C#: `System.IdentityModel.Tokens.Jwt`, `Microsoft.AspNetCore.Authentication.JwtBearer`

**2. JWT signing / issuance sites** — where tokens are created:
- `jwt.encode(...)`, `jwt.sign(...)`, `Jwts.builder().signWith(...)`, `JWT.create().sign(...)`
- Note the algorithm used (`HS256`, `RS256`, etc.) and where the secret/key comes from (env var, config, hardcoded)

**3. JWT verification / decoding sites** — where tokens are consumed:
- `jwt.decode(...)`, `jwt.verify(...)`, `Jwts.parserBuilder()...parseClaimsJws(...)`, `JWT::decode(...)`
- Note what options are passed: `algorithms`, `options`, `verify_signature`, `verify_exp`
- Note if it's a raw `decode` (no verification) vs. a `verify` call

**4. Token extraction** — where the token is read from the incoming request:
- Authorization header: `request.headers.get("Authorization")`, `req.headers['authorization']`
- Cookie: `request.cookies.get("token")`, `req.cookies.token`
- Query parameter: `request.args.get("token")`, `req.query.token`

**5. Authorization middleware / decorators** — centralized JWT checks:
- `@jwt_required`, `@login_required`, `requireAuth`, `JwtAuthGuard`, `[Authorize]`, middleware functions
- Note which routes are protected and which are unprotected

**6. Signing secret / key configuration**:
- Where the HMAC secret or RSA/EC key is defined and loaded (env var, config file, hardcoded string)
- Whether it looks strong (long random string) or weak (short, common word)

**7. Claim usage**:
- Which claims are extracted and used for authorization (`user_id`, `role`, `permissions`, `sub`)
- Whether `exp`, `iss`, `aud`, `nbf` are checked

## Recon output — record each site as

```markdown
# JWT Recon: [Project Name]

## Summary
JWT is [used / not used] in this codebase.
Library: [library name and version if visible]
Algorithm(s): [HS256 / RS256 / etc.]

## Issuance Sites

### 1. [Descriptive name — e.g., "Token generation in login endpoint"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Algorithm**: [e.g., HS256]
- **Secret/key source**: [env var name / hardcoded string / config key]
- **Claims set**: [list of claims added to the payload]
- **Code snippet**:
  ```
  [the signing call]
  ```

## Verification Sites

### 1. [Descriptive name — e.g., "Token verification in auth middleware"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / middleware**: [function name]
- **Verification call**: [jwt.decode / jwt.verify / parseClaimsJws / etc.]
- **Algorithm restriction**: [algorithms=["HS256"] / no restriction / unknown]
- **Signature verification**: [enabled / disabled / unclear]
- **Claims validated**: [exp / iss / aud / none / unknown]
- **Token source**: [Authorization header / cookie / query param]
- **kid/jwk/jku used**: [yes — describe how / no]
- **Code snippet**:
  ```
  [the verification call and surrounding context]
  ```

## Secret / Key Configuration
- **Secret source**: [env var / hardcoded / config file]
- **Apparent strength**: [strong (long random) / weak (short/common) / unknown]
- **Code snippet** (if hardcoded or suspicious):
  ```
  [relevant code]
  ```

## Authorization Middleware Coverage
- **Protected routes**: [list or description]
- **Unprotected routes**: [list or "none observed"]
```
