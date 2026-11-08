# AI assistant: research and proposed design

Status: **built in 0.34.0, never run against the real API.** This is the research the roadmap asks for before
building its optional AI assistant (2026-11-05), the design that shipped, and what is still open. It is off by
default: nothing goes to any AI provider until the user adds a key.

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

## Design

- **Off by default.** A toggle in the settings (`assistant` in `data.json`) shows the tabs, and turning it on first
  warns that financial data goes to Anthropic; dismissing the warning leaves it off. It then asks for the user's own API key, kept in the encrypted ledger like the
  Pluggy credentials, and the README says what leaves the device and to where.
- **The ledger is never sent.** The model calls tools Trimly exposes and receives only their results, so
  Trimly does the math and less data leaves. Tools reuse existing pure functions:

  | Assistant | Tools | Existing code |
  |---|---|---|
  | Accounts | balances, month summary, spending by category over a period, subscriptions, balance forecast, debts | `accountBalance`, `buildReport`, `balanceForecast`, `debtPayoff` |
  | Investments | allocation against targets, returns, contribution plan, proventos, income tax estimate | `allocationByClass`, `rebalance`, `assetTargets`, `taxMonths` |

- **Two assistants, two prompts**, each with only its own tools, in its own mode of the panel.
- **Show what is sent.** Each tool result can be opened in the chat. It is shown as it goes, with no step to
  approve each one first.
- **Nothing in plaintext in the vault.** Conversations are kept on the device, in localStorage and outside the vault,
  encrypted with the ledger's key. Changing the passphrase makes older ones unreadable.
- **The web without the user.** The model reads recommended portfolios through tools that run on the device, only from
  the sites of the feeds. There is no general search: Anthropic's web tools would let the model put tickers in a query.
- **Text from outside is data.** Transaction descriptions come from banks and stores, so a description could
  carry instructions to the model. Tools return them as data, the prompt says so, and no tool writes to the
  ledger or moves money.
- **Cost limit.** A per-conversation token limit, with usage shown.
- **Answers state the numbers' source.** Any figure in an answer must come from a tool result.

## How to evaluate it

Questions with known answers over a fictitious ledger, graded by code: the figure in the answer has to match
what the pure function returns. Include questions that must be refused or answered with "I don't know", such as
"which stock should I buy?". Running it spends API credits, so it needs the user's key and their go-ahead.

## Choices made, and still open

1. **Claude only, for now.** The roadmap says the user picks a provider. Each extra one has its own tool format
   and its own testing, so the others wait until this one has been used.
2. **No new dependency.** Requests are plain HTTP through Obsidian's `requestUrl`, since [the dependency
   policy](DEPENDENCIES.md) asks for approval before a new package and plugins can't count on CORS. Anthropic's
   official SDK is the usual way to call Claude; moving to it is a decision for the user.
3. **The model is a setting**, with Claude Opus 5.5 by default. It isn't chosen per task, as the roadmap's research
   item suggests. The request asks for the server-side fallback on Opus and Sonnet, so a declined request is
   retried on another model.
4. **Not run against the real API.** The tests use a fake transport, and the evaluation above hasn't been run: it
   needs a key and spends credits.
