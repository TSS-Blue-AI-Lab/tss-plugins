# RCE — Recon Sink Catalog

Find every location in the codebase where OS commands are executed, code is dynamically
evaluated, or data is deserialized using an unsafe deserializer. Flag ANY dynamic variable
passed to these sinks, regardless of where it originates.

**Category 1 — OS Command Execution Sinks**

Look for functions that execute OS commands where the command string or arguments may be
dynamically constructed. Flag when any non-constant variable appears in a dangerous position:

**Python:**
- `os.system(var)` — always flag if any variable
- `os.popen(var)` — always flag if any variable
- `subprocess.run(var, shell=True)`, `subprocess.call(var, shell=True)`, `subprocess.Popen(var, shell=True)`, `subprocess.check_output(var, shell=True)` — flag if `shell=True` AND a variable appears in the command string, OR if the command is a string (not a list) with any variable
- `subprocess.run(f"cmd {var}")` without `shell=True` — flag: passing a string (not list) to subprocess can still be unsafe
- `commands.getoutput(var)`, `commands.getstatusoutput(var)` — always flag

**Node.js / JavaScript:**
- `child_process.exec(var)`, `child_process.execSync(var)` — flag if any variable in command string
- `child_process.execFile(var, ...)` — flag if command or args contain variables
- `child_process.spawn(var, ...)` or `spawn(cmd, args)` with `shell: true` and variable in command — flag
- `shelljs.exec(var)`, `execa(var)` — flag if variable in command

**PHP:**
- `exec(var)`, `system(var)`, `passthru(var)`, `shell_exec(var)`, `popen(var, ...)`, `proc_open(var, ...)` — flag if any variable in command string
- Backtick operator: `` `...{$var}...` `` or `` `$var` `` — always flag

**Ruby:**
- `system(var)`, `exec(var)`, `spawn(var)`, `IO.popen(var)`, `Open3.popen3(var)` — flag if string form with interpolated variable
- Backtick operator: `` `...#{var}...` `` — always flag
- `%x{...#{var}...}` — always flag

**Java:**
- `Runtime.getRuntime().exec(var)` — flag if string argument contains variable concatenation
- `new ProcessBuilder(var)` or `ProcessBuilder` constructed from variable-containing list — flag

**Go:**
- `exec.Command(var, ...)` — flag if command name or arguments are dynamically built from variables (especially from string splits of external input)

**C# / .NET:**
- `Process.Start(var)` — flag if FileName or Arguments are variable
- `ProcessStartInfo { FileName = var, Arguments = var }` — flag

**Category 2 — Code Evaluation Sinks**

Look for functions that interpret strings as executable code:

**Python:**
- `eval(var)` — flag if argument is a variable
- `exec(var)` — flag if argument is a variable
- `compile(var, ...)` followed by `exec()` — flag
- `importlib.import_module(var)`, `__import__(var)` — flag if module name is a variable

**JavaScript / Node.js:**
- `eval(var)` — flag if argument is a variable
- `new Function(var)`, `new Function('x', var)` — flag if body is a variable
- `setTimeout(var, delay)`, `setInterval(var, delay)` — flag if first arg is a string variable
- `vm.runInNewContext(var)`, `vm.runInContext(var)`, `vm.runInThisContext(var)` — flag if variable
- `require(var)` — flag if module path is a variable (dynamic require with external input → path traversal + potential code execution)

**PHP:**
- `eval(var)` — always flag if variable in argument
- `preg_replace(pattern, replacement, subject)` with `/e` modifier in pattern — always flag
- `assert(var)` with string argument — flag if variable
- `create_function('', var)` — flag if body is variable
- `call_user_func(var)`, `call_user_func_array(var, ...)` — flag if function name is a variable

**Ruby:**
- `eval(var)`, `instance_eval(var)`, `class_eval(var)`, `module_eval(var)` — flag if variable
- `binding.eval(var)` — flag if variable

**Category 3 — Unsafe Deserialization Sinks**

Look for deserialization of data that may originate externally. For deserialization sinks,
flag every usage — the question of whether data is user-controlled is Phase 2's job:

**Python:**
- `pickle.loads(var)`, `pickle.load(file_var)` — flag always (pickle is inherently unsafe with untrusted data)
- `marshal.loads(var)`, `marshal.load(file_var)` — flag always
- `yaml.load(var)` without explicit `Loader=yaml.SafeLoader` — flag (any form without a safe loader)
- `jsonpickle.decode(var)` — flag always
- `shelve` accessed with externally-influenced keys

**Java:**
- `ObjectInputStream.readObject()`, `ObjectInputStream.readUnshared()` — flag always
- `XMLDecoder.readObject()` — flag always
- `XStream.fromXML(var)` — flag always (unless XStream security filters are explicitly configured)
- `ObjectMapper` with `.enableDefaultTyping()` or `.activateDefaultTyping(...)` configured on it — flag the readValue call
- `Kryo.readObject(var, ...)`, `Kryo.readClassAndObject(var)` — flag if input stream comes from external source

**PHP:**
- `unserialize(var)` — flag always when argument is a variable

**Ruby:**
- `Marshal.load(var)`, `Marshal.restore(var)` — flag always
- `YAML.load(var)` (Psych) without `permitted_classes: []` — flag

**Node.js:**
- `require('node-serialize').unserialize(var)` — flag always
- `yaml.load(var)` (js-yaml v3 default unsafe load) — flag

**.NET:**
- `BinaryFormatter.Deserialize(var)` — flag always
- `SoapFormatter.Deserialize(var)` — flag always
- `NetDataContractSerializer.ReadObject(var)` — flag
- `JavaScriptSerializer.Deserialize(var)` — flag if argument is variable
- `LosFormatter.Deserialize(var)` — flag always

## What to skip (safe — do not flag)

- `subprocess.run(["cmd", arg1, arg2])` with a list and no `shell=True` — no shell expansion
- `json.loads(var)`, `JSON.parse(var)`, `json_decode(var)` — safe format with no code execution
- `yaml.safe_load(var)` or `yaml.load(var, Loader=yaml.SafeLoader)` — safe loader
- `ast.literal_eval(var)` — only parses Python literals, not arbitrary code

## Recon output — record each candidate as

```markdown
### 1. [Descriptive name — e.g., "shell=True subprocess in image converter"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Category**: [OS Command Injection / Code Injection / Unsafe Deserialization]
- **Sink**: [the dangerous function call — e.g., subprocess.run(..., shell=True)]
- **Dynamic argument(s)**: `var_name` — [brief note on what it appears to represent]
- **Code snippet**:
  ```
  [the relevant code around the sink]
  ```
```
