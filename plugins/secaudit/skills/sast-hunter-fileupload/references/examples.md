# File Upload — Concept, Examples, and Verify Heuristics

## What is an Insecure File Upload

Insecure file upload occurs when an application accepts files from users without properly validating or restricting what can be uploaded, allowing an attacker to upload executable or malicious files. The most critical outcome is **Remote Code Execution (RCE)**: an attacker uploads a web shell (e.g., a `.php` file) and the server executes it when accessed via a direct URL.

The core pattern: *a user-supplied file reaches a storage location without adequate extension validation, and the stored file is accessible or executable.*

### What Insecure File Upload IS

- Accepting any file type with no extension or content check: `file.save(upload_path)` with no validation
- Content-Type-only validation: checking `Content-Type: image/png` without verifying the actual extension or file content — trivially bypassed by setting the header manually
- Extension blocklist with gaps: `.php` is blocked but `.php3`, `.php4`, `.php5`, `.phtml`, `.phar`, `.shtml` are not
- Case-insensitive bypass: blocking `.php` but allowing `.PHP`, `.Php`, `.pHp`
- Double extension bypass: `shell.php.jpg` — code extracts the last `.jpg` and considers it safe, but the server (Apache) serves it as PHP
- Path traversal in filenames: `../../webroot/shell.php` stored via an unsanitized filename
- Incomplete filename sanitization: only stripping `../` but not encoded variants `%2e%2e%2f`
- Serving uploaded files from a web-executable directory without disabling execution

### What Insecure File Upload is NOT

Do not flag these as file upload vulnerabilities:

- **Stored XSS via SVG**: uploading an SVG with embedded `<script>` that is reflected back — that's XSS, not an upload execution issue
- **SSRF via file content**: uploading an XML or SVG that triggers an outbound request — that's XXE/SSRF, not a file upload execution issue
- **DoS via large files**: missing file size limits — a separate availability issue
- **IDOR on download**: accessing another user's uploaded file without authorization — that's IDOR
- **Secure uploads**: files stored outside the web root, or served through a controlled download endpoint that sets `Content-Disposition: attachment`, or stored in an object storage bucket with no public execution capability

### Patterns That Prevent Insecure File Upload

When you see these patterns together, the code is likely **not vulnerable**:

**1. Allowlist of safe extensions (most important)**
```python
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'pdf'}
ext = filename.rsplit('.', 1)[-1].lower()
if ext not in ALLOWED_EXTENSIONS:
    abort(400)
```

**2. Magic byte / file content validation (defense in depth)**
```python
import magic
mime = magic.from_buffer(file.read(2048), mime=True)
ALLOWED_MIMES = {'image/png', 'image/jpeg', 'image/gif'}
if mime not in ALLOWED_MIMES:
    abort(400)
```

**3. Filename sanitization using a trusted library**
```python
from werkzeug.utils import secure_filename
filename = secure_filename(file.filename)  # strips path separators and dangerous chars
```

**4. Storing uploads outside the web root**
```
/var/uploads/  ← not served by the web server
/var/www/html/ ← web root (do NOT store uploads here)
```

**5. Serving uploads through a controlled endpoint with Content-Disposition**
```python
@app.route('/download/<filename>')
def download(filename):
    return send_from_directory(UPLOAD_FOLDER, filename,
                               as_attachment=True)  # forces download, prevents execution
```

**6. Renaming the file to a server-generated UUID**
```python
import uuid
stored_name = str(uuid.uuid4()) + '.jpg'  # extension is server-controlled, not user-controlled
```

## Vulnerable vs. Secure Examples

### Python — Flask

```python
# VULNERABLE: no extension check, file stored in web-accessible directory
@app.route('/upload', methods=['POST'])
def upload():
    f = request.files['file']
    f.save(os.path.join('static/uploads', f.filename))
    return 'uploaded'

# VULNERABLE: content-type only check (trivially bypassed with curl -H)
@app.route('/upload', methods=['POST'])
def upload():
    f = request.files['file']
    if f.content_type not in ['image/png', 'image/jpeg']:
        abort(400)
    f.save(os.path.join('static/uploads', f.filename))
    return 'uploaded'

# VULNERABLE: blocklist — .phtml/.phar/.php5 not covered
BLOCKED = {'.php', '.sh', '.exe'}
@app.route('/upload', methods=['POST'])
def upload():
    f = request.files['file']
    ext = os.path.splitext(f.filename)[1].lower()
    if ext in BLOCKED:
        abort(400)
    f.save(os.path.join('static/uploads', f.filename))
    return 'uploaded'

# SECURE: allowlist + sanitized filename + outside web root
ALLOWED = {'png', 'jpg', 'jpeg', 'gif'}
UPLOAD_FOLDER = '/var/uploads'  # outside web root

@app.route('/upload', methods=['POST'])
def upload():
    f = request.files['file']
    filename = secure_filename(f.filename)
    ext = filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED:
        abort(400)
    f.save(os.path.join(UPLOAD_FOLDER, filename))
    return 'uploaded'
```

### Python — Django

```python
# VULNERABLE: no validation on FileField
class DocumentForm(forms.ModelForm):
    class Meta:
        model = Document
        fields = ['upload']

# VULNERABLE: manual save with no extension check
def upload(request):
    f = request.FILES['file']
    with open(f'media/uploads/{f.name}', 'wb+') as dest:
        for chunk in f.chunks():
            dest.write(chunk)

# SECURE: custom validator on FileField
def validate_file_extension(value):
    ext = os.path.splitext(value.name)[1].lower()
    if ext not in ['.png', '.jpg', '.jpeg', '.gif']:
        raise ValidationError('Unsupported file extension.')

class DocumentForm(forms.ModelForm):
    upload = forms.FileField(validators=[validate_file_extension])
```

### Node.js — Multer (Express)

```javascript
// VULNERABLE: no file filter, stored in public directory
const upload = multer({ dest: 'public/uploads/' });
app.post('/upload', upload.single('file'), (req, res) => {
    res.send('uploaded');
});

// VULNERABLE: MIME type filter only (can be faked)
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(null, false);
        cb(null, true);
    }
});

// SECURE: allowlist of extensions + storage outside web root
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif'];
const storage = multer.diskStorage({
    destination: '/var/uploads',  // not served by Express
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, ALLOWED_EXT.includes(ext));
    }
});
```

### PHP

```php
// VULNERABLE: no extension check, stored in web root
move_uploaded_file($_FILES['file']['tmp_name'], 'uploads/' . $_FILES['file']['name']);

// VULNERABLE: checking only content type header
if ($_FILES['file']['type'] !== 'image/jpeg') {
    die('Invalid file type');
}
move_uploaded_file($_FILES['file']['tmp_name'], 'uploads/' . $_FILES['file']['name']);

// VULNERABLE: blocklist missing phtml/phar
$ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
$blocked = ['php', 'sh', 'py'];
if (in_array($ext, $blocked)) die('Blocked');
move_uploaded_file($_FILES['file']['tmp_name'], 'uploads/' . $_FILES['file']['name']);

// SECURE: allowlist + rename to UUID + outside web root
$allowed = ['jpg', 'jpeg', 'png', 'gif'];
$ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
if (!in_array($ext, $allowed)) die('Invalid extension');
$stored = '/var/uploads/' . bin2hex(random_bytes(16)) . '.' . $ext;
move_uploaded_file($_FILES['file']['tmp_name'], $stored);
```

### Java — Spring Boot (MultipartFile)

```java
// VULNERABLE: no validation, stored in web-accessible path
@PostMapping("/upload")
public String upload(@RequestParam("file") MultipartFile file) throws IOException {
    Path path = Paths.get("src/main/resources/static/uploads/" + file.getOriginalFilename());
    Files.write(path, file.getBytes());
    return "uploaded";
}

// VULNERABLE: content type header only
@PostMapping("/upload")
public String upload(@RequestParam("file") MultipartFile file) throws IOException {
    if (!file.getContentType().startsWith("image/")) throw new BadRequestException();
    Files.write(Paths.get("uploads/" + file.getOriginalFilename()), file.getBytes());
    return "uploaded";
}

// SECURE: allowlist + UUID rename + path outside web root
private static final Set<String> ALLOWED = Set.of("jpg", "jpeg", "png", "gif");

@PostMapping("/upload")
public String upload(@RequestParam("file") MultipartFile file) throws IOException {
    String original = StringUtils.cleanPath(file.getOriginalFilename());
    String ext = FilenameUtils.getExtension(original).toLowerCase();
    if (!ALLOWED.contains(ext)) throw new BadRequestException("Invalid extension");
    String stored = UUID.randomUUID() + "." + ext;
    Files.write(Paths.get("/var/uploads/" + stored), file.getBytes());
    return "uploaded";
}
```

### Go

```go
// VULNERABLE: no extension check, stored in static directory
func uploadHandler(w http.ResponseWriter, r *http.Request) {
    file, header, _ := r.FormFile("file")
    defer file.Close()
    dst, _ := os.Create("static/uploads/" + header.Filename)
    defer dst.Close()
    io.Copy(dst, file)
}

// SECURE: allowlist extension + UUID rename + outside web root
var allowed = map[string]bool{"jpg": true, "jpeg": true, "png": true, "gif": true}

func uploadHandler(w http.ResponseWriter, r *http.Request) {
    file, header, _ := r.FormFile("file")
    defer file.Close()
    ext := strings.ToLower(filepath.Ext(header.Filename))
    if ext == "" || !allowed[ext[1:]] {
        http.Error(w, "invalid extension", http.StatusBadRequest)
        return
    }
    stored := "/var/uploads/" + uuid.New().String() + ext
    dst, _ := os.Create(stored)
    defer dst.Close()
    io.Copy(dst, file)
}
```

### Ruby on Rails

```ruby
# VULNERABLE: no content type or extension validation
def upload
  file = params[:file]
  File.open(Rails.root.join('public', 'uploads', file.original_filename), 'wb') do |f|
    f.write(file.read)
  end
end

# SECURE: ActiveStorage with content type allowlist (Rails 6+)
has_one_attached :avatar
validates :avatar, content_type: ['image/png', 'image/jpg', 'image/jpeg']
# Note: still validate extension too — content_type is user-supplied in some configurations

# SECURE: CarrierWave with extension and content type allowlist
class AvatarUploader < CarrierWave::Uploader::Base
  def extension_allowlist
    %w[jpg jpeg png gif]
  end

  def content_type_allowlist
    /image\//
  end
end
```

### C# — ASP.NET Core

```csharp
// VULNERABLE: no extension check, stored in wwwroot
[HttpPost]
public async Task<IActionResult> Upload(IFormFile file) {
    var path = Path.Combine("wwwroot/uploads", file.FileName);
    using var stream = new FileStream(path, FileMode.Create);
    await file.CopyToAsync(stream);
    return Ok();
}

// SECURE: allowlist + GUID rename + outside web root
private static readonly HashSet<string> _allowed = new() { ".jpg", ".jpeg", ".png", ".gif" };

[HttpPost]
public async Task<IActionResult> Upload(IFormFile file) {
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!_allowed.Contains(ext)) return BadRequest("Invalid extension");
    var stored = Path.Combine("/var/uploads", $"{Guid.NewGuid()}{ext}");
    using var stream = new FileStream(stored, FileMode.Create);
    await file.CopyToAsync(stream);
    return Ok();
}
```

## Verify heuristics (bypass vector analysis)

**Goal**: For each upload site, determine whether an attacker can upload a malicious file
(e.g., a PHP web shell, a JSP shell, a Python script) by manipulating the filename,
extension, or Content-Type header.

**Patterns that reduce risk** — if you see a strong combination (allowlist, sanitization,
non-web-root storage, UUID rename), the site is likely **Not Vulnerable** unless bypass
still applies.

**For each upload site, evaluate the following bypass vectors**:

1. **No extension check**: No validation of any kind on the filename or extension. Any file is accepted. Immediately record as a `[FINDING]` with `**Confidence:** high`.

2. **Content-Type / MIME header only**: Validation reads `Content-Type` or `mimetype` from the request headers but does not inspect the actual filename extension or file bytes. Attackers can set `Content-Type: image/png` while uploading `shell.php`. Record as a `[FINDING]` with `**Confidence:** high`.

3. **Blocklist-based validation**: An explicit list of forbidden extensions. Check whether the blocklist is exhaustive for the server's technology:
   - **PHP servers**: Are `.php3`, `.php4`, `.php5`, `.php7`, `.phtml`, `.phar`, `.shtml` also blocked? If any are missing, record as a `[FINDING]` with `**Confidence:** high`.
   - **Java servers**: Are `.jsp`, `.jspx`, `.jsw`, `.jsv`, `.jspf` also blocked?
   - **ASP.NET servers**: Are `.asp`, `.aspx`, `.ashx`, `.asmx`, `.cer`, `.asa` also blocked?
   - **Node.js**: Is `.js` execution possible via the server config? Check if `.js` files in the upload dir can be required/executed.
   - Any blocklist is inherently weaker than an allowlist — record as a `[FINDING]` with `**Confidence:** medium` even if seemingly complete.

4. **Case sensitivity bypass**: Blocking `.php` but not `.PHP`, `.Php`, `.pHp`. Check whether the comparison uses `.toLowerCase()` / `.lower()` / `strtolower()` / case-insensitive matching.

5. **Double extension / multi-extension**: `shell.php.jpg` — if the code extracts the extension using a method that takes the last segment after the last dot, this should be caught by an allowlist. However, on Apache servers with `AddHandler` misconfig, the leftmost recognized extension may be used for execution. Check how the extension is extracted:
   - Safe: `filename.rsplit('.', 1)[-1]`, `path.extname(filename)` (takes the last extension)
   - Risky server config: Apache `AddHandler application/x-httpd-php .php` — even `shell.php.jpg` may be executed as PHP

6. **Path traversal in filename**: If the original filename is used in the storage path without sanitization, `../../webroot/shell.php` can place files in unintended directories. Check for:
   - Use of `secure_filename()`, `basename()`, `path.basename()`, `Path.GetFileName()`, or `filepath.Base()` — these strip directory separators and are safe
   - Direct use of `file.filename`, `header.Filename`, `file.getOriginalFilename()`, `$_FILES['name']` in a path join without sanitization — record as a `[FINDING]` with `**Confidence:** high`

7. **File stored in web-executable directory**: Even with a correct extension allowlist, if uploads go to a directory served by the web server (e.g., `static/uploads/`, `public/uploads/`, `wwwroot/uploads/`) and the web server is configured to execute scripts, a bypass in extension validation becomes critical. Note whether the storage path is web-accessible.

8. **No content-based validation (magic bytes)**: The server trusts the extension without verifying the actual file content. A file named `shell.jpg` with PHP code inside is still dangerous if the extension check can be bypassed and the server executes it. Note absence of magic-byte checking as a contributing weakness.

**Confidence selection** (report every upload site as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: No validation at all, or a clearly bypassable check (content-type only, missing common extensions in blocklist, missing `.lower()`, path traversal in filename).
- **Medium confidence**: Blocklist that appears complete but is inherently weaker than an allowlist; an allowlist with potential edge cases (e.g., does not account for uppercase extensions); or validation logic in a shared helper/middleware that could not be fully read, or a dynamic storage path that could not be determined.
- **Low confidence**: Strict allowlist of safe extensions (applied case-insensitively), combined with filename sanitization and/or server-generated UUID rename, files stored outside web root or behind a controlled download endpoint — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "No extension validation — any file type accepted" or "Content-Type header used as sole check"]
- **Bypass vector**: [Exact technique — e.g., "Upload shell.php directly" or "Set Content-Type: image/png while uploading a .php file" or "Use .phtml extension not covered by blocklist"]
- **Storage path**: [Where the file lands — web-accessible or not]
- **Impact**: [e.g., "Attacker uploads PHP web shell and achieves RCE by accessing /uploads/shell.php"]
- **Remediation**: [Specific fix — switch to allowlist, add `.lower()`, use secure_filename, move storage outside web root]
- **Dynamic Test**:
  ```
  [curl or HTTP request demonstrating the bypass.
   Example: curl -X POST https://app.example.com/upload \
     -F "file=@shell.php;type=image/png" \
     then access: https://app.example.com/static/uploads/shell.php?cmd=id]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "Blocklist-based extension check — inherently incomplete"]
- **Bypass vector**: [Possible bypass — e.g., "Try .phtml, .phar, .php5 if server is Apache/PHP"]
- **Storage path**: [Where the file lands]
- **Concern**: [Why it's still a risk]
- **Remediation**: [Replace blocklist with allowlist]
- **Dynamic Test**:
  ```
  [payload to attempt bypass]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "Strict allowlist of png/jpg/gif with .lower(), UUID rename, stored outside web root"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [Why validation logic or storage path could not be determined]
- **Suggestion**: [What to trace manually]
```

An allowlist is always stronger than a blocklist. Any blocklist-based approach should be recorded as at minimum a `[FINDING]` with `**Confidence:** medium` because blocklists are almost always incomplete.

Content-Type (MIME type from the HTTP header) is **fully attacker-controlled** — never treat it as a security control.

Case sensitivity matters: `.PHP` bypasses a check for `.php` if `.toLowerCase()` is missing. Always check.

Path traversal in filenames is a separate attack vector from extension bypass — check for both.

Even a correct extension check is weakened if the file is stored in a web-executable directory. Note storage location in every finding.

Magic byte checking (reading actual file bytes) is defense-in-depth but does not replace extension allowlisting — a valid image with PHP code appended can still be dangerous.
