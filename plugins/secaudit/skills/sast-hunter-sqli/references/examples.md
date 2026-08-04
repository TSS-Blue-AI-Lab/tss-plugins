# SQLi — Concept, Examples, and Verify Heuristics

## What is SQL Injection

SQL injection occurs when user-supplied input is incorporated into SQL queries through string concatenation or interpolation rather than parameterized binding. This allows attackers to alter query logic, bypass authentication, extract sensitive data, modify or delete records, and in some configurations execute OS commands.

The core pattern: *unvalidated, unparameterized user input reaches a SQL query execution call.*

### What SQLi IS

- Concatenating user input directly into a SQL string: `"SELECT * FROM users WHERE name = '" + username + "'"`
- Using string formatting to build queries: `f"SELECT * FROM orders WHERE id = {order_id}"`
- Dynamic `ORDER BY` / `GROUP BY` / table/column names from user input with no allowlist validation
- ORM raw query methods with unsanitized input: `User.objects.raw(f"SELECT * WHERE id={id}")`, `$queryRawUnsafe(input)`
- Second-order injection: input is stored in the DB and later used in a raw query without re-sanitization

### What SQLi is NOT

Do not flag these as SQLi:

- **IDOR**: Changing `?id=1` to `?id=2` to access another user's data — that's Insecure Direct Object Reference, a separate class
- **Mass assignment**: Setting extra ORM model fields from user input — different vulnerability
- **XSS via database**: Storing a `<script>` tag in the DB that's later rendered unescaped — that's XSS, not SQLi
- **NoSQL injection**: Injecting into MongoDB operators — similar concept but a distinct vulnerability class
- **Safe ORM queries**: Parameterized ORM lookups like `User.objects.filter(id=user_id)` or `User.find(params[:id])` — do not flag these

### Patterns That Prevent SQLi

When you see these patterns, the code is likely **not vulnerable**:

**1. Parameterized queries / prepared statements (most common fix)**
```
# Python — cursor.execute with tuple binding
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# Node.js — mysql2 / pg placeholder binding
db.query("SELECT * FROM users WHERE id = ?", [userId])
pool.query("SELECT * FROM users WHERE id = $1", [userId])

# Java — PreparedStatement
PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
ps.setInt(1, userId);

# Go — database/sql placeholder
db.QueryRow("SELECT * FROM users WHERE id = $1", userID)

# PHP — PDO with named params
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");
$stmt->execute(['id' => $userId]);

# C# — SqlCommand with parameters
cmd.CommandText = "SELECT * FROM users WHERE id = @id";
cmd.Parameters.AddWithValue("@id", userId);
```

**2. ORM query builder (safe by default)**
```
# Django ORM
User.objects.filter(id=user_id)

# ActiveRecord (Rails)
User.find(params[:id])
User.where(name: params[:name])

# Prisma (tagged template literal form of $queryRaw)
await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}`

# Laravel Eloquent (non-raw)
User::find($id)
```

**3. Allowlist validation for dynamic identifiers**
```
# Dynamic ORDER BY — validate column name against a hardcoded set before interpolating
ALLOWED_COLUMNS = {'name', 'created_at', 'price'}
if sort_col not in ALLOWED_COLUMNS:
    raise ValueError("Invalid column")
query = f"SELECT * FROM products ORDER BY {sort_col}"  # safe only after allowlist check
```

## Vulnerable vs. Secure Examples

### Python — Django (raw SQL)

```python
# VULNERABLE: f-string interpolation in raw()
def search_users(request):
    username = request.GET.get('username')
    users = User.objects.raw(f"SELECT * FROM auth_user WHERE username = '{username}'")
    return JsonResponse(list(users.values()), safe=False)

# SECURE: parameterized raw()
def search_users(request):
    username = request.GET.get('username')
    users = User.objects.raw("SELECT * FROM auth_user WHERE username = %s", [username])
    return JsonResponse(list(users.values()), safe=False)
```

### Python — Flask / SQLAlchemy

```python
# VULNERABLE: f-string into text()
@app.route('/search')
def search():
    name = request.args.get('name')
    result = db.session.execute(text(f"SELECT * FROM products WHERE name = '{name}'"))
    return jsonify(result.fetchall())

# SECURE: named bound parameter
@app.route('/search')
def search():
    name = request.args.get('name')
    result = db.session.execute(
        text("SELECT * FROM products WHERE name = :name"), {"name": name}
    )
    return jsonify(result.fetchall())
```

### Python — sqlite3 / psycopg2

```python
# VULNERABLE
def get_user(username):
    cursor.execute("SELECT * FROM users WHERE username = '" + username + "'")
    return cursor.fetchone()

# SECURE
def get_user(username):
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    return cursor.fetchone()
```

### Node.js — mysql2

```javascript
// VULNERABLE: template literal in query string
app.get('/user', async (req, res) => {
  const { id } = req.query;
  const [rows] = await db.query(`SELECT * FROM users WHERE id = ${id}`);
  res.json(rows);
});

// SECURE: placeholder binding
app.get('/user', async (req, res) => {
  const { id } = req.query;
  const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
  res.json(rows);
});
```

### Node.js — pg (PostgreSQL)

```javascript
// VULNERABLE
app.get('/orders', async (req, res) => {
  const status = req.query.status;
  const result = await pool.query(`SELECT * FROM orders WHERE status = '${status}'`);
  res.json(result.rows);
});

// SECURE
app.get('/orders', async (req, res) => {
  const status = req.query.status;
  const result = await pool.query('SELECT * FROM orders WHERE status = $1', [status]);
  res.json(result.rows);
});
```

### Ruby on Rails

```ruby
# VULNERABLE: string interpolation in where()
def search
  @users = User.where("name = '#{params[:name]}'")
end

# VULNERABLE: find_by_sql with interpolation
def find_user
  @user = User.find_by_sql("SELECT * FROM users WHERE email = '#{params[:email]}'")
end

# SECURE: parameterized where()
def search
  @users = User.where("name = ?", params[:name])
  # or using hash form: User.where(name: params[:name])
end
```

### Java — Spring JDBC

```java
// VULNERABLE: string concatenation
public User findUser(String username) {
    String sql = "SELECT * FROM users WHERE username = '" + username + "'";
    return jdbcTemplate.queryForObject(sql, userRowMapper);
}

// SECURE: parameterized query
public User findUser(String username) {
    return jdbcTemplate.queryForObject(
        "SELECT * FROM users WHERE username = ?", userRowMapper, username
    );
}
```

### Go — database/sql

```go
// VULNERABLE: fmt.Sprintf to build query
func GetUserByName(name string) (*User, error) {
    query := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", name)
    row := db.QueryRow(query)
    // ...
}

// SECURE: parameterized query
func GetUserByName(name string) (*User, error) {
    row := db.QueryRow("SELECT * FROM users WHERE name = $1", name)
    // ...
}
```

### PHP — PDO

```php
// VULNERABLE: string concatenation
function getUser($id) {
    $stmt = $pdo->query("SELECT * FROM users WHERE id = " . $id);
    return $stmt->fetch();
}

// SECURE: prepared statement
function getUser($id) {
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");
    $stmt->execute(['id' => $id]);
    return $stmt->fetch();
}
```

### C# — ADO.NET

```csharp
// VULNERABLE: string concatenation
public User GetUser(string username) {
    using var cmd = new SqlCommand(
        "SELECT * FROM Users WHERE Username = '" + username + "'", conn);
    return ReadUser(cmd.ExecuteReader());
}

// SECURE: parameterized command
public User GetUser(string username) {
    using var cmd = new SqlCommand(
        "SELECT * FROM Users WHERE Username = @username", conn);
    cmd.Parameters.AddWithValue("@username", username);
    return ReadUser(cmd.ExecuteReader());
}
```

### Dynamic ORDER BY / Column Names (all stacks)

```python
# VULNERABLE: unsanitized user input as column name (parameterization can't help here)
sort_col = request.args.get('sort', 'name')
cursor.execute(f"SELECT * FROM products ORDER BY {sort_col}")

# SECURE: allowlist validation before interpolation
ALLOWED_SORT_COLS = {'name', 'price', 'created_at'}
sort_col = request.args.get('sort', 'name')
if sort_col not in ALLOWED_SORT_COLS:
    return abort(400)
cursor.execute(f"SELECT * FROM products ORDER BY {sort_col}")
```

## Verify heuristics (taint analysis)

**Goal**: For each candidate construction site, determine whether a user-supplied value reaches the interpolated variable.

**Trace the interpolated variable(s) backwards to their origin**:

1. **Direct user input** — the variable is assigned directly from a request source with no transformation:
   - HTTP query params: `request.GET.get(...)`, `req.query.x`, `params[:x]`, `$_GET['x']`, `c.Query("x")`
   - Path parameters: `request.path_params['id']`, `req.params.id`, `params[:id]`
   - Request body / form fields: `request.POST.get(...)`, `req.body.x`, `params[:x]`, `$_POST['x']`
   - HTTP headers: `request.headers.get(...)`, `req.headers['x']`
   - Cookies: `request.COOKIES.get(...)`, `req.cookies.x`

2. **Indirect user input** — the variable is derived from user input through transformations, function calls, or intermediate assignments. Trace the full chain:
   - Variable assigned from a function return value → check that function's parameter origin
   - Variable passed as a function argument → check the call site(s)
   - Variable read from a class attribute or shared state set elsewhere → find the setter
   - Variable conditionally assigned — check all branches

3. **Second-order input** — the variable is read from the database, but the stored value originally came from user input:
   - Find where this value was written to the DB — was it stored from a user-supplied field?
   - Was it sanitized or parameterized at write time?

4. **Server-side / hardcoded value** — the variable comes from config, an environment variable, a hardcoded constant, or server-side logic with no user influence — this site is NOT exploitable.

**Mitigations** (check even if user input might reach the variable):
- Allowlist validation before use (especially for dynamic identifiers — column/table names, `ORDER BY`)
- Type casts that genuinely constrain the value in context (e.g., `int(val)` in purely numeric SQL fragments)
- Custom escaping (`mysql_real_escape_string`, `addslashes`, homegrown sanitizers) is **not** equivalent to parameterization — still record as a `[FINDING]` with `**Confidence:** medium` if taint is present

**Confidence selection** (report every site as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the interpolated variable with no effective mitigation.
- **Medium confidence**: User input probably reaches the variable (indirect flow) or only weak mitigation (custom escaping) is present; or you cannot determine the variable's origin with confidence (opaque helpers, complex flows, external libraries).
- **Low confidence**: The variable is server-side only, OR effective parameterization / allowlist validation is in place — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "HTTP query param `username` flows directly into f-string SELECT query"]
- **Taint trace**: [Step-by-step from entry point to the construction site]
- **Impact**: [What an attacker can do — extract records, bypass auth, delete data, etc.]
- **Remediation**: [Parameterized query, ORM equivalent, or allowlist for identifiers]
- **Dynamic Test**:
  ```
  [sqlmap command or manual curl payload. Show parameter, payload, expected response signal.
   Example: sqlmap -u "https://app.example.com/search?q=test" -p q --dbs]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "Indirect flow or custom escaping only"]
- **Taint trace**: [Best-effort trace; mark uncertain steps]
- **Concern**: [Why it remains a risk]
- **Remediation**: [Replace with parameterized query]
- **Dynamic Test**:
  ```
  [payload to attempt bypass]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "Server-side constant" or "Allowlist gates sort column"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [Why origin could not be determined]
- **Suggestion**: [What to trace manually]
```

Focus on **raw SQL and ORM raw/unsafe methods**. Standard ORM query builder calls (`.filter()`, `.where(col: val)`, `.find()`) are safe by default — do not flag them.

When in doubt, record it as a `[FINDING]` with `**Confidence:** low` — never drop it; downstream Challenge/Trace decide. False negatives are worse than false positives in security assessment.

Taint can flow indirectly: a request parameter may be extracted in a middleware, stored in a shared object, passed through several helper functions, and finally reach the query construction. Trace the full chain.

Custom escaping (including `mysql_real_escape_string`, `addslashes`, or homegrown sanitizers) is **not** equivalent to parameterization — record as a `[FINDING]` with `**Confidence:** medium` even if escaping is present.

For dynamic identifiers (column/table names), parameterization cannot help — the only safe fix is allowlist validation. Flag any dynamic identifier without an allowlist, regardless of whether it appears user-controlled.

Second-order injection is easy to miss: a value stored in the DB from user input may later be read and used unsafely in a raw query elsewhere in the codebase. Treat DB-read values as potentially tainted and trace back to where they were written.
