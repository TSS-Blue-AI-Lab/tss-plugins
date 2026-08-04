# GraphQL — Recon Sink Catalog

(1) Determine whether this codebase uses GraphQL at all. (2) If it does, find every location
where a GraphQL **operation document** (query/mutation/subscription source string) is built
using string concatenation, interpolation, formatting, or dynamic assembly such that a
variable could change the **document text** (not merely `variables` JSON).

## Part A — Is GraphQL used?

Search for:
- Dependencies: `graphql`, `@apollo/server`, `apollo-server-express`, `@nestjs/graphql`, `graphql-yoga`, `@graphql-yoga/node`, `mercurius`, `strawberry-graphql`, `graphene`, `sangria`, `gqlgen`, `async-graphql`, `juniper`, `graphql-ruby`, Hot Chocolate / `GraphQL.Server`, etc.
- Schema artifacts: `*.graphql`, `*.graphqls`, codegen config (e.g. GraphQL Code Generator)
- Server routes or plugins mounting `/graphql` or similar

Set the summary to exactly one of:
- `GraphQL is used in this codebase.` (list libraries and main entry points)
- `GraphQL is not used in this codebase.`

## Part B — Injection candidate sites (only if GraphQL is used)

If GraphQL is **not** used, omit the "Injection Candidate Sites" section or state there are none. Do not invent candidates.

If GraphQL **is** used, search for **unsafe document construction**:

1. **String concatenation / interpolation into operation text**:
   - `` `query { ... ${x} ...}` ``, `"mutation { " + userFragment + " }"`
   - `sprintf`, `format`, `%` formatting, `.format()` building `query` or `source` arguments

2. **Calls where the document argument is not a compile-time constant**:
   - `graphql(schema, dynamicString, ...)`, `execute({ schema, document: parsedDynamic, ...})` where the string feeding `parse` or `execute` is built from non-static parts
   - `graphqlHTTP({ schema, rootValue, context: (req) => ({ query: req.body.query + something }) })` patterns that **mutate** or **wrap** the query string with user data

3. **HTTP clients forwarding a constructed GraphQL body**:
   - `JSON.stringify({ query: `...${userPart}...` })`, `axios.post(url, { query: builtFromInput })`

4. **Unsafe persisted / stored query lookup**:
   - Operation text loaded by key from user input without allowlist → file path or DB value becomes document source

## What to skip (do not flag as candidates)

- Fully static `source` / `query` strings; only `variableValues` / `variables` come from the request
- Schema definition with `buildSchema` / SDL files with no user interpolation
- Resolver implementations that only use args with parameterized DB APIs (optional: note "resolver uses ORM" but not a GraphQL injection candidate unless the **document** is built unsafely)

## Recon output — record each candidate as

```markdown
# GraphQL Recon: [Project Name]

## Summary
GraphQL is [used / not used] in this codebase.
[If used: libraries, main server files, typical endpoint paths]
Found [N] injection candidate site(s) where operation documents may be built unsafely. [If not used, say N/A or 0 and skip candidate list]

## GraphQL Surface (only if used)
- **Libraries / frameworks**: ...
- **Entry points**: ...
- **Notable files**: ...

## Injection Candidate Sites

### 1. [Descriptive name]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: ...
- **Execution / call pattern**: [graphql.execute / fetch with body / gql template / etc.]
- **Construction pattern**: [concat / template literal / format / forwarded body mutation]
- **Interpolated variable(s)**: ...
- **Code snippet**:
  ```
  ...
  ```

[Repeat for each site; if none, write "No injection candidate sites found." under the heading]
```
