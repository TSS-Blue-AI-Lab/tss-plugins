# RCE — Concept, Examples, and Verify Heuristics

## What is Remote Code Execution

Remote Code Execution (RCE) occurs when an attacker can cause the application to execute arbitrary OS commands or application-level code that they control. This is typically the highest-severity vulnerability class, often resulting in complete server compromise.

RCE arises from three primary root causes:

1. **OS Command Injection**: User input is embedded unsafely into an OS command string, allowing shell metacharacters to inject additional commands.
2. **Code Injection (eval-like)**: User input is passed to functions that interpret it as executable code (`eval`, `exec`, `Function()`, etc.).
3. **Unsafe Deserialization**: User-supplied serialized data is deserialized using a gadget-prone deserializer, triggering arbitrary code execution via crafted payloads.

### What RCE IS

- Passing user input directly or indirectly into OS command execution functions with shell interpretation enabled
- Using `eval()`, `exec()`, `Function()`, or equivalent constructs with user-controlled strings
- Deserializing user-supplied bytes/strings with inherently unsafe deserializers (pickle, PHP unserialize, Java native serialization, Ruby Marshal, etc.)
- Using `yaml.load()` without a safe loader on user-supplied content
- Dynamic `require()`/`import()` with user-controlled module paths
- PHP file inclusion (`include`/`require`) with user-controlled paths

### What RCE is NOT

Do not flag these as RCE:

- **SSRF**: Making HTTP requests to attacker-controlled URLs — different vulnerability class (no code execution)
- **Path Traversal**: Reading/writing arbitrary files — separate class (unless the read file is then executed/deserialized)
- **SSTI**: Template injection via template engines — a separate though related class; flag as SSTI, not RCE
- **XSS**: JavaScript execution in a victim's browser — client-side only, not server-side RCE
- **SQL Injection**: Injecting into database queries — different class (even if `xp_cmdshell` can lead to OS commands, flag it as SQLi)
- **Safe subprocess list-form calls**: `subprocess.run(["ls", user_arg])` with a list and no `shell=True` — arguments are passed directly to the OS without shell expansion; not vulnerable to command injection
- **Safe deserialization**: `json.loads()`, `yaml.safe_load()`, `xml.etree.ElementTree.parse()` — these formats have no code execution semantics

### Patterns That Prevent RCE

When you see these patterns, the code is likely **not vulnerable**:

**1. Subprocess list form without shell interpretation**
```
# Python — list args, no shell=True
subprocess.run(["convert", "-resize", size, input_file, output_file])
subprocess.Popen(["git", "clone", repo_url])

# Node.js — spawn with separate args (no shell)
child_process.spawn("ffmpeg", ["-i", inputFile, outputFile])

# Java — ProcessBuilder with list
new ProcessBuilder("ls", "-la", dir).start()

# Ruby — system() with multiple args (not a single interpolated string)
system("ffmpeg", "-i", "input.mp4", "-f", format, "output")
```

**2. Safe deserialization formats**
```
# Python — JSON instead of pickle
import json
data = json.loads(user_input)  # no code execution semantics

# Python — safe YAML loader
import yaml
data = yaml.safe_load(user_input)  # restricts to basic types only

# Java — Jackson without enableDefaultTyping, with concrete target type
ObjectMapper mapper = new ObjectMapper();
MyClass obj = mapper.readValue(json, MyClass.class);  # safe
```

**3. Strict allowlist before command construction**
```
# Python — allowlist for dynamic arguments
ALLOWED_FORMATS = {"png", "jpg", "webp"}
if fmt not in ALLOWED_FORMATS:
    return abort(400)
subprocess.run(["convert", infile, f"output.{fmt}"])

# Node.js — allowlist for dynamic args
const ALLOWED_COMMANDS = ['ls', 'pwd'];
if (!ALLOWED_COMMANDS.includes(cmd)) return res.status(400).end();
spawn(cmd, []);
```

## Vulnerable vs. Secure Examples

### OS Command Injection — Python

```python
# VULNERABLE: shell=True with f-string
@app.route('/ping')
def ping():
    host = request.args.get('host')
    result = subprocess.run(f"ping -c 1 {host}", shell=True, capture_output=True, text=True)
    return result.stdout
# Payload: ?host=127.0.0.1;id  → executes "id"

# VULNERABLE: os.system with string formatting
def convert_image(filename):
    size = request.form.get('size')
    os.system(f"convert {filename} -resize {size} output.jpg")

# SECURE: list-form subprocess, no shell
@app.route('/ping')
def ping():
    host = request.args.get('host')
    result = subprocess.run(["ping", "-c", "1", host], capture_output=True, text=True, timeout=5)
    return result.stdout
```

### OS Command Injection — Node.js

```javascript
// VULNERABLE: exec with template literal
app.get('/search', (req, res) => {
  const query = req.query.q;
  exec(`grep -r "${query}" /var/log/app/`, (err, stdout) => {
    res.send(stdout);
  });
});
// Payload: ?q=foo" /etc/passwd "

// VULNERABLE: execSync with concatenation
function runScript(userScript) {
  return execSync('node scripts/' + userScript);
}

// SECURE: spawn with separate args
app.get('/search', (req, res) => {
  const query = req.query.q;
  const proc = spawn('grep', ['-r', query, '/var/log/app/']);
  proc.stdout.on('data', (data) => res.write(data));
  proc.on('close', () => res.end());
});
```

### OS Command Injection — PHP

```php
// VULNERABLE: shell_exec with user input
function generateThumbnail($file) {
    $size = $_GET['size'];
    shell_exec("convert {$file} -resize {$size} thumb.jpg");
}

// VULNERABLE: backtick operator
function checkHost() {
    $host = $_POST['host'];
    $result = `ping -c 1 $host`;
    return $result;
}

// SECURE: escapeshellarg (reduces risk — but prefer removing shell entirely)
function generateThumbnail($file) {
    $size = escapeshellarg($_GET['size']);
    $file = escapeshellarg($file);
    shell_exec("convert $file -resize $size thumb.jpg");
}
```

### OS Command Injection — Ruby

```ruby
# VULNERABLE: string interpolation in system()
get '/convert' do
  format = params[:format]
  system("ffmpeg -i input.mp4 -f #{format} output")
end

# VULNERABLE: backtick with user input
def check_dns
  `nslookup #{params[:host]}`
end

# SECURE: system() with separate args (no shell expansion)
get '/convert' do
  format = params[:format]
  ALLOWED = %w[mp4 avi mkv]
  return 400 unless ALLOWED.include?(format)
  system("ffmpeg", "-i", "input.mp4", "-f", format, "output")
end
```

### Code Injection — Python eval/exec

```python
# VULNERABLE: eval with user input
@app.route('/calculate')
def calculate():
    expr = request.args.get('expr')
    result = eval(expr)  # attacker can run __import__('os').system('id')
    return str(result)

# VULNERABLE: exec with user code
@app.route('/run')
def run_code():
    code = request.json.get('code')
    exec(code)  # full arbitrary code execution
    return "ok"

# SECURE: ast.literal_eval for safe expression parsing (literals only)
from ast import literal_eval
@app.route('/parse')
def parse():
    data = request.args.get('data')
    result = literal_eval(data)  # only parses strings/numbers/lists/dicts/bools
    return str(result)
```

### Code Injection — JavaScript eval / Function

```javascript
// VULNERABLE: eval with user input
app.post('/formula', (req, res) => {
  const formula = req.body.formula;
  const result = eval(formula);  // RCE: process.exit(), require('child_process')...
  res.json({ result });
});

// VULNERABLE: new Function() constructor
function compute(userExpression) {
  const fn = new Function('x', `return ${userExpression}`);
  return fn(42);
}

// VULNERABLE: vm.runInNewContext (sandbox escape via __proto__ pollution)
const vm = require('vm');
app.post('/eval', (req, res) => {
  const result = vm.runInNewContext(req.body.code);
  res.json({ result });
});

// SECURE: use a math expression library (no arbitrary code)
const { evaluate } = require('mathjs');
app.post('/formula', (req, res) => {
  const result = evaluate(req.body.formula);  // sandboxed math expressions only
  res.json({ result });
});
```

### Unsafe Deserialization — Python pickle

```python
# VULNERABLE: deserializing user-supplied pickle data
@app.route('/load', methods=['POST'])
def load_session():
    data = request.get_data()
    session = pickle.loads(data)  # attacker controls __reduce__ → RCE
    return jsonify(session)

# VULNERABLE: base64-encoded pickle from cookie
@app.route('/profile')
def profile():
    session_cookie = request.cookies.get('session')
    data = base64.b64decode(session_cookie)
    user = pickle.loads(data)  # crafted cookie → arbitrary code at deserialization
    return render_template('profile.html', user=user)

# SECURE: use JSON (no code execution semantics)
@app.route('/profile')
def profile():
    session_cookie = request.cookies.get('session')
    user = json.loads(base64.b64decode(session_cookie))
    return render_template('profile.html', user=user)
```

### Unsafe Deserialization — Java

```java
// VULNERABLE: ObjectInputStream.readObject() on user-supplied stream
@PostMapping("/deserialize")
public ResponseEntity<?> deserialize(@RequestBody byte[] data) throws Exception {
    ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(data));
    Object obj = ois.readObject();  // gadget chains (Commons Collections, Spring, etc.) → RCE
    return ResponseEntity.ok(obj);
}

// VULNERABLE: Jackson with enableDefaultTyping
ObjectMapper mapper = new ObjectMapper();
mapper.enableDefaultTyping();  // attacker specifies arbitrary class type in JSON → RCE
MyData data = mapper.readValue(userJson, MyData.class);

// SECURE: Jackson with concrete type, no enableDefaultTyping
ObjectMapper mapper = new ObjectMapper();
MyData data = mapper.readValue(userJson, MyData.class);  // safe with concrete target type
```

### Unsafe Deserialization — PHP

```php
// VULNERABLE: unserialize() with user input
function loadProfile() {
    $data = base64_decode($_COOKIE['profile']);
    $user = unserialize($data);  // PHP object injection → POP chain → RCE
    return $user;
}

// VULNERABLE: unserialize from POST body
$obj = unserialize($_POST['data']);

// SECURE: json_decode instead
function loadProfile() {
    $data = base64_decode($_COOKIE['profile']);
    $user = json_decode($data, true);  // no code execution semantics
    return $user;
}
```

### Unsafe Deserialization — Ruby Marshal

```ruby
# VULNERABLE: Marshal.load with user-supplied data
post '/restore' do
  data = Base64.decode64(params[:state])
  object = Marshal.load(data)  # arbitrary Ruby object graph → RCE via gadgets
  object.process
end

# SECURE: use JSON
post '/restore' do
  data = JSON.parse(Base64.decode64(params[:state]))
  # work with plain data structures only
end
```

### Unsafe Deserialization — Node.js

```javascript
// VULNERABLE: node-serialize (known RCE via IIFE in serialized string)
const serialize = require('node-serialize');
app.post('/restore', (req, res) => {
  const obj = serialize.unserialize(req.body.data);  // IIFE payload → RCE
  res.json(obj);
});

// VULNERABLE: js-yaml v3 yaml.load (executes JS functions in YAML tags)
const yaml = require('js-yaml');
const data = yaml.load(userInput);  // !!js/function payload → RCE

// SECURE: yaml.safeLoad (v3) or FAILSAFE_SCHEMA (v4)
const data = yaml.safeLoad(userInput);  // only loads plain data types
```

### Unsafe YAML — Python

```python
# VULNERABLE: yaml.load without Loader
import yaml
data = yaml.load(user_input)  # !!python/object/apply: payload → RCE

# SECURE: yaml.safe_load
data = yaml.safe_load(user_input)  # only loads basic data types
```

## Verify heuristics (taint analysis)

Trace each sink's dynamic argument(s) back to their origin. RCE requires attacker-controlled
data to reach a dangerous sink (OS command with shell interpretation, eval-like execution,
or unsafe deserialization).

**What RCE is NOT** — do not flag these as RCE:
- **SSRF**, **path traversal**, **SSTI**, **XSS**, **SQLi** — other classes (see concept section above).
- **Safe subprocess list-form** with no shell: arguments passed without shell expansion are not command injection.
- **Safe formats**: `json.loads`, `yaml.safe_load`, `ast.literal_eval` — no code execution semantics.

**For each sink, trace the dynamic argument(s) backwards to their origin**:

1. **Direct user input** — the variable is assigned directly from a request source with no transformation:
   - HTTP query params: `request.GET.get(...)`, `req.query.x`, `params[:x]`, `$_GET['x']`, `c.Query("x")`
   - Path parameters: `request.path_params['id']`, `req.params.id`, `params[:id]`
   - Request body / form fields: `request.POST.get(...)`, `req.body.x`, `params[:x]`, `$_POST['x']`
   - HTTP headers: `request.headers.get(...)`, `req.headers['x']`
   - Cookies: `request.COOKIES.get(...)`, `req.cookies.x`
   - File upload content: `request.files['file'].read()`, `req.file.buffer`
   - WebSocket messages, queue/event payloads

2. **Indirect user input** — the variable is derived from user input through transformations, function calls, or intermediate assignments. Trace the full chain:
   - Variable assigned from a function return value → check that function's parameter origin
   - Variable passed as a function argument → check the call site(s)
   - Variable conditionally assigned — check all branches

3. **Externally-influenced deserialization data** — for deserialization sinks: Is the raw bytes/string coming from a network socket, HTTP request body, cookie, file upload, or a database value that was originally user-supplied? Any externally-controllable byte stream fed to an unsafe deserializer is exploitable.

4. **Server-side / hardcoded value** — the variable comes from config, an environment variable, a hardcoded constant, or server-side logic with no external influence — NOT exploitable.

**Mitigations to check for each sink**:
- **Allowlist validation**: Is the variable validated against a fixed set of known-safe values before use? If strict and complete, record as a `[FINDING]` with `**Confidence:** low`.
- **Integer/type cast**: Does casting to `int`/`float` actually prevent injection in this context? Effective only for purely numeric arguments with no quoting issues.
- **escapeshellarg / escapeshellcmd** (PHP): Reduces risk but is not elimination — record as a `[FINDING]` with `**Confidence:** medium`; shell escaping has bypass history in certain contexts.
- **Subprocess list form**: `subprocess.run(["cmd", var])` without `shell=True` — arguments are passed directly to the OS, no shell expansion. This IS an effective mitigation for command injection (record as a `[FINDING]` with `**Confidence:** low` for injection; the value is still passed to the command, but cannot inject new commands).
- **Safe deserializer in place**: If `json.loads()`, `yaml.safe_load()`, etc. are used instead — skip (Phase 1 should not have flagged these).

**Confidence selection** (report every sink as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the dangerous sink with no effective mitigation.
- **Medium confidence**: User input probably reaches the sink (indirect flow) or only weak mitigation is present (shell escaping, partial validation, unclear allowlist); or you cannot determine the argument's origin with confidence (passes through opaque helpers, complex conditional flows, or external libraries).
- **Low confidence**: The argument is server-side only, OR effective mitigation is in place (subprocess list form, strict allowlist, safe deserializer format) — still record it rather than dropping it; downstream Challenge/Trace decide.

**Per-finding output fields** (used in the merged report):
- **File**, **Endpoint / function**, **Category** (OS Command Injection / Code Injection / Unsafe Deserialization)
- **Issue**: short description of the flow
- **Taint trace**: step-by-step from entry point to the sink
- **Impact**: what an attacker can do — execute arbitrary OS commands, read /etc/passwd, establish reverse shell, achieve full server compromise
- **Remediation**: specific fix — list-form subprocess, replace eval with a safe alternative, switch to json.loads/yaml.safe_load
- **Dynamic Test**: curl command or payload to confirm the finding, e.g. `curl "https://app.example.com/ping?host=127.0.0.1;id"`, or how to craft a malicious payload with ysoserial/pickletools for deserialization sinks
- For low confidence: **Reason**. For medium-confidence uncertain flows: **Uncertainty** and **Suggestion**.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Category**: [OS Command Injection / Code Injection / Unsafe Deserialization]
- **Issue**: [short description of the flow]
- **Taint trace**: [step-by-step from entry point to the sink]
- **Impact**: [what an attacker can do — execute arbitrary OS commands, read /etc/passwd, establish reverse shell, achieve full server compromise]
- **Remediation**: [specific fix — list-form subprocess, replace eval with a safe alternative, switch to json.loads/yaml.safe_load]
- **Dynamic Test**:
  ```
  [curl command or payload to confirm the finding, e.g. curl "https://app.example.com/ping?host=127.0.0.1;id",
   or how to craft a malicious payload with ysoserial/pickletools for deserialization sinks]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Category**: [category]
- **Issue**: [indirect flow, or only weak mitigation present]
- **Taint trace**: [best-effort trace; mark uncertain steps]
- **Concern**: [why it remains a risk]
- **Remediation**: [fix]
- **Dynamic Test**:
  ```
  [payload to attempt]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Category**: [category]
- **Reason**: [e.g., "Server-side only" or "Subprocess list form with no shell"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Category**: [category]
- **Uncertainty**: [why the argument's origin could not be determined]
- **Suggestion**: [what to trace manually]
```
