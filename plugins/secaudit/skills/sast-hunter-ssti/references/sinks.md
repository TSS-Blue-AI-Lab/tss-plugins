# SSTI — Recon Sink Catalog

Find every location in the codebase where a template engine renders, compiles, or
evaluates a **dynamically built string** as the template itself — rather than loading a
static template file.

**What to search for — vulnerable template rendering patterns**:

Flag any call where the first argument (the template string) is a variable, a
concatenated string, or any non-literal value. You are not yet checking whether that
variable comes from user input — that is Phase 2's job.

1. **Python — Jinja2 / Flask**:
   - `render_template_string(var)` — any non-literal argument
   - `Environment().from_string(var)` or `env.from_string(var)`
   - `jinja2.Template(var).render(...)`
   - `Template(var)` where Template is imported from jinja2

2. **Python — Mako**:
   - `Template(var).render(...)` where Template is from `mako.template`
   - `mako.template.Template(var)`

3. **Node.js — EJS**:
   - `ejs.render(var, ...)` or `ejs.renderFile(var, ...)` where var is not a static string literal

4. **Node.js — Nunjucks**:
   - `nunjucks.renderString(var, ...)` — any non-literal first argument
   - `env.renderString(var, ...)`

5. **Node.js — Handlebars**:
   - `Handlebars.compile(var)` — any non-literal argument
   - `Handlebars.precompile(var)`

6. **Node.js — Pug/Jade**:
   - `pug.render(var, ...)` — any non-literal argument
   - `pug.compile(var, ...)`

7. **Node.js — Lodash/Underscore**:
   - `_.template(var)` — any non-literal argument
   - `Handlebars.compile(var)`

8. **Node.js — Swig / Twig.js**:
   - `swig.render(var, ...)`
   - `twig({ data: var })`

9. **Ruby — ERB**:
   - `ERB.new(var).result(...)` — any non-literal argument
   - `ERB.new(var).result_with_hash(...)`

10. **Ruby — Liquid**:
    - `Liquid::Template.parse(var).render(...)` — any non-literal argument

11. **Java — FreeMarker**:
    - `new Template(name, new StringReader(var), cfg)` — var is not a literal
    - `cfg.getTemplate(var)` where var is not a literal (potential template path injection)

12. **Java — Velocity**:
    - `Velocity.evaluate(ctx, writer, logTag, var)` — any non-literal fourth argument
    - `ve.evaluate(ctx, writer, logTag, var)`

13. **Java — StringTemplate / ST4**:
    - `new ST(var)` — any non-literal argument
    - `new STGroup(var, ...)` with non-literal path

14. **Java — Thymeleaf**:
    - Controller methods returning a view name built by string concatenation: `return "user/" + var + "/page"` or `return String.format("prefix/%s/suffix", var)`
    - `templateEngine.process(var, ctx)` with non-literal var

15. **PHP — Twig**:
    - `$twig->createTemplate($var)->render(...)` — any non-literal argument
    - `$environment->createTemplate($var)`

16. **PHP — Smarty**:
    - `$smarty->fetch("string:" . $var)` or `$smarty->display("string:" . $var)`
    - `$smarty->fetch($var)` where var may contain a "string:" prefix

17. **PHP — Blade / Laravel**:
    - `Blade::render($var, ...)` — any non-literal argument
    - `\Illuminate\Support\Facades\View::make($var, ...)` with non-literal name (template path injection)

18. **Go — text/template or html/template**:
    - `template.New(name).Parse(var)` — any non-literal argument to Parse
    - `t.Parse(var)` on any template variable
    - `t.ParseFiles(var)` with non-literal var (template path injection)

19. **C# — Scriban / Handlebars.Net / DotLiquid / Fluid**:
    - `Template.Parse(var)` (Scriban) — non-literal
    - `Handlebars.Compile(var)` — non-literal
    - `DotLiquid.Template.Parse(var)` — non-literal
    - `FluidParser.TryParse(var, ...)` — non-literal

## What to skip (safe patterns — do not flag)

- Calls where the first argument is a **string literal**: `render_template_string("<h1>Hello</h1>")`, `ejs.render("<p>static</p>", ctx)`
- Calls where a file path is loaded from a trusted constant and user input only appears in context: `render_template("profile.html", user=user_obj)`
- Template engine configuration calls that do not render user-supplied content: `env = Environment(loader=FileSystemLoader("templates/"))`

## Recon output — record each candidate as

```markdown
### 1. [Descriptive name — e.g., "render_template_string in /greet endpoint"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Template engine**: [Jinja2 / EJS / Handlebars / FreeMarker / Twig / ERB / etc.]
- **Rendering call**: [render_template_string / from_string / ejs.render / Handlebars.compile / etc.]
- **Dynamic argument**: `var_name` — [brief note on what it appears to represent, e.g., "looks like it comes from a form field" or "unknown origin"]
- **Code snippet**:
  ```
  [the rendering call with the dynamic argument]
  ```
```
