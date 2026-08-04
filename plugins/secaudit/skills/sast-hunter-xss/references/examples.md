# XSS — Concept, Examples, and Verify Heuristics

## What is XSS

XSS occurs when user-supplied input is incorporated into a web page's HTML, JavaScript, or DOM without proper escaping or sanitization. This allows attackers to inject and execute arbitrary scripts in victims' browsers, leading to session hijacking, credential theft, defacement, and malware distribution.

The core pattern: *unescaped, unsanitized user input reaches an HTML/JS output sink.*

### XSS Types

- **Reflected XSS**: User input is immediately echoed back in the HTTP response (e.g., a search term rendered directly into the page HTML).
- **Stored XSS**: User input is saved to persistent storage (database, file) and later rendered in HTML for other users.
- **DOM-based XSS**: Client-side JavaScript reads from an attacker-controlled source (`location.search`, `location.hash`, `document.cookie`) and writes to a dangerous DOM sink (`innerHTML`, `eval`, `document.write`) without server involvement.

### What XSS IS

**Server-side HTML sinks** — rendering user data into HTML responses without escaping:
- Python/Jinja2: `{{ var | safe }}`, `{% autoescape off %}...{{ var }}...{% endautoescape %}`
- Python/Django: `mark_safe(var)`, `format_html(...)` with `%s` and unescaped input, `{{ var | safe }}` in templates
- Python/Flask: `Markup(var)`, `render_template_string(f"...{var}...")`
- PHP: `echo $var`, `print $var`, `<?= $var ?>` without `htmlspecialchars()`
- Ruby/Rails: `raw(var)`, `var.html_safe`, `<%= raw var %>`, `content_tag` with `.html_safe`
- Java/JSP: `<%= var %>`, `${var}` without `<c:out>` or `fn:escapeXml()`
- Java/Thymeleaf: `th:utext="${var}"` (unescaped), `[(${var})]`
- Go/html-template misuse: using `template.HTML(var)`, `template.JS(var)`, `template.URL(var)` to bypass auto-escaping
- C#/Razor: `@Html.Raw(var)`, `MvcHtmlString.Create(var)`
- Node.js/EJS: `<%- var %>` (unescaped), vs `<%= var %>` (safe)
- Node.js/Handlebars: `{{{ var }}}` (triple-brace, unescaped)
- Node.js/Pug: `!{var}` (unescaped)
- Express: `res.send("<html>..." + var + "...")`, `res.write("<p>" + var + "</p>")`

**Client-side DOM sinks** — JavaScript writing user-controlled data to the DOM unsafely:
- `element.innerHTML = var`
- `element.outerHTML = var`
- `document.write(var)`, `document.writeln(var)`
- `element.insertAdjacentHTML('beforeend', var)`
- jQuery: `$(element).html(var)`, `$(element).append(var)` (when var contains HTML), `$('<div>' + var + '</div>')`
- React: `dangerouslySetInnerHTML={{ __html: var }}`
- Angular: `[innerHTML]="var"`, `bypassSecurityTrustHtml(var)`, `bypassSecurityTrustScript(var)`, `bypassSecurityTrustUrl(var)`
- Vue: `v-html="var"`

**JavaScript execution sinks** — user-controlled data evaluated as code:
- `eval(var)`
- `setTimeout(var, delay)` / `setInterval(var, delay)` when `var` is a string
- `new Function(var)()`
- `element.setAttribute('onclick', var)`, `element.setAttribute('href', 'javascript:' + var)`
- `location.href = var`, `location.replace(var)`, `location.assign(var)` (when var is user-controlled and can be `javascript:...`)
- `element.src = var`, `element.action = var` (script injection via `javascript:` URIs)
- `scriptElement.text = var`, `scriptElement.textContent = var`

**DOM-based sources** — attacker-controlled inputs read by client-side JavaScript:
- `location.search` (URL query string)
- `location.hash` (URL fragment)
- `location.href`
- `document.referrer`
- `document.URL`, `document.documentURI`
- `document.cookie`
- `postMessage` event data (`event.data`)
- `window.name`
- `localStorage.getItem(...)`, `sessionStorage.getItem(...)` (if populated from URL or postMessage)

### What XSS is NOT

Do not flag these as XSS:

- **CSRF**: Forging requests on behalf of a user — a separate vulnerability class
- **SQLi via XSS**: Injecting SQL through an XSS vector — the SQL injection itself is the primary finding
- **Clickjacking**: Embedding pages in iframes — different vulnerability class
- **Header injection**: Injecting newlines into HTTP response headers — separate class (HTTP Response Splitting)
- **Safe template output**: Auto-escaped `{{ var }}` in Jinja2/Django/Twig/Blade/Handlebars double-brace syntax with auto-escaping on — these are safe
- **`textContent` / `innerText`**: These write plain text only; no HTML parsing occurs — safe

### Patterns That Prevent XSS

When you see these patterns, the code is likely **not vulnerable**:

**1. Context-aware auto-escaping (most template engines default)**
```
# Jinja2 / Django (auto-escape on by default)
{{ var }}          # HTML-escaped → safe

# EJS
<%= var %>         # HTML-escaped → safe

# Handlebars
{{ var }}          # HTML-escaped → safe

# Pug
= var              # HTML-escaped → safe

# Thymeleaf
th:text="${var}"   # HTML-escaped → safe

# Razor (C#)
@var               # HTML-encoded → safe
```

**2. Explicit escaping before output**
```php
// PHP
echo htmlspecialchars($var, ENT_QUOTES, 'UTF-8');
```
```ruby
# Rails
<%= h(var) %>
<%= ERB::Util.html_escape(var) %>
```
```java
// JSP with JSTL
<c:out value="${var}"/>
// or fn:escapeXml()
${fn:escapeXml(var)}
```
```go
// html/template — auto-escapes by context (HTML, JS, URL, CSS)
{{.Var}}   // safe inside html/template
```

**3. DOM manipulation using safe properties**
```javascript
element.textContent = userInput;   // plain text, no HTML parsing — safe
element.innerText = userInput;     // plain text — safe
```

**4. Sanitization with an allowlisted HTML library**
```javascript
// DOMPurify
element.innerHTML = DOMPurify.sanitize(userInput);

// sanitize-html with strict config
const clean = sanitizeHtml(userInput, { allowedTags: [], allowedAttributes: {} });
```

**5. React / Angular / Vue auto-escaping**
```jsx
// React JSX — auto-escaped
return <div>{userInput}</div>;
```
```html
<!-- Angular — auto-escaped -->
<div>{{ userInput }}</div>
<!-- Vue — auto-escaped -->
<div>{{ userInput }}</div>
```

## Vulnerable vs. Secure Examples

### Python — Flask / Jinja2

```python
# VULNERABLE: Markup() bypasses Jinja2 auto-escaping
@app.route('/greet')
def greet():
    name = request.args.get('name', '')
    return render_template_string(f"<h1>Hello, {name}!</h1>")   # raw f-string, no template escaping

# VULNERABLE: mark_safe equivalent
@app.route('/profile')
def profile():
    bio = request.args.get('bio', '')
    return render_template('profile.html', bio=Markup(bio))      # Markup() marks it as safe, bypassing escaping

# SECURE: use template with auto-escaping (never pass Markup around user input)
@app.route('/greet')
def greet():
    name = request.args.get('name', '')
    return render_template('greet.html', name=name)              # template: {{ name }} — auto-escaped
```

### Python — Django

```python
# VULNERABLE: mark_safe() with user input
def user_bio(request):
    bio = request.GET.get('bio', '')
    safe_bio = mark_safe(bio)   # user input bypasses Django's auto-escaping
    return render(request, 'bio.html', {'bio': safe_bio})

# SECURE: pass raw string; template handles escaping
def user_bio(request):
    bio = request.GET.get('bio', '')
    return render(request, 'bio.html', {'bio': bio})   # template: {{ bio }} — auto-escaped
```

### PHP

```php
// VULNERABLE: echo without escaping
function showUsername($username) {
    echo "<p>Welcome, " . $username . "</p>";
}

// SECURE: htmlspecialchars
function showUsername($username) {
    echo "<p>Welcome, " . htmlspecialchars($username, ENT_QUOTES, 'UTF-8') . "</p>";
}
```

### Node.js — Express (string concatenation)

```javascript
// VULNERABLE: user input concatenated into HTML response
app.get('/search', (req, res) => {
  const query = req.query.q;
  res.send(`<h1>Results for: ${query}</h1>`);
});

// SECURE: use a template engine with auto-escaping, or escape manually
const escapeHtml = require('escape-html');
app.get('/search', (req, res) => {
  const query = req.query.q;
  res.send(`<h1>Results for: ${escapeHtml(query)}</h1>`);
});
```

### Node.js / EJS

```html
<!-- VULNERABLE: unescaped output -->
<div><%- userInput %></div>

<!-- SECURE: escaped output -->
<div><%= userInput %></div>
```

### Node.js / Handlebars

```html
<!-- VULNERABLE: triple-brace, unescaped -->
<div>{{{ userInput }}}</div>

<!-- SECURE: double-brace, auto-escaped -->
<div>{{ userInput }}</div>
```

### JavaScript — DOM Sinks

```javascript
// VULNERABLE: innerHTML with URL fragment
const name = location.hash.substring(1);
document.getElementById('greeting').innerHTML = 'Hello, ' + name;

// SECURE: textContent
const name = location.hash.substring(1);
document.getElementById('greeting').textContent = 'Hello, ' + name;
```

```javascript
// VULNERABLE: eval with postMessage data
window.addEventListener('message', (event) => {
  eval(event.data);
});

// SECURE: parse and validate; never eval postMessage data
window.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  // handle data safely
});
```

### React

```jsx
// VULNERABLE: dangerouslySetInnerHTML with user input
function Comment({ content }) {
  return <div dangerouslySetInnerHTML={{ __html: content }} />;
}

// SECURE: render as text (auto-escaped by React)
function Comment({ content }) {
  return <div>{content}</div>;
}
```

### Angular

```typescript
// VULNERABLE: bypassing Angular's DomSanitizer
constructor(private sanitizer: DomSanitizer) {}
getUserHtml(input: string): SafeHtml {
  return this.sanitizer.bypassSecurityTrustHtml(input);  // unsafe if input is user-controlled
}
```

```html
<!-- VULNERABLE: [innerHTML] with unsanitized value -->
<div [innerHTML]="userInput"></div>

<!-- SECURE: use interpolation (auto-escaped) -->
<div>{{ userInput }}</div>
```

### Ruby on Rails

```erb
<%# VULNERABLE: raw() or html_safe with user input %>
<%= raw(@user.bio) %>
<%= @user.bio.html_safe %>

<%# SECURE: default ERB escaping %>
<%= @user.bio %>
```

### Java — JSP

```jsp
<%-- VULNERABLE: scriptlet echo --%>
<p>Hello, <%= request.getParameter("name") %></p>

<%-- VULNERABLE: EL without c:out --%>
<p>Hello, ${param.name}</p>

<%-- SECURE: c:out escaping --%>
<p>Hello, <c:out value="${param.name}"/></p>
```

### Go — html/template vs. text/template

```go
// VULNERABLE: using text/template (no HTML escaping)
import "text/template"
tmpl := template.Must(template.New("").Parse("<h1>Hello, {{.Name}}!</h1>"))
tmpl.Execute(w, data)

// VULNERABLE: using template.HTML() cast to bypass escaping
import "html/template"
name := template.HTML(r.URL.Query().Get("name"))   // bypasses auto-escaping

// SECURE: html/template with plain string value
import "html/template"
tmpl := template.Must(template.New("").Parse("<h1>Hello, {{.Name}}!</h1>"))
tmpl.Execute(w, data)   // .Name is a plain string — auto-escaped
```

## Verify heuristics (taint analysis)

For each sink candidate, trace the interpolated variable(s) backwards to their origin.

**User-controlled sources to look for:**

1. **HTTP request sources** (server-side):
   - Query parameters: `request.GET.get(...)`, `req.query.x`, `params[:x]`, `$_GET['x']`, `c.Query("x")`, `r.URL.Query().Get("x")`
   - Path parameters: `request.path_params['id']`, `req.params.id`, `params[:id]`, `$_GET['id']`
   - Request body / form fields: `request.POST.get(...)`, `req.body.x`, `request.form.get(...)`, `$_POST['x']`
   - HTTP headers: `request.headers.get(...)`, `req.headers['x']`, `$_SERVER['HTTP_X_CUSTOM']`
   - Cookies: `request.COOKIES.get(...)`, `req.cookies.x`, `$_COOKIE['x']`
   - File upload filenames or content: `request.files['x'].filename`

2. **Attacker-controlled DOM sources** (client-side / DOM-based XSS):
   - `location.search`, `location.hash`, `location.href`, `document.referrer`, `document.URL`
   - `window.name`, `document.cookie`
   - `postMessage` event: `window.addEventListener('message', (e) => { ... e.data ... })`
   - `URLSearchParams` values derived from `location.search`
   - `localStorage` / `sessionStorage` values written from URL or postMessage

3. **Stored (second-order) input** — the variable is read from persistent storage (database, file, cache), but the stored value originally came from user input:
   - Find the write path: where was this field stored? Was it user-supplied at write time?
   - Was any escaping or sanitization applied at write time? (Note: HTML-escaping at write time is fragile — it may be double-encoded or stripped elsewhere)
   - Stored XSS is still a vulnerability even if it was validated or stored safely; track whether the read-back path escapes before rendering

4. **Server-side / hardcoded value** — the variable comes from config, environment, a hardcoded constant, or server-side logic with no user influence — this site is NOT exploitable.

**For each sink site, also check for mitigations that would prevent exploitation**:
- Is the output explicitly escaped with a safe function just before the sink? (`htmlspecialchars()`, `escapeHtml()`, `h()`, `fn:escapeXml()`)
- Is a sanitization library applied with a strict allowlist config? (`DOMPurify.sanitize(input)` — check if the config strips scripts)
- Is the HTTP response `Content-Type` set to `application/json` or `text/plain` (no HTML rendering)?
- Is a Content Security Policy header present that blocks inline scripts? (CSP reduces impact but is not a full fix)
- Is there a WAF or input validation that strictly allowlists the expected format (e.g., a numeric ID)?

**Confidence selection** (report every sink as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the sink with no effective escaping or sanitization.
- **Medium confidence**: User input probably reaches the sink (indirect/stored flow) or only weak mitigation is present (CSP-only, WAF-only, partial sanitization, incomplete allowlist); or you cannot determine the variable's origin with confidence (opaque helpers, complex conditional flows, external libraries, or cross-service data flows).
- **Low confidence**: The variable is server-side only with no user influence, OR proper context-aware escaping is applied immediately before the sink — still record it rather than dropping it; downstream Challenge/Trace decide.

**Per-finding output fields** (used in the merged report):
- **File**, **Endpoint / function / component**, **XSS type** (Reflected / Stored / DOM-based)
- **Issue**: short description of the flow
- **Taint trace**: step-by-step from source to sink
- **Impact**: what an attacker can do — session hijacking, credential theft, keylogging, defacement, redirects to malicious sites
- **Remediation**: specific fix — escape with the correct function, switch to textContent, use auto-escaping template syntax, apply DOMPurify
- **Dynamic Test**: curl command or browser payload to confirm the finding (e.g., `curl "https://app.example.com/search?q=<script>alert(1)</script>"`, or visiting a hash-based payload URL and observing an alert)
- For low confidence: **Reason**. For medium-confidence uncertain flows: **Uncertainty** and **Suggestion**.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function / component**: [route, function, or component name]
- **XSS type**: [Reflected / Stored / DOM-based]
- **Issue**: [short description of the flow]
- **Taint trace**: [step-by-step from source to sink]
- **Impact**: [what an attacker can do — session hijacking, credential theft, keylogging, defacement, redirects to malicious sites]
- **Remediation**: [specific fix — escape with the correct function, switch to textContent, use auto-escaping template syntax, apply DOMPurify]
- **Dynamic Test**:
  ```
  [curl command or browser payload to confirm the finding, e.g. curl "https://app.example.com/search?q=<script>alert(1)</script>",
   or visiting a hash-based payload URL and observing an alert]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function / component**: [route, function, or component name]
- **XSS type**: [Reflected / Stored / DOM-based]
- **Issue**: [indirect/stored flow, or only weak mitigation present (CSP-only, WAF-only, partial sanitization, incomplete allowlist)]
- **Taint trace**: [best-effort trace; mark uncertain steps]
- **Concern**: [why it remains a risk]
- **Remediation**: [fix]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function / component**: [route, function, or component name]
- **Reason**: [e.g., "Server-side only, no user influence" or "Proper context-aware escaping applied"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function / component**: [route, function, or component name]
- **Uncertainty**: [why the variable's origin could not be determined]
- **Suggestion**: [what to trace manually]
```
