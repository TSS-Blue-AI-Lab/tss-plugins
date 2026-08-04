# File Upload — Recon Sink Catalog

Find every location in the codebase where files uploaded by users are received and stored.
Look for any code that receives a file from an HTTP request and writes or stores it. Do not
yet evaluate whether validation is present — just find all the sites (that is the verify
phase's job).

## File upload handling patterns

1. **Python / Django**:
   - `request.FILES` access
   - `InMemoryUploadedFile`, `TemporaryUploadedFile`
   - `default_storage.save(...)`, `FileSystemStorage().save(...)`
   - Model `FileField` / `ImageField` form submissions
   - `shutil.copyfileobj(f, dest)` or manual `.write(f.read())` on uploaded data

2. **Python / Flask**:
   - `request.files.get(...)` or `request.files[...]`
   - `file.save(...)` calls on a `FileStorage` object
   - `werkzeug` `FileStorage` handling

3. **Node.js**:
   - `multer` middleware: `upload.single(...)`, `upload.array(...)`, `upload.fields(...)`
   - `busboy`, `formidable`, `multiparty` form parsing
   - `express-fileupload`: `req.files`
   - `fs.writeFile` / `fs.createWriteStream` / `pipe()` called with a request stream

4. **PHP**:
   - `$_FILES` access
   - `move_uploaded_file(...)` calls
   - `copy($_FILES[...]['tmp_name'], ...)`

5. **Java / Spring**:
   - `MultipartFile` parameters in controller methods: `@RequestParam MultipartFile`
   - `CommonsMultipartFile`, `StandardMultipartFile`
   - `Part.write(...)` (Servlet API)
   - `file.transferTo(...)`, `Files.write(path, file.getBytes())`

6. **Go**:
   - `r.FormFile(...)` or `r.MultipartForm.File`
   - `io.Copy(dst, file)` where `file` comes from a multipart form
   - `os.Create(...)` called with a filename derived from `header.Filename`

7. **Ruby / Rails**:
   - `params[:file]` with `.read`, `.original_filename`, `.tempfile`
   - `File.open(..., 'wb')` called with uploaded data
   - `has_one_attached` / `has_many_attached` (ActiveStorage)
   - CarrierWave `mount_uploader`, Shrine `include Shrine::Attachment`

8. **C# / ASP.NET**:
   - `IFormFile` parameters: `file.CopyToAsync(...)`, `file.OpenReadStream()`
   - `HttpPostedFileBase.SaveAs(...)`
   - `Request.Files[...]`

## Recon output — record each candidate as

```markdown
# File Upload Recon: [Project Name]

## Summary
Found [N] file upload sites.

## Upload Sites

### 1. [Descriptive name — e.g., "Avatar upload endpoint"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Framework / method**: [e.g., Flask request.files / multer / move_uploaded_file]
- **Storage destination**: [path, variable, or storage abstraction — e.g., "static/uploads/" or "S3 via boto3" or "unknown"]
- **Validation observed** (preliminary, verify phase will analyze in depth): [list any extension checks, content-type checks, or "none visible"]
- **Code snippet**:
  ```
  [the upload receive and save code]
  ```

[Repeat for each site]
```
