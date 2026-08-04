# SSRF — Concept, Examples, and Verify Heuristics

## What is SSRF

SSRF occurs when an attacker can cause the server to make outbound network requests to an arbitrary destination — including internal services, cloud metadata endpoints, or other external targets — by supplying or influencing the URL, hostname, IP, or port used in a server-side request.

The core pattern: *unvalidated, user-controlled input reaches the destination argument of an outbound network call.*

### What SSRF IS

- HTTP client calls where the URL or host is built from user input: `requests.get(user_url)`
- Fetching a resource whose location is provided by the client: `fetch(req.body.webhook_url)`
- DNS lookups on a hostname supplied by the user: `dns.lookup(req.query.host)`
- Raw TCP connections to a host/port derived from user input: `socket.connect((user_host, user_port))`
- File-fetching functions used with HTTP/FTP URLs from user input: `file_get_contents($user_url)`
- URL redirectors that forward to a user-supplied destination without validation
- Webhooks, import-from-URL, screenshot services, PDF renderers, image proxies — any feature that fetches a remote resource on behalf of the user

### What SSRF is NOT

Do not flag these:

- **Open redirects**: Redirecting the browser (HTTP 302) to a user-supplied URL — that's a client-side redirect, not a server-side request
- **XSS via URL**: Rendering a user-supplied URL in an `<a>` tag without escaping — that's XSS
- **IDOR**: Accessing another user's data by changing an object ID — separate vulnerability class
- **Hardcoded outbound calls**: HTTP requests to fixed, fully hardcoded URLs with no user influence — not SSRF

### Patterns That Prevent SSRF

When you see these patterns, the code is likely **not vulnerable**:

**1. Strict allowlist of permitted destinations**
```python
ALLOWED_HOSTS = {"api.example.com", "cdn.example.com"}
parsed = urlparse(user_url)
if parsed.hostname not in ALLOWED_HOSTS:
    raise ValueError("Destination not allowed")
requests.get(user_url)
```

**2. Allowlist of permitted URL prefixes / schemes**
```python
ALLOWED_PREFIXES = ["https://api.example.com/", "https://cdn.example.com/"]
if not any(user_url.startswith(p) for p in ALLOWED_PREFIXES):
    abort(400)
requests.get(user_url)
```

**3. No user influence on the destination**
```python
# Destination fully hardcoded — no user input involved
response = requests.get("https://api.thirdparty.com/data")
```

> **Note**: IP blocklists (blocking 169.254.0.0/16, 10.0.0.0/8, etc.) are **not** sufficient protection — they can be bypassed via DNS rebinding, URL encoding, IPv6 notation, decimal IP representation, or redirect chains. Do not treat a blocklist as making a site safe; record it as a `[FINDING]` with `**Confidence:** medium`.

## Vulnerable vs. Secure Examples

### Python — requests

```python
# VULNERABLE: URL fully controlled by user
@app.route('/fetch')
def fetch():
    url = request.args.get('url')
    response = requests.get(url)
    return response.text

# SECURE: strict allowlist on destination host
ALLOWED = {"api.example.com"}
@app.route('/fetch')
def fetch():
    url = request.args.get('url')
    if urlparse(url).hostname not in ALLOWED:
        abort(403)
    response = requests.get(url)
    return response.text
```

### Python — urllib

```python
# VULNERABLE: user controls the URL passed to urlopen
def preview(request):
    target = request.GET.get('target')
    data = urllib.request.urlopen(target).read()
    return HttpResponse(data)

# SECURE: only allow https scheme to a hardcoded host
def preview(request):
    target = request.GET.get('target')
    parsed = urlparse(target)
    if parsed.scheme != 'https' or parsed.hostname != 'media.example.com':
        return HttpResponse(status=400)
    data = urllib.request.urlopen(target).read()
    return HttpResponse(data)
```

### Node.js — fetch / axios

```javascript
// VULNERABLE: webhook URL comes directly from request body
app.post('/webhook/test', async (req, res) => {
  const { url } = req.body;
  const result = await fetch(url);
  res.json(await result.json());
});

// SECURE: allowlist check before fetch
const ALLOWED_HOSTS = new Set(['hooks.example.com']);
app.post('/webhook/test', async (req, res) => {
  const { url } = req.body;
  const { hostname } = new URL(url);
  if (!ALLOWED_HOSTS.has(hostname)) return res.status(403).send('Forbidden');
  const result = await fetch(url);
  res.json(await result.json());
});
```

### Node.js — http.request

```javascript
// VULNERABLE: host and path from query string
app.get('/proxy', (req, res) => {
  const { host, path } = req.query;
  http.get({ host, path }, (proxyRes) => proxyRes.pipe(res));
});
```

### Ruby on Rails — Net::HTTP / OpenURI

```ruby
# VULNERABLE: open() fetches arbitrary URL
def import
  url = params[:url]
  content = URI.open(url).read  # also triggers for open(url) via Kernel#open
  # ...
end

# SECURE: restrict scheme and host
def import
  url = params[:url]
  uri = URI.parse(url)
  raise "Forbidden" unless uri.is_a?(URI::HTTPS) && uri.host == "data.example.com"
  content = uri.open.read
  # ...
end
```

### PHP — cURL

```php
// VULNERABLE: user-supplied URL piped into curl
function fetch_preview($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $result = curl_exec($ch);
    curl_close($ch);
    return $result;
}
// Called as: fetch_preview($_GET['url'])

// SECURE: validate URL against allowlist before curl
function fetch_preview($url) {
    $allowed = ['https://cdn.example.com/'];
    foreach ($allowed as $prefix) {
        if (strpos($url, $prefix) === 0) {
            // ... proceed with curl
        }
    }
    throw new Exception("Destination not allowed");
}
```

### PHP — file_get_contents

```php
// VULNERABLE: file_get_contents with http:// wrapper and user input
$url = $_GET['source'];
$data = file_get_contents($url);  // fetches remote URL if scheme is http/https/ftp
```

### Java — Spring / OkHttp

```java
// VULNERABLE: RestTemplate with user-controlled URL
@GetMapping("/proxy")
public ResponseEntity<String> proxy(@RequestParam String url) {
    RestTemplate restTemplate = new RestTemplate();
    return restTemplate.getForEntity(url, String.class);
}

// VULNERABLE: OkHttp with user-controlled host
public String fetch(String host, String path) {
    Request request = new Request.Builder()
        .url("https://" + host + path)
        .build();
    return client.newCall(request).execute().body().string();
}
```

### Go — net/http

```go
// VULNERABLE: user-supplied URL passed to http.Get
func proxyHandler(w http.ResponseWriter, r *http.Request) {
    target := r.URL.Query().Get("url")
    resp, err := http.Get(target)
    if err != nil {
        http.Error(w, err.Error(), 500)
        return
    }
    io.Copy(w, resp.Body)
}

// VULNERABLE: user controls host in net.Dial
func dialHandler(w http.ResponseWriter, r *http.Request) {
    host := r.URL.Query().Get("host")
    port := r.URL.Query().Get("port")
    conn, _ := net.Dial("tcp", host+":"+port)
    // ...
}
```

### C# — HttpClient

```csharp
// VULNERABLE: user-supplied URL passed to HttpClient
[HttpGet("proxy")]
public async Task<IActionResult> Proxy([FromQuery] string url)
{
    var response = await _httpClient.GetAsync(url);
    var content = await response.Content.ReadAsStringAsync();
    return Content(content);
}
```

## Verify heuristics (taint analysis)

SSRF occurs when user-controlled input reaches the destination argument of a server-side
outbound network call without an effective allowlist on where the server may connect.

**What SSRF is NOT** — do not flag these as SSRF:
- **Open redirects**: HTTP 302 to a user URL — client-side redirect, not a server-side request
- **XSS via URL**: User URL rendered in HTML without escaping — XSS
- **IDOR**: Object ID tampering — separate class
- **Fully hardcoded outbound URLs** with no user influence — not SSRF

**For each outbound call site, trace the destination argument(s) backwards to their origin**:

1. **Direct user input** — the destination is assigned directly from a request source with no transformation:
   - HTTP query params: `request.GET.get('url')`, `req.query.url`, `params[:url]`, `$_GET['url']`, `c.Query("url")`
   - Request body / JSON fields: `request.json['webhook_url']`, `req.body.target`, `params[:source]`
   - Path parameters: `req.params.host`, `params[:endpoint]`
   - HTTP headers: `request.headers.get('X-Forwarded-For')`, `req.headers['destination']`
   - Cookies: `req.cookies.redirect_url`

2. **Indirect / assembled destination** — the URL is built by concatenating a hardcoded prefix with a user-supplied suffix or path:
   - `"https://example.com/" + user_path` — may still be exploitable via path traversal or scheme injection depending on the HTTP client
   - `base_url + user_query` — user controls the query string, potentially injectable
   - Record these as a `[FINDING]` with `**Confidence:** medium` and note which portion is user-controlled

3. **User input stored and later fetched** — the destination was previously saved from user input (e.g., a stored webhook URL) and is now retrieved from the database to make a request:
   - Find where the stored value was written — was it accepted from user input without allowlist validation at write time?
   - Was any validation applied at read time before the request?

4. **Server-side / hardcoded value** — the destination comes from config, an environment variable, a hardcoded constant, or server-side logic with no user influence — this site is NOT exploitable.

**For each call site, also check for mitigations**:
- **Strict allowlist of hosts/prefixes**: A hardcoded set of permitted hostnames or URL prefixes that the destination is validated against before the request is made — this is an effective mitigation. Record as a `[FINDING]` with `**Confidence:** low`.
- **Scheme-only restriction** (e.g., only allow `https://`): Partial mitigation — reduces impact but does not prevent SSRF to arbitrary HTTPS hosts. Still record as a `[FINDING]` with `**Confidence:** medium`.
- **Blocklist of private IP ranges / metadata endpoints**: `169.254.169.254`, `10.0.0.0/8`, `192.168.0.0/16`, etc. — **not** sufficient. Bypassable via DNS rebinding, alternate IP representations, and redirect chains. Record as a `[FINDING]` with `**Confidence:** medium`.
- **DNS resolution + IP check** (resolve hostname first, then check resolved IP against blocklist): Stronger than a pure blocklist, but still susceptible to DNS rebinding between the check and the request (TOCTOU). Record as a `[FINDING]` with `**Confidence:** medium` unless the same resolved IP is explicitly pinned for the request.

**Confidence selection** (report every call site as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the outbound request destination with no effective mitigation (no allowlist or only a blocklist/scheme check).
- **Medium confidence**: User input probably reaches the destination (indirect flow or partial construction), or only weak mitigation is present (blocklist, scheme-only check, partial URL prefix); or you cannot determine the destination's origin with confidence (opaque helpers, complex conditional flows, or external libraries that resolve the URL).
- **Low confidence**: The destination is fully server-side, OR a strict host/prefix allowlist is enforced before the request — still record it rather than dropping it; downstream Challenge/Trace decide.

**Per-finding output fields** (used in the merged report):
- **File**, **Endpoint / function**
- **Issue**: short description of the flow
- **Taint trace**: step-by-step from entry point to the call site
- **Impact**: what an attacker can do — access cloud metadata at 169.254.169.254, pivot to internal services, port scan the internal network, exfiltrate data, bypass firewalls
- **Mitigation present**: None / Blocklist only / Scheme check only — explain why it's insufficient
- **Remediation**: strict host allowlist, or remove user control over destination entirely
- **Dynamic Test**: curl command or payload to confirm the finding, e.g. `curl "https://app.example.com/fetch?url=http://169.254.169.254/latest/meta-data/"`
- For low confidence: **Reason**. For medium-confidence uncertain flows: **Uncertainty** and **Suggestion**.
- DNS rebinding note: for findings where only a DNS-resolution-then-blocklist check is present, note the TOCTOU window explicitly in the finding — this is a known bypass technique.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [short description of the flow]
- **Taint trace**: [step-by-step from entry point to the call site]
- **Impact**: [what an attacker can do — access cloud metadata at 169.254.169.254, pivot to internal services, port scan the internal network, exfiltrate data, bypass firewalls]
- **Mitigation present**: [None / Blocklist only / Scheme check only — explain why it's insufficient]
- **Remediation**: [strict host allowlist, or remove user control over destination entirely]
- **Dynamic Test**:
  ```
  [curl command or payload to confirm the finding, e.g. curl "https://app.example.com/fetch?url=http://169.254.169.254/latest/meta-data/"]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [indirect flow or partial construction, or only weak mitigation present]
- **Taint trace**: [best-effort trace; mark uncertain steps]
- **Concern**: [why it remains a risk — note the TOCTOU window if a DNS-resolution-then-blocklist check is present]
- **Remediation**: [fix]
- **Dynamic Test**:
  ```
  [payload to attempt]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "Fully server-side" or "Strict host/prefix allowlist enforced"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [why the destination's origin could not be determined]
- **Suggestion**: [what to trace manually]
```
