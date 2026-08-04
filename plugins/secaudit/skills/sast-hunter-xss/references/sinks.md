# XSS — Recon Sink Catalog

Find every location in the codebase where data is rendered into HTML, JavaScript, or the
DOM in a way that could allow script injection — any unescaped or explicitly-marked-safe
output, any dangerous DOM property assignment, any JavaScript execution sink.

**What to search for — vulnerable sink patterns**:

Flag ANY dynamic variable passed to a dangerous output sink. You are not yet checking
whether the variable is user-controlled — that is Phase 2's job.

**1. Server-side template unescaped output**:
   - Jinja2/Django: `{{ var | safe }}`, `{% autoescape off %}`, `Markup(var)`, `mark_safe(var)`, `format_html(...)` with direct user-controlled format args
   - EJS: `<%- var %>`
   - Handlebars/Mustache: `{{{ var }}}`
   - Pug: `!{var}`
   - Thymeleaf: `th:utext="${var}"`, `[(${var})]`
   - Twig: `{{ var | raw }}`
   - Blade (Laravel): `{!! $var !!}`
   - Rails ERB: `raw(var)`, `var.html_safe`, `<%= raw var %>`
   - PHP: `echo $var`, `print $var`, `<?= $var ?>` without `htmlspecialchars()`
   - Go: `template.HTML(var)`, `template.JS(var)`, `template.URL(var)`, usage of `text/template` for HTML output
   - C#/Razor: `@Html.Raw(var)`, `MvcHtmlString.Create(var)`

**2. Direct HTML string construction in server-side code**:
   - String concatenation or interpolation building an HTML response: `res.send("<p>" + var + "</p>")`, `f"<h1>{var}</h1>"`, `"<div>" + var + "</div>"`
   - `render_template_string(f"...{var}...")` in Flask

**3. Client-side DOM sinks**:
   - `element.innerHTML = var`
   - `element.outerHTML = var`
   - `document.write(var)`, `document.writeln(var)`
   - `element.insertAdjacentHTML(position, var)`
   - jQuery: `$(el).html(var)`, `$(el).append(var)`, `$('<tag>' + var + '</tag>')`, `$.parseHTML(var)` passed to DOM
   - React: `dangerouslySetInnerHTML={{ __html: var }}`
   - Angular: `[innerHTML]="var"`, `bypassSecurityTrustHtml(var)`, `bypassSecurityTrustScript(var)`, `bypassSecurityTrustUrl(var)`, `bypassSecurityTrustStyle(var)`, `bypassSecurityTrustResourceUrl(var)`
   - Vue: `v-html="var"`

**4. JavaScript execution sinks**:
   - `eval(var)`
   - `setTimeout(var, ...)` / `setInterval(var, ...)` where `var` is a string variable (not a function reference)
   - `new Function(var)()`
   - `scriptElement.text = var`, `scriptElement.textContent = var`
   - `element.setAttribute('onclick', var)`, `element.setAttribute('href', 'javascript:' + var)`, and similar event-handler attribute assignments
   - URL-based sinks where `javascript:` URIs could execute: `location.href = var`, `location.replace(var)`, `element.src = var`, `element.action = var`

**5. DOM-based XSS patterns** — client-side code reading from attacker-controlled sources and passing to any sink above:
   - Reading from: `location.search`, `location.hash`, `location.href`, `document.referrer`, `document.URL`, `document.cookie`, `window.name`, `postMessage` handler (`event.data`), `URLSearchParams`
   - Then passing to an HTML or JS sink without escaping

## What to skip (safe — do not flag)

- Auto-escaped template output: `{{ var }}` in Jinja2 (auto-escape on), `<%= var %>` in EJS, `{{ var }}` in Handlebars double-brace, `@var` in Razor, `th:text` in Thymeleaf
- `element.textContent = var` and `element.innerText = var` — no HTML parsing, safe
- React JSX `{var}` — auto-escaped
- Angular `{{ var }}` interpolation — auto-escaped
- Vue `{{ var }}` interpolation — auto-escaped
- `DOMPurify.sanitize(var)` wrapping an innerHTML assignment — typically safe (verify config)
- `sanitize-html`, `xss`, or similar allowlist sanitizer library wrapping output

## Recon output — record each candidate as

```markdown
### 1. [Descriptive name — e.g., "innerHTML assignment in search results handler"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint / component**: [function name, route, or component]
- **Sink type**: [server-side template / HTML string concat / DOM innerHTML / eval / JS execution sink / DOM-based source-to-sink]
- **Sink call**: [the exact API or property used — e.g., `innerHTML`, `mark_safe()`, `<%- %>`]
- **Interpolated variable(s)**: `var_name` — [brief note, e.g., "unknown origin" or "looks like user profile field"]
- **XSS type**: [Reflected / Stored / DOM-based — best guess at this stage]
- **Code snippet**:
  ```
  [the vulnerable sink code]
  ```
```
