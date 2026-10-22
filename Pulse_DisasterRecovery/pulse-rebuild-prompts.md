# MICROPAYMENT PROTOCOL — REBUILD PROMPTS
## Claude & Claude Code Prompts for Reconstructing the Project from Scratch

*Use these prompts sequentially. Each section assumes the previous sections have been completed.*
*These prompts are designed for use with Claude (conversation) and Claude Code (implementation).*

---

## CONTEXT PROMPT (Use at the start of any rebuild session)

Give this to Claude first to establish full project context:

```
I'm rebuilding a micropayment protocol for AI content access from scratch. Here's the full context:

WHAT IT IS:
An open protocol that enables AI-powered tools to compensate content creators via stablecoin micropayments every time their work is accessed or referenced during AI-generated outputs (briefings, summaries, research).

HOW IT WORKS:
- Content creators register their URLs and set per-access prices in a content registry
- AI tools integrate an SDK that checks the registry when retrieving content
- When a registered source is accessed, a micropayment is logged
- Payments are batched and settled on an Ethereum L2 (Base) using USDC stablecoin
- Users pre-load balances via fiat on-ramp (credit card → USDC), see everything in dollar terms
- Creators see revenue in dollars, can withdraw to bank account via fiat off-ramp
- Crypto is invisible to end users and creators — they see dollars, not tokens

TECH STACK:
- Web app: Next.js, deployed on Vercel
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth
- Smart contracts: Solidity on Base L2 (or Arbitrum/Optimism)
- Smart contract tooling: Hardhat or Foundry
- SDK: TypeScript npm package (with optional Python wrapper)
- Fiat ramps: Moonpay, Ramp, or Coinbase Onramp (third-party widget)
- Blockchain interaction: ethers.js or viem

DESIGN PRINCIPLES:
- Crypto is invisible to users and creators (dollar-denominated UX)
- Access-based billing (pay per retrieval, not contribution-weighted)
- Stablecoin only (USDC, no native token)
- Permissionless (any creator registers, any tool integrates)
- Custodial wallets by default (optional self-custody for power users)
- Batch settlement (not per-transaction) to minimize gas
- The protocol is infrastructure, not a product. Pulse (my AI briefing app) is the first tool to integrate it.

DESIGN LANGUAGE (consistent with my other apps):
- Warm editorial aesthetic
- Cream backgrounds, warm charcoal text, muted indigo accents
- Serif headings, clean and minimal with generous whitespace
- Inspired by Notion, Linear, mymind.com

I need your help rebuilding [SPECIFIC COMPONENT]. Let me know what questions you have before we start.
```

---

## PHASE 1: INFRASTRUCTURE SETUP

### Prompt 1.1 — Project Initialization (Claude Code)

```
Initialize a new Next.js project for the micropayment protocol content registry and web dashboard. Set up the following:

1. Next.js with TypeScript, App Router
2. Tailwind CSS configured with my design tokens:
   - Background: cream (#FDF8F0 or similar warm off-white)
   - Text: warm charcoal (#2D2A26 or similar)
   - Accent: muted indigo (#5C6BC0 or similar)
   - Serif font for headings (e.g., Georgia or a web font)
   - Sans-serif for body text
3. Supabase client configured (I'll provide the URL and anon key)
4. Environment variables structure (.env.local.example) for:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - L2_RPC_URL (Base mainnet/testnet)
   - CONTRACT_ADDRESSES (placeholder)
5. Basic project structure:
   - /app (pages)
   - /components (shared UI)
   - /lib (utilities, supabase client, blockchain client)
   - /contracts (Solidity, separate Hardhat/Foundry setup)
   - /sdk (the npm package source)
6. ESLint and Prettier configured
7. README with project overview

This project uses Supabase table prefixes (e.g., mp_ for micropayment protocol) since I share a Supabase instance across multiple apps. All tables should be prefixed with mp_.
```

### Prompt 1.2 — Supabase Schema (Claude Code)

```
Create the Supabase migration SQL for the micropayment protocol database schema. All tables prefixed with mp_. Here's what I need:

TABLES:

mp_creators
- id (uuid, primary key)
- email (text, unique)
- display_name (text)
- payment_address (text, nullable — their on-chain address for withdrawals)
- created_at (timestamptz)
- updated_at (timestamptz)
- status (text: 'active', 'suspended', 'pending')

mp_content_entries
- id (uuid, primary key)
- creator_id (uuid, FK to mp_creators)
- url_pattern (text — could be exact URL or domain pattern like "*.substack.com/username/*")
- price_per_access (numeric(20,6) — in USD, supports micropayment precision)
- content_type (text: 'article', 'blog', 'newsletter', 'research', 'other')
- title (text, nullable — display name for the content)
- created_at (timestamptz)
- updated_at (timestamptz)
- is_active (boolean, default true)

mp_access_logs
- id (uuid, primary key)
- user_id (uuid, FK to mp_users)
- creator_id (uuid, FK to mp_creators, nullable — null if content is unregistered)
- content_entry_id (uuid, FK to mp_content_entries, nullable)
- content_url (text — the actual URL accessed)
- tool_id (text — identifier for the AI tool that made the access)
- price (numeric(20,6) — the amount charged for this access)
- session_id (text — groups accesses within a single user session/briefing)
- settlement_batch_id (uuid, nullable — null until settled)
- created_at (timestamptz)

mp_users
- id (uuid, primary key)
- email (text, unique)
- display_name (text)
- balance (numeric(20,6) — current USDC balance in USD terms)
- max_price_per_access (numeric(20,6), nullable — user's ceiling per single access)
- daily_budget (numeric(20,6), nullable)
- monthly_budget (numeric(20,6), nullable)
- deposit_address (text, nullable — their custodial wallet address)
- created_at (timestamptz)
- updated_at (timestamptz)

mp_settlement_batches
- id (uuid, primary key)
- total_amount (numeric(20,6))
- total_events (integer)
- transaction_hash (text, nullable — on-chain tx hash)
- status (text: 'pending', 'submitted', 'confirmed', 'failed')
- created_at (timestamptz)
- settled_at (timestamptz, nullable)

mp_creator_earnings
- id (uuid, primary key)
- creator_id (uuid, FK to mp_creators)
- settlement_batch_id (uuid, FK to mp_settlement_batches)
- amount (numeric(20,6))
- fee_amount (numeric(20,6) — protocol fee deducted)
- created_at (timestamptz)

mp_unclaimed_escrow
- id (uuid, primary key)
- content_url (text — URL of unregistered content that was accessed)
- total_amount (numeric(20,6) — accumulated payments waiting for creator to register)
- access_count (integer)
- first_access_at (timestamptz)
- last_access_at (timestamptz)
- claimed_by (uuid, FK to mp_creators, nullable)
- claimed_at (timestamptz, nullable)

Add appropriate indexes:
- mp_content_entries: index on url_pattern for fast registry lookups
- mp_access_logs: index on (user_id, created_at), (creator_id, created_at), (settlement_batch_id)
- mp_unclaimed_escrow: index on content_url

Add Row Level Security policies:
- Creators can read/update their own profiles and content entries
- Users can read their own profile and access logs
- Access logs are insert-only from service role (SDK writes via service key)
- Public read on content_entries (registry lookups need to be fast and unauthenticated)
```

---

## PHASE 2: CONTENT REGISTRY WEB APP

### Prompt 2.1 — Creator Dashboard (Claude Code)

```
Build the creator-facing dashboard for the micropayment protocol. This is a Next.js app using Supabase for auth and data. Design language: warm editorial — cream backgrounds, warm charcoal text, muted indigo accents, serif headings, generous whitespace.

PAGES NEEDED:

/creator/register — Creator signup/onboarding
- Email/password registration via Supabase Auth
- Display name
- After registration, redirect to dashboard

/creator/dashboard — Main dashboard showing:
- Total earnings (all time, this month, this week)
- Recent access activity (which content was accessed, by which tools, when)
- Quick stats: total registered URLs, total accesses, average revenue per access
- Chart showing earnings over time (daily/weekly/monthly toggle)

/creator/content — Content management
- List of registered content entries with URL, price, status
- Add new content entry: URL pattern, price per access, content type, title
- Edit existing entries (change price, toggle active/inactive)
- Bulk actions

/creator/earnings — Detailed earnings view
- Breakdown by content entry
- Breakdown by AI tool
- Settlement history (batches, amounts, on-chain transaction links)
- Withdrawal button (placeholder for now — will connect to fiat off-ramp later)

/creator/settings — Account settings
- Profile info
- Payment address (wallet address for on-chain withdrawals)
- Notification preferences

Use recharts for any charts. Keep the UI clean and minimal. This should feel like a professional dashboard, not a crypto app.
```

### Prompt 2.2 — User Dashboard (Claude Code)

```
Build the user-facing dashboard for the micropayment protocol. Same design language as the creator dashboard. Users are people who use AI tools (like Pulse) that integrate the protocol.

PAGES NEEDED:

/user/register — User signup
- Email/password via Supabase Auth
- Display name

/user/dashboard — Main dashboard showing:
- Current balance (in USD)
- Spending summary (today, this week, this month)
- Recent activity: list of content accesses with source, tool, cost
- "Add Funds" button (placeholder for fiat on-ramp)

/user/activity — Detailed activity log
- All access events with: timestamp, content URL, creator name, tool name, cost
- Filter by date range, tool, creator
- Session grouping (show accesses grouped by briefing/session)
- Running cost per session

/user/settings — Account settings
- Profile info
- Spending controls: max price per access, daily budget, monthly budget
- Connected tools (which AI tools are authorized to spend from this account)

/user/billing — Billing and deposits
- Balance and deposit history
- "Add Funds" CTA (placeholder widget area for Moonpay/Ramp)
- Transaction history (deposits, settlements)
```

### Prompt 2.3 — Registry API (Claude Code)

```
Build the public API endpoints for the content registry. These are called by the SDK when AI tools need to check if a URL is registered and get pricing info. They need to be fast and unauthenticated (public read).

API ROUTES (Next.js API routes):

GET /api/registry/lookup?url={url}
- Input: a content URL
- Logic: check mp_content_entries for matching url_pattern
  - Exact match first
  - Then domain/pattern matching (e.g., if "example.substack.com/*" is registered, any URL under that domain matches)
- Response: { registered: true, creatorId, creatorName, pricePerAccess, contentType } or { registered: false }
- Must be very fast — this is called on every content retrieval

POST /api/registry/batch-lookup
- Input: { urls: string[] }
- Logic: same as above but for multiple URLs at once (more efficient for tools building briefings)
- Response: array of lookup results

POST /api/access/log
- Auth: API key (tool-level authentication, not user auth)
- Input: { userId, contentUrl, creatorId, contentEntryId, price, toolId, sessionId }
- Logic: insert into mp_access_logs, deduct from user balance
- Validates: user has sufficient balance, price doesn't exceed user's max_price_per_access

POST /api/access/estimate
- Input: { urls: string[] }
- Logic: batch lookup + sum prices
- Response: { totalEstimatedCost, registeredSources: number, unregisteredSources: number, breakdown: [...] }
- Used by tools to show cost prediction before running a briefing

GET /api/user/balance?userId={id}
- Auth: API key
- Response: { balance, dailySpend, monthlySpend }
```

---

## PHASE 3: SMART CONTRACTS

### Prompt 3.1 — Smart Contract Development (Claude Code)

```
Set up a Hardhat (or Foundry) project for the micropayment protocol smart contracts. These will be deployed on Base L2 (Ethereum L2 by Coinbase).

CONTRACTS TO BUILD:

1. UserDeposit.sol
- Manages user USDC balances on-chain
- Functions:
  - deposit(uint256 amount) — user deposits USDC (requires prior USDC approval)
  - withdraw(uint256 amount) — user withdraws USDC
  - getBalance(address user) — returns balance
  - deductBatch(address[] users, uint256[] amounts) — only callable by authorized settlement contract
- Uses OpenZeppelin for access control and reentrancy protection
- Interacts with USDC ERC-20 contract on Base

2. BatchSettlement.sol
- Processes batched access events
- Functions:
  - submitBatch(BatchEvent[] events) — array of {userAddress, creatorAddress, amount}
  - Deducts from users via UserDeposit, credits creators, takes protocol fee
  - Emits events for each settlement for transparency
- Only callable by authorized submitter addresses (registered AI tools/settlement engine)

3. CreatorRegistry.sol
- On-chain record of creator payment addresses
- Functions:
  - registerCreator(bytes32 creatorId, address paymentAddress)
  - updatePaymentAddress(bytes32 creatorId, address newAddress)
  - getPaymentAddress(bytes32 creatorId)
- Only creators can update their own addresses

4. ProtocolTreasury.sol
- Collects protocol fees from settlements
- Functions:
  - collectFees() — receives fee portion from BatchSettlement
  - withdrawForOperations(uint256 amount, address to) — only owner
- Simple treasury, yield deployment can be added later

Include:
- Full test suite with 90%+ coverage
- Deployment scripts for Base Sepolia (testnet) and Base mainnet
- Gas optimization (this needs to be cheap per batch)
- USDC address configuration (different on testnet vs mainnet)
- Clear comments explaining each function's role in the protocol

The USDC contract address on Base mainnet is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
Use the Base Sepolia testnet for development.
```

---

## PHASE 4: SDK

### Prompt 4.1 — SDK Package (Claude Code)

```
Build the TypeScript SDK npm package for the micropayment protocol. This is what AI tool developers integrate to make their tools protocol-compliant.

PACKAGE NAME: @content-protocol/sdk (or similar — we can rename later)

STRUCTURE:
/sdk
  /src
    index.ts — main exports
    client.ts — ContentProtocol class
    registry.ts — registry lookup functions
    access.ts — access logging functions
    settlement.ts — batch settlement functions
    types.ts — TypeScript interfaces and types
  /tests
    client.test.ts
    registry.test.ts
  package.json
  tsconfig.json
  README.md

MAIN CLASS: ContentProtocol

Constructor:
new ContentProtocol({
  apiKey: string,          // tool's API key for authentication
  toolId: string,          // identifier for this AI tool
  registryUrl: string,     // URL of the content registry API (default to production)
  autoSettle: boolean,     // if true, automatically settle batches periodically (default: true)
  settlementInterval: number // ms between auto-settlements (default: 3600000 = 1 hour)
})

Methods:

async registryLookup(url: string): Promise<RegistryResult | null>
  - Checks if a URL is registered
  - Returns creator info and price, or null

async batchLookup(urls: string[]): Promise<RegistryResult[]>
  - Batch version of registryLookup

async logAccess(event: AccessEvent): Promise<void>
  - Logs a content access event
  - AccessEvent: { userId, contentUrl, creatorId?, price?, sessionId? }
  - If creatorId/price not provided, does a registry lookup first

async estimateCost(urls: string[]): Promise<CostEstimate>
  - Returns: { totalCost, registeredSources, unregisteredSources, breakdown }

async getUserBalance(userId: string): Promise<BalanceInfo>
  - Returns: { balance, dailySpend, monthlySpend }

async settlePendingEvents(): Promise<SettlementResult>
  - Manually trigger settlement of accumulated events

Internal:
- Maintains a local queue of unsettled access events
- If autoSettle is true, flushes the queue periodically
- Handles retries and error cases gracefully
- Caches registry lookups for a configurable TTL (default 5 min) to reduce API calls

Include comprehensive JSDoc comments and a README with quick-start guide and examples.
```

---

## PHASE 5: PULSE INTEGRATION

### Prompt 5.1 — Integrate Protocol into Pulse (Claude Code)

```
Integrate the micropayment protocol SDK into Pulse, my AI briefing app. Pulse is a Next.js PWA on Vercel with Supabase backend.

INTEGRATION POINTS:

1. Content Retrieval Hook
- Wherever Pulse retrieves web content to build a briefing, add the protocol check:
  a. After fetching content from a URL, call protocol.registryLookup(url)
  b. If registered, call protocol.logAccess() with the user's ID, URL, and price
  c. Continue with normal briefing generation

2. Cost Estimation
- Before generating a briefing, Pulse should estimate the micropayment cost
- Similar to how it already shows estimated Claude API token cost
- Show: "Estimated content access cost: ~$0.08 (32 registered sources)"
- User can proceed or cancel

3. Balance Display
- Add user's micropayment balance to the Pulse UI
- Show current balance, with "Add Funds" link to the protocol user dashboard
- Low balance warning when balance drops below a threshold

4. Session Tracking
- Each briefing generation is a "session"
- All content accesses within a briefing share a session ID
- After briefing completes, show a breakdown: "This briefing accessed 45 sources. 32 were registered creators who earned a total of $0.11 from your briefing."

5. Cost Tracking
- Pulse already tracks Claude API costs per briefing
- Add a parallel tracking for micropayment costs
- Combined view: "This briefing cost $0.03 in API tokens + $0.08 in content access = $0.11 total"

Keep the integration lightweight. The protocol SDK handles all the complexity. Pulse just needs to call the SDK at the right moments and display the results.
```

---

## PHASE 6: LAUNCH & OPERATIONS

### Prompt 6.1 — Creator Onboarding Materials (Claude)

```
Help me write the outreach and onboarding content for independent content creators joining the micropayment protocol. I need:

1. A cold outreach email/DM template for reaching out to Substack writers, bloggers, and independent journalists. The pitch: "You're already being accessed by AI tools for free. Register your content and start earning micropayments automatically."

2. A simple onboarding guide (step by step) that a non-technical creator can follow to register their content and set pricing. Should take under 5 minutes.

3. A FAQ addressing:
   - How much can I earn? (honest ranges based on content volume)
   - How does pricing work? (creator sets price, suggested defaults)
   - Do I need to understand crypto? (no, everything is in dollars)
   - Does this affect my existing monetization? (no, it's additive)
   - What AI tools are using this? (Pulse currently, SDK available for any tool)
   - How do I get paid? (withdrawal to bank account)
   - What about my existing content? (register URLs, earn on all future AI access)
   - What if I'm on Substack/Medium? (you register directly, no platform action needed)

Tone: warm, straightforward, not salesy. This is genuinely a good deal for creators and it should sound like it.
```

### Prompt 6.2 — Developer Documentation (Claude)

```
Help me write the developer documentation for the micropayment protocol SDK. This is for indie developers building AI-powered tools who want to integrate content creator compensation.

Structure:
1. Quick Start — get integrated in 10 minutes
2. Full API Reference — every method, parameter, and return type
3. Integration Patterns — common patterns for different types of AI tools:
   - RAG applications
   - AI research assistants
   - Content aggregators/briefing tools
   - Chatbots with web retrieval
4. Cost Estimation — how to show users predicted costs before running queries
5. Settlement — how batching works, when settlements happen, error handling
6. Authentication — how to get an API key, how tool authentication works
7. Testing — how to test against a sandbox/testnet environment
8. FAQ for developers

Tone: clear, concise, technical but approachable. Think Stripe's documentation style — developer-friendly, lots of code examples, no unnecessary jargon.
```

---

## TROUBLESHOOTING PROMPTS

### If the Supabase schema needs to be rebuilt:
```
I need to rebuild the Supabase database schema for the micropayment protocol. All tables use the mp_ prefix. Here's what I need: [paste the schema from Prompt 1.2 or modify as needed]
```

### If the smart contracts need to be redeployed:
```
I need to redeploy the micropayment protocol smart contracts to Base L2. The contracts are: UserDeposit, BatchSettlement, CreatorRegistry, and ProtocolTreasury. They interact with USDC on Base. Help me verify the contracts, run tests, and deploy to [testnet/mainnet].
```

### If the SDK needs to be republished:
```
I need to rebuild and republish the micropayment protocol TypeScript SDK. The package is @content-protocol/sdk. It provides: registryLookup, logAccess, estimateCost, getUserBalance, and settlePendingEvents. Help me rebuild it, run tests, and publish to npm.
```

### If Pulse integration needs to be restored:
```
I need to re-integrate the micropayment protocol into Pulse, my AI briefing app. The integration points are: content retrieval hook (registry check + access logging), cost estimation before briefing generation, balance display, session tracking, and cost tracking alongside Claude API costs. The SDK is @content-protocol/sdk.
```

---

## GENERAL SESSION SETUP FOR ANY REBUILD WORK

Always start Claude Code sessions with this project context in your CLAUDE.md:

```markdown
# Micropayment Protocol

## Overview
Open micropayment protocol for AI content access compensation. Stablecoin (USDC) payments on Base L2.

## Tech Stack
- Web app: Next.js (TypeScript), Vercel, Supabase
- Smart contracts: Solidity, Hardhat/Foundry, Base L2
- SDK: TypeScript npm package
- Stablecoin: USDC on Base
- Design: Warm editorial — cream, charcoal, indigo, serif headings

## Database
Supabase with mp_ table prefix. Key tables: mp_creators, mp_content_entries, mp_access_logs, mp_users, mp_settlement_batches, mp_creator_earnings, mp_unclaimed_escrow

## Key Patterns
- Custodial wallets (users don't see crypto)
- Access-based billing (pay per retrieval)
- Batch settlement (hourly/daily, not per-transaction)
- Registry lookup on every content access
- Cost estimation before briefing generation

## Related Apps
- Pulse (AI briefing app, first protocol integration)
- All apps share Supabase instance with table prefixes
```
