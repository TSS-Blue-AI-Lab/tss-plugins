# Missing Auth — Recon Catalog

Build a complete map of (1) all application endpoints/routes and their current
authentication/authorization posture, and (2) the role/permission system. Flag any
sensitive or privileged endpoint; do not yet decide whether it is exploitable (that is the
verify phase's job).

## What to search for

1. **All route/endpoint definitions** — collect every HTTP handler, REST endpoint, GraphQL mutation/query, RPC method, or WebSocket handler:
   - Express/Koa: `router.get/post/put/delete/patch/use`
   - Django: `urlpatterns`, `path()`, `re_path()`
   - Flask: `@app.route`, `@blueprint.route`
   - Rails: `routes.rb` — `get`, `post`, `resources`, `namespace`
   - Spring: `@GetMapping`, `@PostMapping`, `@RequestMapping`, `@DeleteMapping`, `@PutMapping`
   - Go/Chi: `r.Get`, `r.Post`, `r.Delete`, `r.Handle`
   - Laravel: `Route::get/post/put/delete`
   - FastAPI: `@router.get/post/put/delete`
   - ASP.NET: `[HttpGet]`, `[HttpPost]`, `[HttpDelete]`, `[HttpPut]`

2. **Authentication middleware and decorators** currently applied:
   - Identify the pattern used: `@login_required`, `auth` middleware, `[Authorize]`, `authenticate_user!`, JWT verification middleware, session checks
   - Note which routes or route groups they are applied to
   - Note any routes explicitly excluded from auth (e.g., `except: [:index, :show]`)

3. **Role/permission system** — identify how roles are defined and checked:
   - Role constants/enums: `ROLE_ADMIN`, `'admin'`, `UserRole.ADMIN`, `is_staff`, `is_superuser`
   - Permission decorators: `@admin_required`, `@roles_required`, `@PreAuthorize`, `requireRole()`
   - Middleware: `AdminOnly`, `requireAdmin`, `role:admin`
   - Policy/Gate/Ability objects: `Gate::define`, `Policy`, `CanCanCan`, `Pundit`
   - In-handler checks: `if user.role != 'admin'`, `if not current_user.is_admin`

4. **Sensitive/privileged endpoints** to flag — any endpoint that:
   - Has an `/admin`, `/management`, `/internal`, `/api/admin`, `/superadmin`, `/system`, `/ops` path prefix
   - Performs user management: create/update/delete users, change roles, reset passwords for others
   - Manages application configuration: settings, feature flags, SMTP, secrets, environment variables
   - Accesses financial/billing data: invoices, payments, subscriptions for all users
   - Triggers system actions: sending emails to all users, running background jobs, clearing caches
   - Returns aggregate or sensitive data: all users, all orders, audit logs, error logs

5. **For each endpoint, note**:
   - Whether an auth middleware/decorator is present
   - Whether a role/permission check is present
   - The HTTP method(s) it handles
   - Whether it reads, writes, or deletes data

## What to ignore

- Publicly intended endpoints: login, register, password reset request, public content (blog posts, product listings)
- Static asset serving, health-check endpoints (`/health`, `/ping`, `/status`)

## Recon output — record each endpoint as

```markdown
# Missing Auth Recon: [Project Name]

## Permission System Summary
- Roles identified: [list roles, e.g. admin, moderator, user]
- Auth mechanism: [JWT / session / API key / OAuth]
- Auth decorators/middleware: [list names, e.g. @login_required, auth, requireAdmin]

## Endpoint Inventory

### 1. [Endpoint name / description]
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Operation**: [read / write / delete / admin-action]
- **Auth present**: [yes / no]
- **Role check present**: [yes / no / partial]
- **Code snippet**:
  ```
  [route registration + handler signature]
  ```

[Repeat for each endpoint]
```
