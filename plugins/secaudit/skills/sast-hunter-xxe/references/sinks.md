# XXE — Recon Sink Catalog

Find every location in the codebase where XML is parsed without external entity resolution being explicitly disabled. Flag any XML parsing call where there is **no adjacent, paired hardening** (disabling DTD / external entity features). You are not yet tracing whether the input is user-controlled; that is the verify phase's job.

## Vulnerable XML parsing patterns

1. **Python — stdlib parsers (flag unless defusedxml is used as a drop-in)**:
   - `xml.etree.ElementTree.parse(...)`, `ET.fromstring(...)`, `ET.iterparse(...)`
   - `xml.dom.minidom.parseString(...)`, `xml.dom.minidom.parse(...)`
   - `xml.sax.parseString(...)`, `xml.sax.parse(...)`
   - `xmltodict.parse(...)` (backed by expat — generally safe for entity expansion, but flag for review)

2. **Python — lxml (flag unless `resolve_entities=False` and `no_network=True` are set)**:
   - `etree.parse(...)`, `etree.fromstring(...)`, `etree.XML(...)`
   - `etree.XMLParser(...)` without `resolve_entities=False`
   - `objectify.parse(...)`, `objectify.fromstring(...)`

3. **Java — flag any instantiation of these without the matching hardening features set**:
   - `DocumentBuilderFactory.newInstance()` → `newDocumentBuilder()` → `parse(...)`
   - `SAXParserFactory.newInstance()` → `newSAXParser()` → `parse(...)`
   - `XMLInputFactory.newInstance()` → `createXMLStreamReader(...)`
   - `TransformerFactory.newInstance()` → `newTransformer()` used with XML source
   - `SchemaFactory.newInstance(...)` → `newSchema(...)`
   - Spring: `MarshallingHttpMessageConverter` with `Jaxb2Marshaller` if entity expansion not disabled

4. **PHP — flag any of these without `libxml_disable_entity_loader(true)` immediately before (PHP 7.x), or without `LIBXML_NONET` flag (PHP 8.x)**:
   - `simplexml_load_string(...)`, `simplexml_load_file(...)`
   - `DOMDocument::loadXML(...)`, `DOMDocument::load(...)`
   - `xml_parse(...)` with `xml_parser_create()`
   - `SimpleXMLElement::__construct(...)` with raw string

5. **.NET — flag any of these without `DtdProcessing.Prohibit` and `XmlResolver = null`**:
   - `new XmlDocument()` followed by `.Load(...)` or `.LoadXml(...)`
   - `new XmlTextReader(...)` (legacy — DTD on by default in older .NET)
   - `XPathDocument(...)`, `XDocument.Load(...)`, `XElement.Load(...)`
   - `XmlReader.Create(...)` without `XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit }`

6. **Node.js — flag these libraries when parsing untrusted input**:
   - `libxmljs.parseXmlString(...)`, `libxmljs.parseXml(...)`
   - `node-expat` parser instantiation
   - `sax.createStream(...)` / `sax.parser(...)` — check if entity expansion is used
   - `xml2js.parseString(...)` — generally safe in v0.5+; flag only if `explicitArray` or other options suggest an older version or entity expansion is re-enabled

7. **Ruby — flag these when used with options that enable entity expansion**:
   - `Nokogiri::XML(input) { |config| config.noent }` — `noent` enables entity substitution
   - `REXML::Document.new(input)` — REXML is vulnerable to entity expansion DoS; check for entity expansion usage
   - `LibXML::XML::Document.string(input)` — check entity options

8. **Go — flag third-party XML libraries that support entity resolution**:
   - `github.com/beevik/etree` usage — check if network/entity resolution is configured
   - Standard `encoding/xml` is generally safe (does not resolve external entities) — flag only if combined with custom entity handling

## What to skip (safe — do not flag)

- `import defusedxml` used as the XML parser (Python)
- `etree.XMLParser(resolve_entities=False, no_network=True)` (lxml)
- Java `DocumentBuilderFactory` with `disallow-doctype-decl` feature set to `true`
- Java `XMLInputFactory` with `IS_SUPPORTING_EXTERNAL_ENTITIES = false`
- .NET `XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }`
- Nokogiri default usage without `noent` or other entity-expansion options
- Parsing of fully static, bundled, non-user-influenced XML files (e.g. reading config from disk at startup with no user input involved)

## Recon output — record each candidate as

```markdown
# XXE Recon: [Project Name]

## Summary
Found [N] XML parsing sites without explicit external entity hardening.

## Vulnerable Parsing Sites

### 1. [Descriptive name — e.g., "lxml.etree.fromstring without resolve_entities=False in upload handler"]
- **File**: `path/to/file.ext` (lines X-Y)
- **Function / endpoint**: [function name or route]
- **Parser / library**: [e.g., lxml etree / Java DocumentBuilder / PHP DOMDocument]
- **Missing hardening**: [what protection is absent — e.g., "resolve_entities not set to False", "disallow-doctype-decl feature not set"]
- **Input variable(s)**: `var_name` — [brief note on what it appears to be, e.g., "HTTP request body" or "file upload content" or "unknown origin"]
- **Code snippet**:
  ```
  [the XML parsing call and surrounding context]
  ```

[Repeat for each site]
```
