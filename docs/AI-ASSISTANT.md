# AI assistant: research and proposed design

Status: **not built.** This is the research the roadmap asks for before building its optional AI
assistant (2026-11-05), and the decisions needed to start. Nothing here ships, and Trimly sends nothing to
any AI provider.

## What other apps do

Most of this comes from reviews and vendor material, not independent tests, so treat it as a direction.

- **Monarch** answers questions on transactions, accounts and net worth in plain language. Reviews praise how
  it handles casual phrasing and tie its quality to which institutions are connected. The company says
  nothing reaches the model unless the user starts a conversation (secondhand, via a forum post).
- **Organizze** advertises connections to ChatGPT and Claude. The only implementation found was a third-party
  open source MCP server over its API, not checked against the current API.
- **Cleo** reports sending calculations to deterministic tools and using the model only for intent and wording,
  and that only that design got bill totals and percentages right in its own 129-transaction benchmark. It
  is the vendor's claim, with an unverified dataset.
- Practitioners describe the same failure: a confident, well written answer with wrong math, fixed by moving the
  math to code.

No independent, peer-reviewed accuracy benchmark for finance assistants was found. Trimly needs its own test
set.

Sources: [Monarch's assistant](https://getfinny.app/blog/monarch-money-ai-assistant-2026),
[Monarch review](https://personal-finance-tools.pages.dev/blog/monarch-money-winter-2026-review),
[MCP Organizze](https://mcpservers.org/zh-CN/servers/samuelmoraesf/mcp-organizze),
[Cleo's benchmark](https://meetcleo.vercel.app/blog/cleo-vs-the-rest-evaluating-ai-models-on-real-world-money-questions),
[why not to use GenAI for budget math](https://dev.to/ericrodriguez10/day-91-why-i-stopped-using-genai-for-budgeting-math-1d4k),
[ToolMinimize (preprint, results not verified)](https://arxiv.org/pdf/2608.24957).

## Proposed design

- **Off by default.** Turning it on asks for the user's own API key, kept in the encrypted ledger like the
  Pluggy credentials, and the README says what leaves the device and to where.
- **The ledger is never sent.** The model calls tools Trimly exposes and receives only their results, so
  Trimly does the math and less data leaves. Tools reuse existing pure functions:

  | Assistant | Tools | Existing code |
  |---|---|---|
  | Accounts | balances, month summary, spending by category over a period, subscriptions, balance forecast, debts | `accountBalance`, `buildReport`, `balanceForecast`, `debtPayoff` |
  | Investments | allocation against targets, returns, contribution plan, proventos, income tax estimate | `allocationByClass`, `rebalance`, `assetTargets`, `taxMonths` |

- **Two assistants, two prompts**, each with only its own tools, in its own mode of the panel.
- **Show what is sent.** Each tool result can be opened in the chat before and after it goes out, and tool calls
  can be set to ask first.
- **Nothing in plaintext in the vault.** Conversations stay in memory by default. If kept, they go in the
  encrypted ledger, under the encryption rule.
- **Text from outside is data.** Transaction descriptions come from banks and stores, so a description could
  carry instructions to the model. Tools return them as data, the prompt says so, and no tool writes to the
  ledger or moves money.
- **Cost limit.** A per-conversation token limit, with usage shown.
- **Answers state the numbers' source.** Any figure in an answer must come from a tool result.

## How to evaluate it

Questions with known answers over a fictitious ledger, graded by code: the figure in the answer has to match
what the pure function returns. Include questions that must be refused or answered with "I don't know", such as
"which stock should I buy?". Running it spends API credits, so it needs the user's key and their go-ahead.

## Decisions needed before building

1. **Provider.** The roadmap says the user picks one. Supporting one first (Claude, through Anthropic's API) is
   far less code and testing than several; each extra provider has its own tool format.
2. **New dependency.** Anthropic's official SDK (`@anthropic-ai/sdk`) is the recommended way to call Claude, and
   [the dependency policy](DEPENDENCIES.md) requires approval for a new package. It adds to the bundle, and
   Obsidian's `requestUrl` would need to replace the SDK's `fetch`, since plugins can't count on CORS.
3. **Testing.** Nothing can be checked against the real model without an API key.
