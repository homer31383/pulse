# MICROPAYMENT PROTOCOL FOR AI CONTENT ACCESS
## Complete Project Specification & Disaster Recovery Document

*Last updated: March 2026*
*Author: Chris*

---

## TABLE OF CONTENTS

1. Project Overview & Vision
2. The Problem Being Solved
3. Core Concept
4. System Architecture
5. Technical Components
6. Tech Stack
7. Smart Contract Architecture
8. Payment Flow
9. User Experience
10. Publisher/Creator Experience
11. SDK & Developer Integration
12. Business Model
13. Growth Strategy
14. Known Challenges & Open Questions
15. Relationship to Pulse
16. Rebuild Order & Dependencies
17. Regulatory Considerations

---

## 1. PROJECT OVERVIEW & VISION

This project is an open micropayment protocol that enables AI-powered tools to compensate content creators every time their work is accessed, retrieved, or referenced during AI-generated outputs such as briefings, summaries, or research.

The protocol replaces the current model where AI tools consume publisher/creator content for free, and provides an alternative to both the ad-supported internet and traditional subscription models.

The core proposition: high volume, low friction, aggregate value. Individual payments are fractions of a cent. At scale, they compound into meaningful revenue streams for creators — from the New York Times down to individual Substack writers.

The philosophical foundation: users are the customer, not the product. No behavioral tracking, no attention economy, no ad-supported model. Users pay tiny amounts for what they consume. Creators get compensated directly. The transaction is clean and transparent.

---

## 2. THE PROBLEM BEING SOLVED

AI tools (ChatGPT, Claude, Perplexity, custom RAG applications, tools like Pulse) retrieve and synthesize content from across the web to generate outputs for users. Currently:

- Content creators receive zero compensation when AI tools access their work
- Publishers are responding with lawsuits and bespoke licensing deals with major AI companies
- There is no standardized, protocol-level solution for AI content licensing
- Traditional payment processors (Stripe at 2.9% + $0.30/transaction) cannot economically handle micropayments
- Subscription models ($10-20/month per publication) don't match how people actually consume content across many sources
- The ad-supported model trades user privacy and attention for "free" content

---

## 3. CORE CONCEPT

### The Protocol (Not a Product)

This is infrastructure, not an application. The protocol is a layer that sits between AI tools and content creators, handling:

- Content registration (creators register URLs and set per-access prices)
- Access logging (every retrieval event is tracked)
- Micropayment settlement (batched stablecoin payments on an L2 blockchain)

Pulse (Chris's existing AI briefing app) serves as the first proof-of-concept implementation — the first AI tool to integrate the protocol. But the protocol is designed for any AI tool to adopt.

### Why Blockchain

Traditional payment rails cannot handle this use case. Credit card transaction fees would exceed the payment amounts. Stablecoins on L2 blockchains solve this by enabling:

- Transactions as small as $0.000001 (USDC supports 6 decimal places)
- Batch settlement of many access events in a single low-cost transaction
- Transparent, auditable payment records
- Permissionless participation (any creator can register, any tool can integrate)

### Why Stablecoin (Not a Native Token)

The protocol uses USDC (or equivalent stablecoin) rather than a native/custom token because:

- No price volatility — creators see revenue in dollar terms
- No speculative dynamics or token economics to manage
- Avoids SEC regulatory scrutiny (not a security or commodity)
- Simpler mental model for all participants
- USDC supports sufficient decimal precision for micropayments

---

## 4. SYSTEM ARCHITECTURE

### High-Level Components

```
[Content Creators] --> [Content Registry] <-- [AI Tools (via SDK)]
                              |
                       [Payment Rail]
                       (L2 Blockchain)
                              |
                    [Settlement Engine]
                    (Batched payments)
                              |
              [User Accounts]   [Creator Accounts]
              (Custodial wallets with fiat on/off ramps)
```

### Component Breakdown

1. CONTENT REGISTRY
   - Database where creators register their content
   - Stores: creator identity, content URLs/domains, per-access pricing
   - Any creator can register without platform involvement
   - Substack writers, bloggers, journalists, independent publishers all register directly

2. PAYMENT RAIL
   - Stablecoin-based (USDC) on an Ethereum L2 (Base, Arbitrum, or Optimism)
   - Handles batched settlement of access events
   - Smart contracts manage escrow, settlement, and distribution

3. SDK / INTEGRATION LAYER
   - Open source library for AI tool developers
   - Handles: registry lookup, access logging, payment triggering
   - Goal: integration in minutes, not weeks

4. USER ACCOUNT SYSTEM
   - Custodial wallet (user doesn't need to understand crypto)
   - Fiat on-ramp (deposit USD via credit card/bank, converted to USDC behind the scenes)
   - Balance display in dollars
   - Spending controls (max price per access, daily/monthly budgets)

5. CREATOR ACCOUNT SYSTEM
   - Dashboard showing access volume and revenue
   - Fiat off-ramp (withdraw to bank account)
   - Pricing controls
   - Analytics on which content is being accessed and by which tools

6. SETTLEMENT ENGINE
   - Accumulates access events during a session/day
   - Settles in a single batched on-chain transaction
   - Distributes payments to creator accounts

---

## 5. TECHNICAL COMPONENTS (DETAILED)

### Content Registry

TYPE: Web application with database
FUNCTION: Creator registration, content URL management, pricing configuration
DATA MODEL:
  - Creator profiles (identity, payment address, metadata)
  - Content entries (URLs, domains, pricing per access)
  - Access logs (which tool accessed what, when, payment amount)

REQUIREMENTS:
  - RESTful API for SDK integration
  - Web dashboard for creator management
  - Search/lookup by URL for real-time registry checks
  - High availability (every AI tool query checks the registry)

### Payment Smart Contracts

TYPE: Solidity smart contracts on Ethereum L2
FUNCTION: Escrow, settlement, distribution

CONTRACTS NEEDED:
  - UserDeposit: Holds user USDC balances, handles deposits/withdrawals
  - BatchSettlement: Accepts batched access logs, distributes payments to creators
  - CreatorWithdrawal: Allows creators to withdraw earnings to external wallets or fiat off-ramps
  - ProtocolFees: Handles thin transaction fee (0.5-1%) for protocol sustainability

KEY DESIGN DECISIONS:
  - Batch settlement (not per-transaction) to minimize gas costs
  - Custodial model for user and creator accounts (optional self-custody for power users)
  - USDC as settlement currency
  - Access-based billing (per retrieval event, not contribution-weighted)

### SDK

TYPE: Open source library (JavaScript/TypeScript primary, with Python wrapper)
FUNCTION: Drop-in integration for AI tool developers

CORE FUNCTIONS:
  - registryLookup(url) -> returns creator info and price, or null if unregistered
  - logAccess(userId, contentUrl, toolId) -> logs an access event
  - settleBatch(accessEvents[]) -> triggers batch settlement
  - getUserBalance(userId) -> returns current balance
  - estimateCost(urls[]) -> predicts cost of accessing a set of sources

INTEGRATION PATTERN:
  1. AI tool retrieves content from a URL
  2. SDK checks registry for that URL
  3. If registered: log access event, deduct from user balance
  4. If not registered: log access event, payment goes to unclaimed escrow
  5. Periodically: settle accumulated events in batch transaction

### Fiat On/Off Ramps

TYPE: Third-party integration
FUNCTION: Convert between USD and USDC for users and creators
OPTIONS: Moonpay, Ramp, Coinbase Onramp (no upfront integration cost, they charge per conversion)

---

## 6. TECH STACK

### Content Registry & Web Application
- FRAMEWORK: Next.js (React) — consistent with Pulse and other apps in Chris's ecosystem
- HOSTING: Vercel
- DATABASE: Supabase (PostgreSQL) — consistent with existing app infrastructure
- AUTH: Supabase Auth
- API: RESTful, built into Next.js API routes

### Smart Contracts
- LANGUAGE: Solidity
- CHAIN: Ethereum L2 — Base (Coinbase's L2, strong ecosystem, low fees) is the leading candidate; Arbitrum and Optimism are alternatives
- DEVELOPMENT FRAMEWORK: Hardhat or Foundry
- TESTING: Hardhat test suite with Chai assertions, or Foundry's Forge
- STABLECOIN: USDC (Circle) — 6 decimal places, widely supported

### SDK
- PRIMARY LANGUAGE: TypeScript (npm package)
- SECONDARY: Python wrapper (pip package)
- DISTRIBUTION: npm registry, PyPI, GitHub
- DOCUMENTATION: GitHub README + dedicated docs site

### Fiat Ramps
- PROVIDER: Moonpay, Ramp, or Coinbase Onramp (evaluate at build time)
- INTEGRATION: Their hosted widget embedded in the user dashboard

### Infrastructure
- CI/CD: GitHub Actions
- MONITORING: Basic — Vercel analytics, Supabase dashboard, on-chain transaction monitoring
- SMART CONTRACT AUDIT: Deferred until post-MVP traction (budget $5,000-30,000 when needed)

---

## 7. SMART CONTRACT ARCHITECTURE

### Contract: UserDeposit.sol
PURPOSE: Manage user USDC balances
FUNCTIONS:
  - deposit(amount) — user deposits USDC into their account
  - withdraw(amount) — user withdraws USDC
  - getBalance(userId) — returns current balance
  - deductBatch(userId, amount) — called by settlement engine to deduct for access events
SECURITY:
  - Only authorized settlement contract can call deductBatch
  - Withdrawal limits and cooldowns for security
  - Emergency pause functionality

### Contract: BatchSettlement.sol
PURPOSE: Process batched access events and distribute payments
FUNCTIONS:
  - submitBatch(accessEvents[]) — accepts array of {userId, creatorId, amount} events
  - Each event deducts from user balance and credits creator balance
  - Applies protocol fee (0.5-1%)
SECURITY:
  - Only authorized submitters (verified AI tools) can submit batches
  - Batch validation (amounts match, users have sufficient balance)
  - Rate limiting

### Contract: CreatorRegistry.sol (on-chain component)
PURPOSE: On-chain record of creator payment addresses and verification
FUNCTIONS:
  - registerCreator(creatorId, paymentAddress)
  - updatePaymentAddress(creatorId, newAddress)
  - getPaymentAddress(creatorId)
NOTE: The full content registry (URLs, pricing) lives off-chain in Supabase for performance. Only payment routing info needs to be on-chain.

### Contract: ProtocolTreasury.sol
PURPOSE: Collect protocol fees, manage float yield
FUNCTIONS:
  - collectFees() — receives protocol fee portion from settlements
  - deployToYield(amount) — deploys idle USDC to yield strategies (Aave, etc.)
  - withdrawForOperations(amount) — fund protocol operations from treasury

---

## 8. PAYMENT FLOW

### User Deposits Funds
1. User signs up on web dashboard
2. User clicks "Add Funds"
3. Fiat on-ramp widget (Moonpay/Ramp) opens
4. User pays $10 via credit card
5. On-ramp converts to USDC and deposits to UserDeposit contract
6. User sees "$10.00" balance in dashboard

### AI Tool Accesses Content
1. User runs a Pulse briefing (or uses any integrated AI tool)
2. Tool retrieves content from source URL
3. SDK calls registryLookup(url) — checks if source is registered
4. IF REGISTERED: SDK logs access event {userId, creatorId, price}
5. IF NOT REGISTERED: SDK logs event with creatorId=unclaimed
6. Tool continues building output using the content

### Batch Settlement
1. Periodically (hourly or daily), settlement engine collects accumulated access events
2. Engine submits batch to BatchSettlement contract
3. Contract processes each event:
   a. Deducts price from user's balance
   b. Credits (price minus protocol fee) to creator's balance
   c. Credits protocol fee to treasury
4. All participants can verify settlements on-chain

### Creator Withdraws Earnings
1. Creator logs into dashboard, sees accumulated earnings
2. Creator clicks "Withdraw"
3. USDC transferred to creator's external wallet or fiat off-ramp
4. If fiat off-ramp: USDC converted to USD and sent to bank account

### Cost Prediction for Users
Before running a briefing, the tool can estimate costs:
1. Tool identifies likely sources it will access
2. SDK calls estimateCost(urls[])
3. Tool displays: "This briefing will access ~40 sources, estimated cost: $0.12"
4. User confirms or adjusts (e.g., sets max budget)

---

## 9. USER EXPERIENCE

### Onboarding
1. Sign up (email + password, or OAuth)
2. Optional: deposit funds (can browse/explore before committing money)
3. Connect to an AI tool (Pulse initially, others as SDK adoption grows)
4. Set preferences: max cost per access, daily/monthly budget ceiling

### Day-to-Day
- User interacts with their AI tool normally
- Costs are invisible during use (no per-access confirmations)
- Dashboard shows: current balance, spending history, sources accessed
- Monthly summary: "You accessed 1,247 sources this month. Total cost: $3.82"
- Top-up notifications when balance runs low

### Key UX Principles
- Crypto is invisible. Users see dollars, not tokens or wallets.
- Feels like a utility bill, not a series of purchases
- No friction during content consumption
- Full transparency available for those who want it (on-chain verification)

---

## 10. PUBLISHER/CREATOR EXPERIENCE

### Onboarding
1. Sign up on creator dashboard
2. Register content: submit URLs, domains, or URL patterns
3. Set pricing: per-access price (suggested defaults provided, creator can customize)
4. Set up payment: connect wallet or bank account for withdrawals

### Day-to-Day
- Dashboard shows: access volume, revenue, trending content, which AI tools are accessing
- Analytics: which articles/posts are most accessed, revenue per piece
- Pricing adjustment: can change pricing anytime based on performance
- Withdrawal: manual or auto-withdrawal when balance hits threshold

### Key Points for Creators
- No platform integration needed (Substack doesn't need to do anything)
- Creator registers their content URLs directly
- Zero risk: free to register, only earns money
- Works alongside existing monetization (subscriptions, ads, etc.)
- Unclaimed content: if a creator hasn't registered, access events are logged. When they register, they can claim back-payments from escrow.

---

## 11. SDK & DEVELOPER INTEGRATION

### Target Audience
Indie developers building AI-powered tools: RAG applications, research assistants, content aggregators, AI agents, custom chatbots with web retrieval.

### Integration Example (TypeScript)

```typescript
import { ContentProtocol } from '@content-protocol/sdk';

const protocol = new ContentProtocol({
  toolId: 'your-tool-id',
  apiKey: 'your-api-key'
});

// During content retrieval
async function retrieveContent(url: string, userId: string) {
  const content = await fetchWebContent(url);

  // Check registry and log access
  const registration = await protocol.registryLookup(url);
  if (registration) {
    await protocol.logAccess({
      userId,
      contentUrl: url,
      creatorId: registration.creatorId,
      price: registration.pricePerAccess
    });
  }

  return content;
}

// Before generating output — cost prediction
async function estimateBriefingCost(urls: string[]) {
  const estimate = await protocol.estimateCost(urls);
  // Returns: { totalCost: 0.12, registeredSources: 34, unregisteredSources: 6 }
  return estimate;
}

// Periodic settlement (can be automated)
await protocol.settlePendingEvents();
```

### Developer Pitch
"Add three lines of code and your AI tool compensates content creators automatically. Future-proof your tool against the coming regulatory wave around AI content licensing."

---

## 12. BUSINESS MODEL

### Revenue Sources

1. PROTOCOL TRANSACTION FEE
   - 0.5-1% on each micropayment
   - On a $0.01 access: $0.0001 fee (imperceptible to all parties)
   - Scales linearly with volume
   - Could decrease over time as float revenue grows

2. FLOAT YIELD
   - Users maintain prepaid balances (average ~$15 per user)
   - Pooled USDC deployed to yield strategies (Aave, T-bill backed, etc.)
   - Conservative 4-8% annual yield
   - Revenue scales with user count:
     * 100,000 users × $15 avg = $1.5M pool → ~$75K/year
     * 1,000,000 users × $15 avg = $15M pool → ~$750K/year
     * 10,000,000 users × $15 avg = $150M pool → ~$7.5M/year

3. FUTURE (not at launch)
   - Premium analytics for creators
   - Enterprise API tiers for large AI companies
   - Governance token (only if/when protocol is mature)

### Cost Structure (at Launch)
- Infrastructure (Vercel, Supabase): $200-500/year
- L2 contract deployment: under $100
- Domain and services: a few hundred dollars
- Legal (entity formation, ToS): $1,000-3,000
- TOTAL MVP: Under $5,000 in hard costs
- Primary investment: Chris's time (estimated 3-6 months alongside freelance work)

### Cost Structure (at Scale)
- Smart contract audit: $5,000-30,000
- Legal/regulatory counsel: variable
- Potential hires: engineering, business development
- These costs come with traction, not at launch

---

## 13. GROWTH STRATEGY

### Phase 1: Build & Prove (Months 1-6)
- Build content registry, payment rail, and SDK
- Integrate into Pulse as first implementation
- Recruit a small cohort of long-tail creators to register
- Demonstrate the full loop working: user runs Pulse briefing → content accessed → creator gets paid

### Phase 2: Long Tail Creator Adoption (Months 6-12)
- Outreach to independent writers, Substackers, bloggers, niche analysts
- Pitch: "You're already being scraped by AI tools for free. Want to get paid instead?"
- Unclaimed escrow as incentive: "There's already $X waiting for you from AI tools that accessed your content"
- Creator-to-creator word of mouth (a writer earning $100/month tells other writers)

### Phase 3: Indie Developer Adoption (Months 6-18)
- Open source SDK release
- Developer community outreach: forums, hackathons, AI tool communities
- Pitch: "Future-proof your tool, differentiate on ethics, ten minutes to integrate"
- Growing both sides of the marketplace simultaneously

### Phase 4: Network Effects (Months 12-24)
- Critical mass of creators makes the registry valuable
- Critical mass of tools makes registration worthwhile for creators
- Transaction volume generates meaningful revenue for creators
- Data tells a compelling traction story

### Phase 5: Larger Players (Months 18+)
- AI companies see the protocol as a solution to their licensing problem
- Publishers see revenue flowing to smaller creators and want in
- The protocol is adopted not through sales meetings but through market pull
- Analogies: Twitch (small streamers first, ESPN later), Discord (gamers first, enterprise later), Stripe (indie devs first, large companies later)

---

## 14. KNOWN CHALLENGES & OPEN QUESTIONS

### The Retention/Caching Problem
PROBLEM: Once an AI system reads an article, it has "learned" the content. It could theoretically synthesize that knowledge for future users without re-accessing the source, meaning the creator only gets paid once.
CURRENT APPROACH: Access-based billing — every time a tool retrieves content from a source for a user's session, it pays. Tools are architecturally encouraged to be stateless (not cache retrieved content across sessions). The protocol's terms of service prohibit persistent retention.
HONEST ASSESSMENT: This is imperfect. Enforcement is contractual/legal, not purely technical. But the protocol is dramatically better than the current status quo of zero compensation. And if access costs are cheap enough, the engineering effort to circumvent the protocol exceeds the cost of compliance.

### Race to the Bottom Risk
PROBLEM: A competitor tool could offer cheaper service by caching content and only paying creators once, undercutting compliant tools.
MITIGATION: Legal/contractual enforcement, regulatory pressure, creator/publisher advocacy. Similar to how music piracy was eventually addressed through a combination of legal frameworks and convenience (Spotify).

### Publisher Onboarding Without Platform Cooperation
PROBLEM: Most long-tail creators publish on platforms (Substack, Medium, WordPress) they don't control. The protocol can't gate content at the source without platform cooperation.
SOLUTION: The protocol works at the AI tool level (consuming side), not the publishing side. Creators register their content URLs in the registry. AI tools that integrate the SDK check the registry and pay. No platform integration required.

### Pricing Complexity
OPEN QUESTION: How do creators determine fair per-access pricing? What prevents a race to the bottom on pricing? Should there be suggested minimums or pricing guidance?
INITIAL APPROACH: Provide suggested defaults based on content type. Let the market determine pricing over time. Surface analytics showing what price points generate the most access volume.

### Scale Chicken-and-Egg
PROBLEM: Creators won't register if no tools are paying. Tools won't integrate if no creators are registered.
APPROACH: Pulse provides the first tool. Unclaimed escrow provides retroactive incentive for creators. Long tail on both sides (indie creators + indie developers) grows organically before big players are needed.

---

## 15. RELATIONSHIP TO PULSE

Pulse is Chris's existing AI-powered personal intelligence briefing app. It generates curated briefings across several channels (Ethereum, AI/ML, Macro, Post-Production Tech, Urban Futures) using Claude's API and web search.

In the context of this protocol:
- Pulse is the FIRST IMPLEMENTATION — the proof of concept that demonstrates the full payment loop
- Pulse already tracks token costs per briefing; adding micropayment cost tracking is a natural extension
- Pulse's existing UX for cost estimation ("this briefing will cost approximately X tokens") maps directly to micropayment cost prediction
- The protocol is NOT a feature of Pulse — it's independent infrastructure that Pulse happens to be the first tool to use

### Pulse Tech Stack (for reference)
- Next.js on Vercel
- Supabase backend
- Claude API for content synthesis
- Web search for content retrieval
- PWA with TTS, streaming briefings, multi-profile support

---

## 16. REBUILD ORDER & DEPENDENCIES

If everything is lost, rebuild in this order. Each step depends on the previous ones.

### Step 1: Infrastructure Setup
- Create GitHub repository
- Set up Vercel project
- Set up Supabase project (can share instance with other apps using table prefixes, consistent with existing pattern)
- Configure environment variables and secrets
- Set up development environment (Node.js, npm, Hardhat/Foundry)

### Step 2: Content Registry (Web App + Database)
DEPENDS ON: Step 1
BUILD:
  - Supabase tables: creators, content_entries, access_logs
  - Next.js web app with creator dashboard
  - RESTful API endpoints for registry lookup
  - Creator auth (Supabase Auth)
  - Creator onboarding flow: register → add URLs → set pricing
DEPLOY: Vercel

### Step 3: Smart Contracts
DEPENDS ON: Step 1
BUILD:
  - UserDeposit.sol
  - BatchSettlement.sol
  - CreatorRegistry.sol (on-chain payment routing)
  - ProtocolTreasury.sol
TEST: Full test suite with Hardhat/Foundry
DEPLOY: L2 testnet first (Base Sepolia or Arbitrum Sepolia), then mainnet

### Step 4: Payment Rail Integration
DEPENDS ON: Steps 2 and 3
BUILD:
  - Connect web app to smart contracts (ethers.js or viem)
  - Batch settlement engine (Node.js service or serverless function)
  - Fiat on-ramp integration (Moonpay/Ramp widget)
  - Fiat off-ramp for creators
  - User balance display and management
  - Creator earnings display and withdrawal

### Step 5: SDK
DEPENDS ON: Steps 2 and 4
BUILD:
  - TypeScript npm package
  - Core functions: registryLookup, logAccess, estimateCost, settlePendingEvents
  - Documentation and examples
  - Python wrapper (optional, secondary priority)
PUBLISH: npm, GitHub

### Step 6: Pulse Integration
DEPENDS ON: Step 5
BUILD:
  - Import SDK into Pulse codebase
  - Add registry check to content retrieval flow
  - Add cost estimation to briefing preview
  - Add micropayment cost tracking alongside existing token cost tracking
  - User balance management within Pulse UI

### Step 7: Creator Recruitment & Launch
DEPENDS ON: All previous steps
  - Outreach to independent creators
  - Documentation and onboarding guides
  - Launch content registry for public registration

### Step 8: Developer Recruitment
DEPENDS ON: Step 5
  - SDK documentation site
  - Integration guides and tutorials
  - Developer community outreach

---

## 17. REGULATORY CONSIDERATIONS

### Key Areas
- MONEY TRANSMISSION: Operating a payment system may require money transmitter licenses depending on jurisdiction. Using custodial wallets and handling fiat conversions triggers regulatory requirements. Moonpay/Ramp handle the fiat conversion compliance, which offloads some burden.
- SEC/SECURITIES: Using USDC (not a native token) avoids most securities classification issues. If a governance token is introduced later, securities analysis would be needed.
- KYC/AML: May need Know Your Customer verification for users depositing/withdrawing above certain thresholds. Fiat on-ramp providers handle KYC for their portion.
- TAX REPORTING: Creators earning income through the protocol may need 1099-type reporting above thresholds.
- CONTENT LICENSING: The protocol's terms of service define the license granted when content is accessed (limited, non-cacheable, per-session use). This needs careful legal drafting.

### Approach
- Start lean, operating within existing regulatory frameworks
- Use third-party providers (fiat ramps) to offload compliance where possible
- Budget for legal counsel as the protocol handles real money
- Entity formation early (likely a Delaware LLC or similar)

---

## APPENDIX: KEY DESIGN PRINCIPLES

1. CRYPTO IS INVISIBLE — Users and creators interact with dollars, not tokens or wallets
2. ACCESS-BASED BILLING — Simple, transparent, auditable per-retrieval payments
3. PERMISSIONLESS — Any creator can register, any tool can integrate, no gatekeepers
4. STABLECOIN ONLY — No speculative token dynamics, dollar-denominated throughout
5. BOTTOM-UP GROWTH — Long tail creators and indie developers first, big players follow
6. PROTOCOL NOT PRODUCT — Pulse is a use case, the protocol is the infrastructure
7. COMPLIANCE AS PATH OF LEAST RESISTANCE — Make it cheaper and easier to pay than to circumvent
8. FLOAT FUNDS INFRASTRUCTURE — User balances generate yield that sustains the protocol, reducing need for fees over time
