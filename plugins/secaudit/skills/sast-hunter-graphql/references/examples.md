# GraphQL — Concept, Examples, and Verify Heuristics

## What is GraphQL Injection

GraphQL injection occurs when user-controlled data is embedded into the **GraphQL document** (the query, mutation, or subscription string) rather than passed only through the **variables** map. The parser then interprets attacker-controlled syntax — new fields, aliases, directives, or fragments — which can bypass intent, reach unauthorized resolvers, or change server-side behavior when that document is executed or forwarded.

The core pattern: *unvalidated user input alters the structure or text of the GraphQL operation string passed to `execute`, `graphql`, a gateway client, or an HTTP body `query` field built from string operations.*

### What GraphQL Injection IS

- Concatenating or interpolating user input into an operation string: `` `query { user(id: "${id}") { name } }` ``, `"query { user(id: \"" + id + "\") { name } }"`
- Building the JSON `query` field for a downstream GraphQL HTTP request with string concat from request body or params
- Forwarding `req.body.query` (or similar) into another interpolated template that wraps or extends the operation
- Dynamic `gql` / `graphql-tag` template literals where a non-static expression changes document structure (not just a bound variable value inside a static document)
- Server-side code that selects or assembles operation text from user input (including "persisted query" ID → document maps without allowlisting)
- Wrappers around `graphql.execute()`, `graphqlHTTP`, Yoga/Apollo request pipeline where the first argument (document/source) is built from variables that could be user-influenced

### What GraphQL Injection is NOT

Do not flag these as GraphQL injection:

- **SQL injection in resolvers**: Resolver code that builds SQL from `args` — that is **SQL injection** (`sast-hunter-sqli`), not this skill
- **NoSQL / command injection in resolvers**: Same — use the appropriate SAST skill
- **IDOR via GraphQL arguments**: Passing another user's ID in a **variables** JSON with a **static** document — authorization flaw, not document injection
- **Normal variable binding**: Static document with `{"query": "query($id: ID!) { user(id: $id) { name } }", "variables": {"id": userInput}}` — values are bound as variables; the document structure is fixed (still verify authorization in resolvers)
- **Introspection / field suggestion enabled**: Information disclosure and hardening topic; only flag as GraphQL injection if the finding is specifically about **injecting into the operation string**
- **Query depth / complexity DoS**: Rate limiting and cost analysis — different class

### Patterns That Prevent GraphQL Injection

**1. Static operation documents with variables**

```javascript
const GET_USER = gql`
  query GetUser($id: ID!) {
    user(id: $id) { name }
  }
`;
// execute(schema, GET_USER, null, context, { id: userId });
```

**2. Server uses standard HTTP handler; client sends document; server parses once**

The risk is not the mere presence of `req.body.query` on the server if the server only parses and executes it as the client's operation — injection in *that* path is client-side. Flag **server-side** construction of a **new** document that incorporates user strings before `execute` or before forwarding.

**3. Persisted queries / allowlisted operation IDs**

Document looked up by ID from a server-side registry; client cannot inject arbitrary document text.

**4. graphql-js `Source` with static string; dynamic values only in variableValues**

```javascript
graphql({ schema, source: staticQueryString, variableValues: { id: userId } });
```

## Vulnerable vs. Secure Examples

### Node.js — dynamic document for downstream API

```javascript
// VULNERABLE: user input in operation text
app.post('/proxy', async (req, res) => {
  const fragment = req.body.fragment;
  const query = `query { me { ${fragment} } }`;
  const data = await fetch('https://api.internal/graphql', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
});

// SECURE: static operation, user data only in variables
const PROXY_QUERY = `query ProxyMe { me { id name email } }`;
app.post('/proxy', async (req, res) => {
  const data = await fetch('https://api.internal/graphql', {
    method: 'POST',
    body: JSON.stringify({ query: PROXY_QUERY }),
  });
});
```

### Python — string format into execute

```python
# VULNERABLE
def run_custom_query(user_gql: str):
    document = f"query {{ user {{ {user_gql} }} }}"
    return graphql_sync(schema, document)

# SECURE: validate against allowlist of named operations or use static documents only
ALLOWED = {"id", "name", "email"}
fields = [f for f in requested_fields if f in ALLOWED]
document = "query { user { " + " ".join(ALLOWED.intersection(set(requested_fields))) + " } }"
# Better: fixed FieldNodes, not string building from user input
```

## Verify heuristics (taint analysis)

**Goal**: For each injection candidate site, determine whether user-supplied data can reach
the dynamic part of the operation document.

**GraphQL injection reference — what to look for**:

User-controlled data must not alter the **GraphQL document text** (query/mutation/subscription source) except through bound **variables** on a static document. Flag when taint reaches string assembly of the operation.

**What GraphQL injection is NOT** — do not flag these here:
- **SQL/NoSQL injection in resolvers** — other SAST skills
- **IDOR with static document + variables** — authorization, not document injection
- **Normal variable binding** on a fixed document string
- **Introspection enabled** — unless the finding is specifically operation-string injection
- **Query depth/complexity DoS** — different class

**Mitigations that reduce risk**:
- Allowlist of fields or operation IDs before any string assembly
- Parser validation that rejects unexpected definitions (still prefer no user-controlled document structure)

**For each site, trace dynamic values backward**:

1. **Direct user input** — query params, path params, JSON body fields (including nested `query` if re-wrapped), headers, cookies
2. **Indirect user input** — helpers, middleware, context builders
3. **Second-order** — stored preferences or DB fields later used to build a document; trace write path
4. **Server-only** — config, env, hardcoded fragments — not exploitable from the client

**Confidence selection** (report every candidate as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User-controlled data reaches document construction with no effective mitigation.
- **Medium confidence**: Probable taint or weak sanitization; or an opaque flow you cannot fully resolve.
- **Low confidence**: Server-side-only or effective allowlist / static document path — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: ...
- **Issue**: ...
- **Taint trace**: ...
- **Impact**: [e.g., unauthorized fields, gateway bypass, SSRF-style behavior to internal GraphQL]
- **Remediation**: [static operations; variables only; persisted query allowlist]
- **Dynamic Test**:
  ```
  [curl or in-browser GraphQL request showing injected fragment/directive/field]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: ...
- **Endpoint / function**: ...
- **Issue**: ...
- **Taint trace**: ...
- **Concern**: ...
- **Remediation**: ...
- **Dynamic Test**:
  ```
  ...
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: ...
- **Endpoint / function**: ...
- **Reason**: ...

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: ...
- **Endpoint / function**: ...
- **Uncertainty**: ...
- **Suggestion**: ...
```

Resolver-layer SQL/NoSQL issues belong to other skills; this skill targets **operation document** construction.
