# IDOR — Recon Candidate Catalog

Find every endpoint, controller action, or handler that retrieves, modifies, or deletes a
specific object using a user-supplied identifier. Flag any such site; do not yet decide
whether an authorization check is present (that is the verify phase's job).

## What to search for

1. **Route definitions** that contain ID parameters:
   - Path parameters: `:id`, `{id}`, `<int:id>`, `[id]`
   - Search patterns: route/path/endpoint definitions with parameter placeholders

2. **Controller/handler methods** that accept ID arguments and use them to fetch or mutate objects:
   - ORM lookups: `find(id)`, `findById()`, `get(id=)`, `objects.get()`, `findOne()`, `findUnique()`, `findFirst()`, `query.get()`, `where(id:)`
   - Raw queries: `SELECT ... WHERE id = ?`, etc.
   - Also look for delete, update operations with user-supplied IDs

3. **Request body or query parameter IDs** used in operations:
   - `req.body.userId`, `req.query.id`, `request.data['account_id']`, etc.

4. **GraphQL resolvers and mutations** that accept ID arguments

5. **File/resource access by user-supplied path or filename**

## What to skip (safe — do not flag)

- Endpoints that are intentionally public (no auth required by design)
- Admin-only endpoints behind role-based checks (these are a different class)
- Endpoints where the only ID used is the authenticated user's own ID (e.g., `GET /api/me/profile`)
- Static asset serving

## Recon output — record each candidate as

```markdown
# IDOR Recon: [Project Name]

## Summary
Found [N] candidate endpoints that use user-supplied identifiers to access objects.

## Candidates

### 1. [Descriptive name]
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path/:param`
- **Identifier source**: [path param / query param / body field]
- **Operation**: [read / update / delete]
- **Object accessed**: [model/table name]
- **Code snippet**:
  ```
  [relevant code]
  ```

[Repeat for each candidate]
```
