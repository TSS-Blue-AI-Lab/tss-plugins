# Path Traversal — Recon Sink Catalog

Find every location in the codebase where a file is opened, read, served, or extracted using a
dynamically constructed path — meaning the path (or a component of it) is stored in a variable
rather than being a fully hardcoded string. Flag any dynamic path component regardless of origin;
do not yet decide whether it is user-controlled (that is the verify phase's job).

## File-loading sink patterns

1. **Direct file open / read calls with a variable path**:
   - Python: `open(var)`, `open(os.path.join(..., var))`, `pathlib.Path(var).read_text()`, `pathlib.Path(var).read_bytes()`
   - Node.js: `fs.readFile(var, ...)`, `fs.readFileSync(var)`, `fs.createReadStream(var)`
   - PHP: `file_get_contents(var)`, `fopen(var, ...)`, `readfile(var)`, `include(var)`, `require(var)`, `include_once(var)`, `require_once(var)`
   - Ruby: `File.read(var)`, `File.open(var)`, `IO.read(var)`, `IO.binread(var)`
   - Java: `new FileInputStream(var)`, `new File(var)`, `Files.readAllBytes(Paths.get(var))`, `Files.newInputStream(path)`
   - Go: `os.Open(var)`, `os.ReadFile(var)`, `ioutil.ReadFile(var)`, `os.OpenFile(var, ...)`
   - C#: `File.ReadAllText(var)`, `File.ReadAllBytes(var)`, `new FileStream(var, ...)`, `System.IO.File.Open(var, ...)`

2. **Framework file-serving calls with a variable path**:
   - Flask: `send_file(var)`, `send_from_directory(base, var)`
   - FastAPI / Starlette: `FileResponse(var)`
   - Django: `FileResponse(open(var, 'rb'))`, `StreamingHttpResponse` over an opened file
   - Express: `res.sendFile(var)`, `res.download(var)`, `express.static` with dynamic root
   - Spring: `new UrlResource(path.toUri())`, `ResourceLoader.getResource(var)`, `ClassPathResource(var)`
   - Rails: `send_file var`, `render file: var`
   - Go: `http.ServeFile(w, r, var)`, `http.ServeContent(w, r, var, ...)`

3. **Path construction functions where at least one component is a variable**:
   - `os.path.join(BASE, var)`, `os.path.join(var1, var2)`
   - `path.join(__dirname, var)`, `path.resolve(base, var)`
   - `Paths.get(base).resolve(var)`
   - `filepath.Join(base, var)`
   - String concatenation used as a path: `BASE + var`, `f"{BASE}/{var}"`, `` `${base}/${var}` ``

4. **Archive extraction with user-supplied archives** (ZipSlip pattern):
   - Python: `zipfile.ZipFile.extractall(...)`, `tarfile.TarFile.extractall(...)`
   - Java: `ZipEntry.getName()` used as an output path
   - Node.js: `unzipper`, `adm-zip`, `node-tar` extraction calls
   - Go: `archive/zip` or `archive/tar` extraction without entry-name validation

## What to skip (these have no dynamic path component — do not flag)

- File paths that are fully hardcoded string literals with no variable parts
- Paths derived entirely from server-side config / environment variables with no user-supplied component (e.g., `open(settings.LOG_FILE)` where `LOG_FILE` is a config value)
- Framework built-in static file middleware where the root directory is hardcoded (e.g., `express.static('public')` with a fixed root)

## Recon output — record each candidate as

```markdown
# Path Traversal Recon: [Project Name]

## Summary
Found [N] locations where files are accessed using dynamically constructed paths.

## File-Loading Sinks

### 1. [Descriptive name — e.g., "Dynamic readFile in download endpoint"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Sink**: [open / fs.readFile / send_file / include / FileInputStream / etc.]
- **Path construction**: [os.path.join / path.join / string concat / f-string / etc.]
- **Dynamic variable(s)**: `var_name` — [brief note on what it appears to represent, e.g., "looks like a filename from request" or "unknown origin"]
- **Code snippet**:
  ```
  [the path construction + file operation call]
  ```

[Repeat for each sink]
```
