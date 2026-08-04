# Business Logic — Concept, Attack Categories, and Verify Heuristics

## What are Business Logic Vulnerabilities

Business logic vulnerabilities arise when an application's intended workflow, rules, or constraints can be manipulated to produce unintended outcomes — without exploiting technical flaws like injection or memory corruption. The attacker operates within the application's own features but uses them in ways the developers did not anticipate.

The core pattern: *the application accepts input that is syntactically valid and passes authentication/authorization, but violates a business rule that was never enforced in code.*

### What Business Logic Vulnerabilities ARE

- Submitting a negative quantity to a purchase endpoint, receiving a credit instead of a charge
- Applying the same one-time discount coupon multiple times in parallel requests
- Skipping the payment step in a multi-step checkout by replaying a later step's request
- Posting a rating of 9999 to a movie rating endpoint that should cap ratings at 5
- Transferring a negative amount to move money from the recipient to the sender
- Redeeming a referral bonus by referring yourself with a second account
- Re-using a single-use reset token or voucher that was never invalidated
- Purchasing an item that is out of stock due to a race condition between inventory check and reservation
- Accessing a premium subscription feature after downgrading to a free plan
- Winning an auction by retracting a high bid after others have been eliminated

### What Business Logic Vulnerabilities are NOT

Do not flag these as business logic issues:

- **SQL injection, XSS, RCE, XXE, SSRF, SSTI**: These are injection/technical flaws — separate skills cover them
- **Missing authentication**: Endpoint requires no login at all → that's "Unauthenticated Access"
- **IDOR**: Accessing another user's resource by changing an ID → that's a separate access-control class
- **Brute-force / rate limiting**: Generic rate-limit bypass on login → that's not a business logic flaw unless it enables specific business rule circumvention

## Business Logic Attack Categories

Use these categories to guide threat modeling. Not all categories apply to every application — identify which ones are relevant based on the architecture summary.

### 1. Price & Payment Manipulation
- Negative prices or zero prices on purchase endpoints
- Arbitrary price override in request body (mass assignment of price field)
- Currency or unit confusion (e.g., cents vs. dollars)
- Floating-point precision abuse in monetary arithmetic
- Applying discounts that reduce total below zero

### 2. Quantity & Numeric Limit Violations
- Negative quantities (ordering −5 items to receive a credit)
- Quantities exceeding per-user or per-order limits
- Integer overflow/underflow in quantity or balance calculations
- Out-of-range values for bounded fields (ratings, scores, percentages)

### 3. Workflow & Multi-Step Process Bypass
- Skipping mandatory steps in a sequential process (payment, email verification, ID check)
- Replaying a completion token from a previous successful flow to bypass steps
- Direct-access to a later-stage endpoint without completing earlier stages
- Submitting a terminal state transition without going through intermediate states (state machine violations)

### 4. Coupon, Discount & Voucher Abuse
- Applying the same coupon multiple times (single-use not enforced)
- Stacking discounts that were not intended to be combined
- Using an expired coupon or voucher
- Generating or guessing valid coupon codes

### 5. Race Conditions & Concurrency Abuse
- Double-spending: sending two concurrent purchase requests to consume a balance once
- Concurrent coupon redemption draining credit beyond allowed amount
- TOCTOU (time-of-check / time-of-use) on inventory: check passes for both requests, both reservations succeed
- Parallel withdrawal/transfer requests exceeding account balance

### 6. Refund & Chargeback Abuse
- Requesting a refund after the digital good has been consumed or downloaded
- Partial refund on an already-partially-refunded order
- Refund without returning physical item (if logic is not enforced server-side)

### 7. Reward, Referral & Loyalty Abuse
- Self-referral using a second account to earn a referral bonus
- Earning signup bonuses multiple times across multiple accounts
- Loyalty point farming through artificial activity
- Sharing or transferring non-transferable rewards

### 8. Subscription & Entitlement Bypass
- Accessing paid/premium features after downgrading or cancelling
- Trial period abuse (repeatedly creating new accounts for trial access)
- Feature flag or plan check performed only at subscription creation, not at feature access time
- Entitlement cached at session start and not re-evaluated after plan change

### 9. Auction & Bidding Logic
- Retracting a winning bid after competing bids have been rejected
- Shill bidding: artificially inflating price with controlled accounts
- Bypass of reserve price enforcement
- Bid manipulation via concurrent requests

### 10. Inventory & Stock Logic
- Purchasing out-of-stock items due to missing stock validation
- Reserving more stock than available via concurrent requests
- Negative inventory resulting from refund-without-restock logic
- Phantom inventory: item appears available but cannot be fulfilled

### 11. Time & Date Logic
- Using time-limited offers after expiration (expiry checked client-side or weakly server-side)
- Backdating transactions or bookings
- Exploiting "grace period" logic to extend benefits indefinitely
- System clock manipulation if server trusts client-supplied timestamps

### 12. Transfer & Balance Logic
- Transferring a negative amount (sender receives money from recipient)
- Self-transfer to exploit bonus or fee logic
- Transferring more than the available balance due to missing server-side check
- Rounding errors exploited across many micro-transactions

## Verify heuristics (exploitability analysis)

**Goal**: For each attack scenario, determine whether the business rule is properly enforced
in code or whether the attack is exploitable.

**What business logic flaws are NOT** — do not flag these here:
- **SQL injection, XSS, RCE, XXE, SSRF, SSTI**: separate skills
- **Missing authentication**: Unauthenticated Access
- **IDOR**: another access-control class
- **Generic brute-force** unless it clearly circumvents a business rule

**For each scenario, perform the following checks**:

**1. Is the business rule enforced server-side?**
- Is the constraint validated in the backend handler, service layer, or ORM/database?
- Or is it only validated client-side (frontend form validation, JavaScript min/max attributes)?
- Client-side-only validation = exploitable.

**2. Is the validation complete and covers all edge cases?**
- Does it check for negative values where applicable?
- Does it check upper bounds, not just lower bounds?
- Does it handle concurrent requests (is the check atomic, or is there a TOCTOU window)?
- Does it re-validate at the point of use, not just at an earlier step?

**3. For workflow bypass scenarios**:
- Does each step verify that previous required steps were completed?
- Are step completion flags stored server-side (not just in a cookie or session that can be replayed)?
- Can a terminal endpoint be called directly without going through earlier steps?

**4. For coupon/voucher scenarios**:
- Is the coupon marked as used atomically with the transaction (in the same DB transaction)?
- Is concurrent redemption protected (SELECT FOR UPDATE, optimistic locking, atomic compare-and-swap)?
- Is the expiry date checked server-side at redemption time?

**5. For race condition scenarios**:
- Is stock/balance check and decrement done atomically (in a single DB transaction or with row-level locking)?
- Is there any idempotency key or deduplication logic to prevent duplicate concurrent requests?

**6. For entitlement/subscription scenarios**:
- Is the user's current plan/tier checked at the point of feature access?
- Or is it cached at login/session start and never re-evaluated?

**7. For transfer/balance scenarios**:
- Is there a server-side check that the transfer amount is positive?
- Is there a server-side check that the sender has sufficient balance?
- Are these checks done within a database transaction to prevent race conditions?

**Confidence selection** (report every scenario as a `[FINDING]` — do not decide exploitable/not-exploitable; Challenge/Trace do):
- **High confidence**: The business rule is absent, bypassable, or only enforced client-side.
- **Medium confidence**: The rule exists but has gaps (race condition window, missing edge case, bypassable condition); or you cannot determine enforcement with confidence (complex logic, external service dependency, etc.).
- **Low confidence**: Proper server-side enforcement exists and covers edge cases — still record it rather than dropping it; downstream Challenge/Trace decide.

**Findings output** — record each finding as:

```markdown
### [FINDING] Scenario title (Services/Checkout.cs:88)
**Confidence:** high
- **Category**: [Attack category]
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Business Rule Violated**: [What rule the application should enforce]
- **Issue**: [Clear description of what validation is missing or broken]
- **Impact**: [What an attacker can achieve — free goods, financial loss, unfair advantage, etc.]
- **Proof**: [Show the code path demonstrating the missing enforcement]
- **Remediation**: [Specific fix for this scenario]
- **Dynamic Test**:
  ```
  [Step-by-step instructions or curl commands to confirm the finding on the live app.
   Include exact HTTP method, endpoint, headers, and request body.
   Describe what response or side effect confirms the vulnerability.]
  ```

### [FINDING] Scenario title (Services/Checkout.cs:88)
**Confidence:** medium
- **Category**: [Attack category]
- **File**: `path/to/file.ext` (lines X-Y)
- **Endpoint**: `METHOD /path`
- **Business Rule Violated**: [What rule should be enforced]
- **Issue**: [What enforcement gap or race condition exists]
- **Concern**: [Why this is likely exploitable despite partial enforcement]
- **Proof**: [Show the code path with the weak/partial check]
- **Remediation**: [Specific fix]
- **Dynamic Test**:
  ```
  [Step-by-step instructions or curl commands, e.g. two concurrent requests, to confirm.]
  ```

### [FINDING] Scenario title (Services/Checkout.cs:88)
**Confidence:** low
- **Category**: [Attack category]
- **File**: `path/to/file.ext` (lines X-Y)
- **Business Rule**: [What the application is supposed to enforce]
- **Protection**: [How it is enforced — server-side validation, DB constraint, atomic transaction, etc.]

### [FINDING] Scenario title (Services/Checkout.cs:88)
**Confidence:** medium
- **Category**: [Attack category]
- **File**: `path/to/file.ext` (lines X-Y)
- **Uncertainty**: [Why automated analysis couldn't determine the status]
- **Suggestion**: [What to examine manually or test dynamically]
```

Server-side validation is the only valid protection. Client-side validation, frontend form constraints, and API documentation that says "must be positive" are not security controls.

Race conditions on financial operations are high-severity even if they appear to require exact timing — automated tools (Turbo Intruder, concurrent curl) make them trivial to exploit.

Pay attention to ORM and database-level constraints (CHECK constraints, unique indexes, transactions with locking) — these can provide enforcement that is not visible in application code alone.
