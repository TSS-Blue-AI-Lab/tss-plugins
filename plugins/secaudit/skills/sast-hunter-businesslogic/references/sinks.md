# Business Logic — Threat-Modeling Inputs

Analyze the codebase to understand its business domain and generate a concrete, prioritized
list of business logic attack scenarios specific to this application. Use `sast/architecture.md`
to understand what the application does, what features it has, and what business rules it is
supposed to enforce. Focus entirely on understanding the domain — do not verify exploitability
yet (that is the verify phase's job).

## Step 1 — Identify the business domain and features

Read `sast/architecture.md` and then explore the codebase to answer:
- What does this application do? (e-commerce, marketplace, SaaS, social platform, fintech, gaming, booking, etc.)
- What financial or transactional features exist? (payments, subscriptions, credits, tokens, wallets, invoices, refunds)
- What quantitative limits or rules exist? (ratings, scores, quantities, usage limits, quotas)
- What multi-step workflows exist? (checkout, onboarding, KYC, booking, auctions)
- What promotional or reward features exist? (coupons, referrals, loyalty points, bonuses, vouchers)
- What role or tier distinctions exist? (free vs. paid, user vs. premium, trial vs. full)
- What inventory or capacity constraints exist? (stock, seats, slots, bandwidth)

To discover features, search for:
- Route/endpoint definitions and their names
- Model/entity names (Order, Payment, Subscription, Coupon, Wallet, Bid, etc.)
- Business-rule-related field names (price, quantity, balance, rating, score, limit, quota, expiry, status)
- Validation logic or constraint-related code

## Step 2 — Generate attack scenarios

For each relevant business domain area found, generate specific attack scenarios. Each scenario must be:
- **Specific to this codebase** — name the actual endpoint, model, or feature involved
- **Actionable** — describe exactly what an attacker would send/do
- **Grounded** — reference the code or data model that makes this scenario plausible

Use the attack categories in `references/examples.md` ("Business Logic Attack Categories") as a
checklist. Only include categories that are relevant to this application:

- **Price/payment manipulation**: Can a user send an arbitrary price in the request? Is price trusted from client?
- **Quantity/value out of range**: Can a user send negative quantities, zero, or values exceeding defined limits?
- **Workflow bypass**: Can a user skip a mandatory step in a multi-step process?
- **Coupon/discount abuse**: Can a coupon be used multiple times or after expiration?
- **Race conditions**: Are there check-then-act patterns on shared resources (inventory, balance, coupon usage)?
- **Refund abuse**: Can a refund be requested after the product is consumed?
- **Reward/referral abuse**: Can referral or signup bonuses be farmed?
- **Entitlement bypass**: Are premium features checked at access time or only at subscription time?
- **Transfer/balance logic**: Can negative transfers or self-transfers be made?
- **Time/date logic**: Are time-limited offers enforced server-side?
- **Inventory logic**: Is stock validated atomically before reservation?

## Threat-model output — record scenarios as

```markdown
# Business Logic Threat Model: [Project Name]

## Application Domain
[2–3 sentence summary of what the application does and its key business features]

## Business Features Identified
- [Feature 1]: [brief description, relevant models/endpoints]
- [Feature 2]: ...

## Attack Scenarios

### 1. [Short title, e.g. "Negative quantity purchase for credit"]
- **Category**: [e.g. Quantity & Numeric Limit Violations]
- **Target**: [Endpoint or feature, e.g. `POST /api/orders`]
- **Description**: [What an attacker would do and what outcome they expect]
- **Relevant code**: [File and line range where the relevant logic lives]
- **Business rule that should be enforced**: [What the application is supposed to do]
- **Risk level**: [High / Medium / Low]

### 2. ...

[Use sequential numbering ### 3., ### 4., ... for every scenario — required for batching in the verify phase.]

## Categories Not Applicable
[List any categories from the checklist that are not relevant to this application and why]
```
