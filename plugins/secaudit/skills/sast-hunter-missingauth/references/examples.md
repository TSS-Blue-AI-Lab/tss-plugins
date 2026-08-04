# Missing Auth — Concept, Examples, and Verify Heuristics

## What This Skill Covers

### Missing Authentication
An endpoint performs a sensitive action but requires **no login at all** — any anonymous HTTP request can trigger it.

### Broken Function-Level Authorization
An endpoint requires authentication (user must be logged in) but **does not check whether the authenticated user has the required role or permission** to invoke that function. The classic example: a regular user calling an admin-only API.

### What This Skill Is NOT

Do not conflate with:
- **IDOR / Horizontal privilege escalation**: Authenticated user A accessing user B's resource by changing an ID. This skill covers **vertical** privilege escalation and unauthenticated access.
- **JWT weaknesses**: Flawed token signing/verification (covered by sast-hunter-jwt).
- **Business logic flaws**: Price manipulation, workflow bypass — these are separate.

## Vulnerability Classes

### Class 1: Unauthenticated Sensitive Endpoint
The endpoint modifies data, returns private information, or performs an administrative action — with no authentication required.

```
GET /api/admin/users          → returns full user list, no token needed
DELETE /api/admin/users/5     → deletes a user, no token needed
POST /api/settings/smtp       → updates server config, no token needed
```

### Class 2: Authenticated but Missing Role Check
The endpoint requires a valid session/token but performs no role or permission check. Any authenticated user — regardless of role — can invoke admin or privileged functions.

```
Regular user sends:
DELETE /api/admin/users/5
Authorization: Bearer <regular_user_token>
→ Server deletes the user without checking if the caller is an admin
```

### Class 3: Incomplete or Bypassable Authorization
Authorization logic is present but can be bypassed:
- Role check exists in the GET handler but not in the corresponding DELETE/POST handler
- Role check is conditional on a request header or parameter the attacker controls
- Middleware is registered but the route is mounted before the middleware applies

## Authorization Patterns That PREVENT Vulnerabilities

When you see these patterns, the endpoint is likely **not vulnerable**:

**1. Authentication + role-check middleware on a route group**
```javascript
// Express: all /admin routes protected
router.use('/admin', auth, requireRole('admin'));
router.delete('/admin/users/:id', deleteUser);   // protected by above

// Flask-Login + custom decorator
@app.route('/admin/users')
@login_required
@admin_required
def list_users(): ...
```

**2. Declarative role annotations (Java / Spring)**
```java
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/api/admin/users/{id}")
public ResponseEntity<?> deleteUser(@PathVariable Long id) { ... }
```

**3. In-handler role check before sensitive action**
```python
# Django
@login_required
def delete_user(request, user_id):
    if not request.user.is_staff:
        return HttpResponseForbidden()
    User.objects.filter(id=user_id).delete()
    return HttpResponse(status=204)
```

**4. Middleware gate applied to entire prefix**
```go
// Chi router — admin group protected
r.Group(func(r chi.Router) {
    r.Use(AdminOnly)
    r.Delete("/admin/users/{id}", deleteUser)
})
```

**5. Policy/Gate objects**
```php
// Laravel Gate
Gate::define('admin-action', fn($user) => $user->role === 'admin');
// In controller
$this->authorize('admin-action');
```

## Vulnerable vs. Secure Examples

### Python — Django

```python
# VULNERABLE: No authentication at all
def list_all_users(request):
    users = User.objects.values('id', 'email', 'is_staff')
    return JsonResponse(list(users), safe=False)

# VULNERABLE: Authenticated but no role check
@login_required
def delete_user(request, user_id):
    User.objects.filter(id=user_id).delete()
    return HttpResponse(status=204)

# SECURE
@login_required
def delete_user(request, user_id):
    if not request.user.is_staff:
        return HttpResponseForbidden()
    User.objects.filter(id=user_id).delete()
    return HttpResponse(status=204)
```

### Python — Flask

```python
# VULNERABLE: No auth decorator
@app.route('/admin/users')
def list_users():
    return jsonify([u.to_dict() for u in User.query.all()])

# VULNERABLE: Login required but no role check
@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    return '', 204

# SECURE
@app.route('/admin/users/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    if current_user.role != 'admin':
        abort(403)
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    return '', 204
```

### Node.js — Express

```javascript
// VULNERABLE: No auth middleware
router.get('/api/admin/users', async (req, res) => {
    const users = await User.find({});
    res.json(users);
});

// VULNERABLE: Auth middleware present but no role check
router.delete('/api/admin/users/:id', auth, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
});

// SECURE
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    next();
};
router.delete('/api/admin/users/:id', auth, requireAdmin, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
});
```

### Ruby on Rails

```ruby
# VULNERABLE: No before_action
def destroy
    User.find(params[:id]).destroy
    head :no_content
end

# VULNERABLE: Authenticated but no admin check
before_action :authenticate_user!
def destroy
    User.find(params[:id]).destroy
    head :no_content
end

# SECURE
before_action :authenticate_user!
before_action :require_admin

def destroy
    User.find(params[:id]).destroy
    head :no_content
end

private

def require_admin
    head :forbidden unless current_user.admin?
end
```

### Java — Spring Boot

```java
// VULNERABLE: No security annotation
@DeleteMapping("/api/admin/users/{id}")
public ResponseEntity<?> deleteUser(@PathVariable Long id) {
    userRepo.deleteById(id);
    return ResponseEntity.noContent().build();
}

// VULNERABLE: Authenticated but wrong role
@DeleteMapping("/api/admin/users/{id}")
@Secured("ROLE_USER")  // any user can call this
public ResponseEntity<?> deleteUser(@PathVariable Long id) {
    userRepo.deleteById(id);
    return ResponseEntity.noContent().build();
}

// SECURE
@DeleteMapping("/api/admin/users/{id}")
@PreAuthorize("hasRole('ADMIN')")
public ResponseEntity<?> deleteUser(@PathVariable Long id) {
    userRepo.deleteById(id);
    return ResponseEntity.noContent().build();
}
```

### Go

```go
// VULNERABLE: No auth middleware on route
r.Delete("/admin/users/{id}", deleteUser)

// VULNERABLE: Auth middleware but no role check in handler
r.With(AuthMiddleware).Delete("/admin/users/{id}", deleteUser)

func deleteUser(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    db.DeleteUser(id)  // no role check
    w.WriteHeader(http.StatusNoContent)
}

// SECURE
r.Group(func(r chi.Router) {
    r.Use(AuthMiddleware)
    r.Use(AdminOnlyMiddleware)
    r.Delete("/admin/users/{id}", deleteUser)
})
```

### PHP — Laravel

```php
// VULNERABLE: No auth middleware
Route::delete('/admin/users/{id}', [AdminController::class, 'destroy']);

// VULNERABLE: Auth but no role gate
Route::middleware('auth')->delete('/admin/users/{id}', [AdminController::class, 'destroy']);

// SECURE
Route::middleware(['auth', 'role:admin'])->delete('/admin/users/{id}', [AdminController::class, 'destroy']);

// SECURE (using Gate in controller)
public function destroy($id) {
    Gate::authorize('admin-action');
    User::findOrFail($id)->delete();
    return response()->noContent();
}
```

### C# — ASP.NET Core

```csharp
// VULNERABLE: No authorization attribute
[HttpDelete("api/admin/users/{id}")]
public async Task<IActionResult> DeleteUser(int id) {
    await _userService.DeleteAsync(id);
    return NoContent();
}

// VULNERABLE: [Authorize] but no role
[Authorize]
[HttpDelete("api/admin/users/{id}")]
public async Task<IActionResult> DeleteUser(int id) {
    await _userService.DeleteAsync(id);
    return NoContent();
}

// SECURE
[Authorize(Roles = "Admin")]
[HttpDelete("api/admin/users/{id}")]
public async Task<IActionResult> DeleteUser(int id) {
    await _userService.DeleteAsync(id);
    return NoContent();
}
```

## Verify heuristics (auth/authz analysis)

Missing authentication: sensitive action with no login/session/token required.
Broken function-level authorization: authentication is required but no role/permission
check on a privileged endpoint (vertical escalation).

**What this skill is NOT** — do not flag these here:
- **IDOR / horizontal escalation**: User A accessing user B's resource by changing an ID → covered by the IDOR skill.
- **JWT crypto/verification bugs** → covered by sast-hunter-jwt.

**Authorization patterns that PREVENT issues** — if you see these, the endpoint is likely safe:
1. **Authentication + role-check middleware on a route group** (e.g., `router.use('/admin', auth, requireRole('admin'))`)
2. **Declarative role annotations** (e.g., `@PreAuthorize("hasRole('ADMIN')")`)
3. **In-handler role check** before sensitive action
4. **Middleware gate on entire prefix** (e.g., Chi `r.Group` with `AdminOnly`)
5. **Policy/Gate** objects enforcing privileged actions

**For each endpoint, evaluate**:

1. **Authentication check** — is a valid login/session/token required?
   - Is there an auth middleware, decorator, or guard on this route or its parent group?
   - Trace the middleware chain — confirm the auth middleware runs BEFORE the handler, not after
   - Check if the route is accidentally mounted outside an auth-protected group

2. **Role/permission check** — if the endpoint is privileged, is a role or permission verified?
   - Look for: `is_admin`, `is_staff`, `role == 'admin'`, `hasRole('ADMIN')`, `@PreAuthorize`, `requireRole`, `can?(:manage, ...)`, `Gate::allows`, `authorize('admin-action')`
   - Verify the check runs on every HTTP method — a DELETE may be unguarded even if GET is protected
   - Check that the role comparison is not inverted or trivially bypassable

3. **Edge cases**:
   - Is the check conditional on a user-controlled header, parameter, or query string?
   - Does the auth gate apply to the route group but the specific route is excluded via an `except` list?
   - Is there a secondary unauthenticated path to the same function (e.g., an internal API alias)?
   - Does the middleware apply only to some environments (e.g., skipped in test mode)?

4. **Privilege identification**:
   - Does the endpoint path suggest it is admin/privileged (`/admin/`, `/manage/`, `/internal/`)?
   - Does the operation affect other users' data, system configuration, or aggregate records?
   - If yes to either, a role/permission check should be present

**Confidence selection** (report every endpoint as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: No authentication required, or authenticated but role check is entirely absent on a privileged endpoint.
- **Medium confidence**: Auth and/or role check exists but appears incomplete, bypassable, or misapplied (e.g., wrong role, wrong HTTP method, conditional skip); or you cannot determine with confidence (e.g., complex middleware chain, dynamic role loading, authorization delegated to a service layer).
- **Low confidence**: Proper authentication and role/permission checks are in place — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Endpoint name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Issue**: [Missing authentication / Missing role check for privileged action]
- **Impact**: [What an unauthenticated or low-privilege attacker can do]
- **Proof**: [Show the route definition and handler — highlight the missing check]
- **Remediation**: [Specific fix — add auth middleware, add role decorator, etc.]
- **Dynamic Test**:
  ```
  [curl command or step-by-step to confirm on the live app.
   For missing auth: show the request with NO token succeeding.
   For missing role: show the request with a regular user token succeeding on an admin endpoint.
   Use placeholders like <REGULAR_USER_TOKEN>, <ADMIN_ENDPOINT>.]
  ```

### [FINDING] Endpoint name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Issue**: [What's incomplete about the check]
- **Concern**: [Why this might still be exploitable]
- **Proof**: [Show the code path with the weak/partial check]
- **Remediation**: [Specific fix]
- **Dynamic Test**:
  ```
  [curl command or step-by-step instructions to confirm this finding on the live app.]
  ```

### [FINDING] Endpoint name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Protection**: [How it's protected — auth middleware + role decorator / @PreAuthorize / Gate, etc.]

### [FINDING] Endpoint name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Uncertainty**: [Why automated analysis couldn't determine the status]
- **Suggestion**: [What to look at manually]
```

Focus on **vertical privilege escalation** (user → admin) and **unauthenticated access**. Horizontal escalation (user A → user B's resource) is covered by the IDOR skill.

Authentication (you are who you say you are) and authorization (you are allowed to do this) are separate concerns — check both.

Middleware order matters: a middleware registered after the route handler will NOT protect the route.

A missing auth or role check on one HTTP method (e.g., DELETE) is a full vulnerability even if GET is protected.

When in doubt, record it as a `[FINDING]` with `**Confidence:** low` — never drop it; downstream Challenge/Trace decide. False negatives are worse than false positives in security assessment.

Pay attention to route grouping: a `use('/admin', adminRouter)` pattern protects all routes in `adminRouter`, but routes mounted outside that group are not protected.
