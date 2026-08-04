# SSRF — Recon Sink Catalog

Find every location in the codebase where the application makes an outbound network
request — HTTP, HTTPS, FTP, TCP, or DNS — regardless of whether that destination is
user-controlled.

**What to search for — outbound request call sites**:

You are looking for any code that opens a network connection or fetches a remote
resource. Flag ANY call where a non-trivially-hardcoded URL, host, or address value is
passed as an argument. You are not yet tracing whether that value is user-controlled;
that is Phase 2's job.

1. **Python HTTP clients**:
   - `requests.get(url)`, `requests.post(url)`, `requests.put(url)`, `requests.request(method, url)`, `requests.Session().get(url)`
   - `urllib.request.urlopen(url)`, `urllib2.urlopen(url)`
   - `httpx.get(url)`, `httpx.post(url)`, `httpx.AsyncClient().get(url)`
   - `aiohttp.ClientSession().get(url)`, `aiohttp.ClientSession().post(url)`

2. **Python socket / DNS**:
   - `socket.connect((host, port))`, `socket.create_connection((host, port))`
   - `dns.resolver.resolve(name)`, `socket.getaddrinfo(host, ...)`

3. **Python file-fetching with remote schemes**:
   - `urllib.request.urlopen(url)` where url may be http/https/ftp
   - `open(url)` via `from urllib.request import urlopen` or similar (flag if url may be remote)

4. **Node.js / JavaScript HTTP clients**:
   - `fetch(url)`, `node-fetch(url)`
   - `axios.get(url)`, `axios.post(url)`, `axios.request({url})`
   - `http.get(url)`, `https.get(url)`, `http.request(options)`, `https.request(options)`
   - `got(url)`, `superagent.get(url)`, `needle.get(url)`, `undici.request(url)`
   - `require('request')(options)`

5. **Node.js socket / DNS**:
   - `net.createConnection({host, port})`, `net.connect(port, host)`
   - `dns.lookup(hostname, ...)`, `dns.resolve(hostname, ...)`, `dns.resolve4(hostname)`

6. **Ruby HTTP clients**:
   - `Net::HTTP.get(uri)`, `Net::HTTP.start(host, ...)`, `Net::HTTP.get_response(url)`
   - `URI.open(url)`, `open(url)` (Kernel#open / OpenURI)
   - `RestClient.get(url)`, `RestClient::Resource.new(url)`
   - `Faraday.new(url).get(path)`, `HTTParty.get(url)`
   - `Typhoeus::Request.new(url)`

7. **PHP HTTP clients and file functions**:
   - `curl_setopt($ch, CURLOPT_URL, $url)` followed by `curl_exec($ch)`
   - `file_get_contents($url)` — flag when `$url` may be an http/https/ftp URL
   - `fopen($url, 'r')` with a remote URL scheme
   - `Guzzle`: `$client->request('GET', $url)`, `$client->get($url)`
   - `Symfony HttpClient`: `$client->request('GET', $url)`

8. **Java HTTP clients**:
   - `new URL(url).openConnection()`, `new URL(url).openStream()`
   - `HttpURLConnection` / `HttpsURLConnection` with a dynamic URL
   - `OkHttpClient().newCall(new Request.Builder().url(url)...)`
   - `RestTemplate.getForObject(url, ...)`, `RestTemplate.getForEntity(url, ...)`
   - `WebClient.get().uri(url)`, `WebClient.create(url)`
   - `Apache HttpClient`: `httpClient.execute(new HttpGet(url))`

9. **Go HTTP clients and network dials**:
   - `http.Get(url)`, `http.Post(url, ...)`, `http.NewRequest("GET", url, ...)`
   - `net.Dial("tcp", addr)`, `net.DialTCP(...)`, `net.DialTimeout("tcp", addr, ...)`
   - `net.LookupHost(hostname)`, `net.LookupAddr(addr)`, `net.ResolveIPAddr(...)`
   - `net.ResolveTCPAddr("tcp", addr)`

10. **C# / .NET HTTP clients**:
    - `HttpClient.GetAsync(url)`, `HttpClient.PostAsync(url, ...)`, `HttpClient.SendAsync(request)`
    - `WebRequest.Create(url)`, `WebClient.DownloadString(url)`, `WebClient.DownloadData(url)`
    - `HttpWebRequest` with a dynamic URL

11. **Shell-out to network tools** (via subprocess, exec, system, etc.):
    - `subprocess.run(["curl", url, ...])`, `subprocess.Popen(["wget", url, ...])`
    - `os.system("curl " + url)`, `exec("wget " + url)`
    - Any `curl`, `wget`, `nc`, `ncat`, `nmap` invocation where the target is a variable

## What to skip (safe — do not flag)

- Calls where the entire URL and hostname are fully hardcoded string literals with no dynamic parts: `requests.get("https://api.example.com/data")`
- Internal loopback connections to `localhost` or `127.0.0.1` that are clearly part of service-to-service architecture (e.g., connecting to a local queue) — flag these if the address is dynamic

## Recon output — record each candidate as

```markdown
### 1. [Descriptive name — e.g., "HTTP GET in webhook dispatcher"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Call type**: [HTTP GET / HTTP POST / TCP dial / DNS lookup / subprocess curl / etc.]
- **Library / method**: [requests.get / fetch / http.Get / curl_exec / etc.]
- **Destination argument**: `var_name` or `url_expression` — [brief note, e.g., "assembled from query param" or "partially hardcoded path with variable host"]
- **Code snippet**:
  ```
  [the outbound call and the lines immediately before it that construct the destination]
  ```
```
