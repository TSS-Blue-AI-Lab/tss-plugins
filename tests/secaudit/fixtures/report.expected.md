# Security Assessment Report

**Project:** Demo Service
**Generated:** 16 July 2026
**Hunters run:** businesslogic, idor, sqli

| Category | Count |
|---|---:|
| Confirmed | 1 |
| Refuted | 2 |
| Manual Review | 2 |

## Confirmed
### Forced mode bypass (businesslogic — src/mode.js:10)
- Severity: High
- Location: src/mode.js:10
- Challenge: Header presence bypasses the mode check.
- Trace evidence: POST /mode → middleware → handler
- Impact: An authenticated caller bypasses an operational control.
- Remediation: Authorize the override and validate one canonical value.

## Refuted
### Archive lookup exposure (idor — src/archive.js:40)
- Location: src/archive.js:40
- Challenge: The repository method lacks ownership enforcement.
- Trace evidence: No external route calls the archive method.

### Report query interpolation (sqli — src/query.js:30)
- Location: src/query.js:30
- Challenge: The value uses a parameterized query.

## Manual Review
### Order lookup lacks ownership (idor — src/orders.js:20)
- Severity: High
- Status: Runtime proof required
- Location: src/orders.js:20
- Challenge: The lookup accepts an arbitrary order identifier.
- Trace evidence: Runtime gateway policy is outside this repository.
- Impact: A caller may access another account's order.
- Remediation: Enforce ownership at the lookup boundary.
- Dynamic test: GET /orders/other-account-order with a normal user token

### Deployment policy unknown (businesslogic — src/config.js:50)
- Status: Defect determination required
- Location: src/config.js:50
- Challenge: The enforcing deployment policy is absent.

## Assessment Coverage

| Metric | Value |
|---|---:|
| Source lines in scope | 120 |
| Source files in scope | 4 |
| Estimated source tokens | 120 |

_Estimated source tokens are ceil(source bytes / 4), not model usage._
