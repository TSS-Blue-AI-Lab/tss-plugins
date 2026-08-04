# Path Traversal — Concept, Examples, and Verify Heuristics

## What is Path Traversal

Path traversal (also called directory traversal) occurs when user-supplied input is incorporated into a file path that is then used to read, write, or serve files from the filesystem — without properly constraining the resulting path to an intended base directory. An attacker can supply sequences like `../` or encoded variants (`%2e%2e%2f`, `..%2f`, `%2e%2e/`) to escape the intended directory and access arbitrary files such as `/etc/passwd`, application source code, credentials, or private keys.

The core pattern: *unvalidated user input reaches a filesystem operation and the resolved path is not verified to remain within the intended base directory.*

### What Path Traversal IS

- Serving a user-requested filename directly from a base directory without canonicalizing and checking the resulting path:
  `open(os.path.join(BASE_DIR, user_filename))`
- Constructing a file path from a URL parameter and passing it to a file-read function:
  `fs.readFile(path.join(__dirname, req.query.file), ...)`
- Template rendering or include directives driven by user input:
  `include($_GET['page'] . '.php')`
- Archive extraction (`ZipFile`, `tarfile`, `zipslip`) where entry names are used as output paths without stripping `../` components
- Using `send_file()` / `send_from_directory()` / `res.sendFile()` with an unsanitized user-controlled path
- Reading a file whose path is derived from a user-controlled database value that was stored without sanitization

### What Path Traversal is NOT

Do not flag these as path traversal:

- **SSRF**: Fetching a remote URL from user input — that is Server-Side Request Forgery, a separate class
- **RCE via file write**: Writing attacker-controlled content to an arbitrary path — related but a different impact class (flag as RCE or File Upload)
- **Static file serving**: Serving files from a path that is entirely hardcoded with no user influence
- **Safe path joins followed by realpath + prefix check**: The code computes `realpath()` and verifies it starts with the intended base directory
- **basename() before join**: Using only the filename component strips traversal sequences (though note this prevents directory selection, not just traversal)

### Patterns That Prevent Path Traversal

When you see these mitigations applied **before** the file operation, the code is likely **not vulnerable**:

**1. `realpath` / `resolve` followed by a base-directory prefix check (most robust fix)**
```python
# Python
import os
BASE = '/var/www/files'
safe_path = os.path.realpath(os.path.join(BASE, user_input))
if not safe_path.startswith(BASE + os.sep):
    raise PermissionError("Path escape detected")
with open(safe_path) as f:
    ...
```

```javascript
// Node.js
const BASE = path.resolve('/var/www/files');
const resolved = path.resolve(BASE, req.query.file);
if (!resolved.startsWith(BASE + path.sep)) {
    return res.status(403).send('Forbidden');
}
fs.readFile(resolved, ...);
```

```java
// Java
Path base = Paths.get("/var/www/files").toRealPath();
Path resolved = base.resolve(userInput).normalize();
if (!resolved.startsWith(base)) {
    throw new SecurityException("Path escape");
}
Files.readAllBytes(resolved);
```

**2. `basename()` / `path.basename()` to strip directory components**
```python
# Python — strips all directory parts, only the filename remains
filename = os.path.basename(user_input)
with open(os.path.join(BASE, filename)) as f:
    ...
```

```php
// PHP
$filename = basename($_GET['file']);
readfile('/var/www/uploads/' . $filename);
```

**3. Allowlist of permitted filenames or extensions**
```python
ALLOWED = {'report.pdf', 'manual.txt', 'logo.png'}
if user_input not in ALLOWED:
    abort(400)
with open(os.path.join(BASE, user_input)) as f:
    ...
```

**4. Framework-provided safe file serving**
```python
# Flask — send_from_directory validates the path stays within the directory
return send_from_directory('/var/www/files', filename)

# Django — FileResponse with a path that was never user-controlled
```

## Vulnerable vs. Secure Examples

### Python — Flask

```python
# VULNERABLE: user-controlled filename joined without realpath check
@app.route('/download')
def download():
    filename = request.args.get('file')
    filepath = os.path.join('/var/www/files', filename)
    return send_file(filepath)

# SECURE: resolve and verify the path stays within the base directory
@app.route('/download')
def download():
    filename = request.args.get('file')
    base = os.path.realpath('/var/www/files')
    filepath = os.path.realpath(os.path.join(base, filename))
    if not filepath.startswith(base + os.sep):
        abort(403)
    return send_file(filepath)
```

### Python — FastAPI

```python
# VULNERABLE: path parameter used directly in file read
@app.get('/file/{name}')
async def get_file(name: str):
    return FileResponse(f'/app/static/{name}')

# SECURE: basename strips traversal sequences
@app.get('/file/{name}')
async def get_file(name: str):
    safe_name = os.path.basename(name)
    return FileResponse(os.path.join('/app/static', safe_name))
```

### Node.js — Express

```javascript
// VULNERABLE: req.query.file used directly in readFile
app.get('/file', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.query.file);
  fs.readFile(filePath, (err, data) => res.send(data));
});

// SECURE: resolve and check prefix
app.get('/file', (req, res) => {
  const base = path.resolve(__dirname, 'uploads');
  const filePath = path.resolve(base, req.query.file);
  if (!filePath.startsWith(base + path.sep)) {
    return res.status(403).send('Forbidden');
  }
  fs.readFile(filePath, (err, data) => res.send(data));
});
```

### PHP

```php
// VULNERABLE: direct inclusion of user input
<?php
$page = $_GET['page'];
include($page . '.php');

// VULNERABLE: readfile with unsanitized path
$file = $_GET['file'];
readfile('/var/www/uploads/' . $file);

// SECURE: basename strips directory components
$file = basename($_GET['file']);
readfile('/var/www/uploads/' . $file);

// SECURE: realpath + prefix check
$base = realpath('/var/www/uploads');
$path = realpath($base . '/' . $_GET['file']);
if ($path === false || strpos($path, $base . DIRECTORY_SEPARATOR) !== 0) {
    http_response_code(403);
    exit;
}
readfile($path);
```

### Ruby on Rails

```ruby
# VULNERABLE: params[:file] used directly in file read
def show
  file_path = Rails.root.join('public', 'reports', params[:file])
  send_file file_path
end

# SECURE: basename only
def show
  safe_name = File.basename(params[:file])
  send_file Rails.root.join('public', 'reports', safe_name)
end
```

### Java — Spring

```java
// VULNERABLE: path variable used directly to read file
@GetMapping("/file/{name}")
public ResponseEntity<Resource> getFile(@PathVariable String name) throws IOException {
    Path filePath = Paths.get("/var/www/files").resolve(name);
    Resource resource = new UrlResource(filePath.toUri());
    return ResponseEntity.ok(resource);
}

// SECURE: normalize and check prefix
@GetMapping("/file/{name}")
public ResponseEntity<Resource> getFile(@PathVariable String name) throws IOException {
    Path base = Paths.get("/var/www/files").toRealPath();
    Path resolved = base.resolve(name).normalize();
    if (!resolved.startsWith(base)) {
        return ResponseEntity.status(403).build();
    }
    Resource resource = new UrlResource(resolved.toUri());
    return ResponseEntity.ok(resource);
}
```

### Go

```go
// VULNERABLE: query param joined directly to base directory
func fileHandler(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("file")
    http.ServeFile(w, r, filepath.Join("/var/www/files", name))
}

// SECURE: filepath.Clean + prefix check
func fileHandler(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("file")
    base := "/var/www/files"
    clean := filepath.Join(base, filepath.Clean("/"+name))
    if !strings.HasPrefix(clean, base+string(os.PathSeparator)) {
        http.Error(w, "Forbidden", http.StatusForbidden)
        return
    }
    http.ServeFile(w, r, clean)
}
```

### Archive Extraction (ZipSlip)

```python
# VULNERABLE: ZipSlip — zip entry names can contain ../
import zipfile
with zipfile.ZipFile(user_zip) as zf:
    zf.extractall('/var/www/uploads')

# SECURE: validate each entry path stays within the target directory
import zipfile, os
base = os.path.realpath('/var/www/uploads')
with zipfile.ZipFile(user_zip) as zf:
    for member in zf.namelist():
        target = os.path.realpath(os.path.join(base, member))
        if not target.startswith(base + os.sep):
            raise ValueError(f"ZipSlip detected: {member}")
    zf.extractall(base)
```

## Verify heuristics (taint analysis and mitigation review)

**Goal**: For each file-loading sink, determine whether a user-supplied value reaches the dynamic
path variable AND whether any mitigation prevents the path from escaping the intended base
directory.

**Check A — Is the path variable user-controlled?**

Trace the dynamic variable(s) backwards to their origin:

1. **Direct user input** — the variable is assigned directly from a request source:
   - HTTP query params: `request.GET.get(...)`, `req.query.x`, `params[:x]`, `$_GET['x']`, `c.Query("x")`
   - Path parameters: `request.path_params['name']`, `req.params.name`, `params[:name]`, `c.Param("name")`
   - Request body / form fields: `request.POST.get(...)`, `req.body.x`, `params[:x]`, `$_POST['x']`
   - HTTP headers: `request.headers.get(...)`, `req.headers['x']`
   - Cookies: `request.COOKIES.get(...)`, `req.cookies.x`
   - Multipart filename: `file.filename`, `req.file.originalname`, `$_FILES['file']['name']`

2. **Indirect user input** — the variable is derived from user input through transformations, intermediate assignments, or function calls. Trace the full chain:
   - Variable assigned from a helper function → check the function's source
   - Variable passed as an argument → check all call sites
   - Variable read from a database value that was originally stored from user input

3. **Server-side / hardcoded value** — the variable comes from config, an environment variable, a hardcoded constant, or server-side logic with no user influence — this sink is NOT exploitable via path traversal.

**Check B — Is path escape prevented by an effective mitigation?**

Even if user input reaches the path, the following mitigations prevent traversal. Check whether they are applied **before** the file operation and applied **correctly**:

- **`realpath` / `os.path.realpath()` + base-directory prefix check**: resolves symlinks and `..` sequences, then verifies the result starts with the intended base. This is the strongest fix.
  - `os.path.realpath(path).startswith(BASE + os.sep)` — effective ✓
  - `os.path.realpath(path).startswith(BASE)` without trailing separator — potentially bypassable if BASE is a prefix of another directory name ✗
- **`path.resolve()` + `startsWith(base + sep)`** (Node.js) — effective ✓
- **`Paths.get(...).normalize()` + `startsWith(base)`** (Java) — effective only if `base` was also obtained via `toRealPath()` ✓
- **`filepath.Clean()` + `strings.HasPrefix(clean, base+sep)`** (Go) — effective ✓
- **`basename()` / `path.basename()` / `File.basename()`** — strips all directory components; effective at preventing traversal but prevents subdirectory access
- **Allowlist of permitted filenames** — fully effective if the allowlist is strict and the input is compared against it before use
- **Framework `send_from_directory`** (Flask) — Flask's `send_from_directory` internally calls `safe_join` which raises an error on traversal; effective ✓

Mitigations that are **insufficient**:
- Stripping `../` with a simple `replace('../', '')` — bypassable with `....//` or URL encoding
- Checking that input does not start with `/` — does not prevent relative traversal
- Using `os.path.join` alone without `realpath` — `os.path.join('/base', '../etc/passwd')` still produces `/etc/passwd`
- URL-decoding the input once — attackers can double-encode: `%252e%252e%252f` → `%2e%2e%2f` → `../`
- Type validation (e.g., checking the extension is `.pdf`) without a path escape check — an attacker can use `../../etc/passwd%00.pdf` (null-byte) on older systems or frame the path to have the right extension at the end

**Confidence selection** (report every sink as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the path variable AND no effective mitigation is in place before the file operation.
- **Medium confidence**: User input probably reaches the path variable (indirect flow), or a weak/incomplete mitigation is present (e.g., `replace('../', '')`, no trailing-separator in prefix check); or you cannot determine the variable's origin with confidence (passes through opaque helpers or complex conditional flows), or the mitigation logic is non-standard and hard to evaluate statically.
- **Low confidence**: The path variable is server-side only, OR an effective mitigation (`realpath` + prefix check, `basename`, strict allowlist, safe framework helper) is correctly applied — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "HTTP query param `file` flows directly into os.path.join without realpath check"]
- **Taint trace**: [Step-by-step from entry point to the file operation]
- **Missing mitigation**: [What check is absent]
- **Impact**: Read arbitrary files accessible to the process user, including `/etc/passwd`, application config, source code, private keys.
- **Remediation**: [Specific fix]
- **Dynamic Test**:
  ```
  [curl command or payload to confirm; show traversal and encoded variants as appropriate]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "Variable likely sourced from user input via helper" or "Weak mitigation: strips ../ but bypassable with ....//"]
- **Taint trace**: [Best-effort trace with the uncertain step identified]
- **Concern**: [Why it remains a risk despite partial mitigation]
- **Remediation**: [Apply realpath + prefix check or basename before joining]
- **Dynamic Test**:
  ```
  [payloads to attempt bypass of the partial mitigation]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "Path is derived entirely from server-side config" or "os.path.realpath() + prefix check correctly applied"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [Why the variable's origin or mitigation could not be determined]
- **Suggestion**: [What to trace manually]
```

`os.path.join` and `path.join` alone do **not** prevent traversal — `os.path.join('/base', '../etc/passwd')` resolves to `/etc/passwd`. Only `realpath` + prefix check prevents this.

Encoded traversal variants (`%2e%2e%2f`, `%252e%252e%252f`, `..%2f`, `%2e%2e/`) bypass naive string-match filters; only filesystem-level resolution (`realpath`) handles them reliably.

`send_from_directory` in Flask is safe by itself (it calls `safe_join` internally) — do not flag it unless user input is also used as the *base directory* argument.

Archive extraction (ZipSlip) is a path traversal variant: zip/tar entry names can contain `../` sequences. Flag any extraction that uses entry names as output paths without per-entry validation.

Second-order traversal is possible: a filename stored in the DB from user input may later be used in a file read elsewhere in the codebase. Treat DB-read path values as potentially tainted and trace back to where they were written.
