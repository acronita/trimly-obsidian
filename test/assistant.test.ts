import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CONVERSATION_TOKENS, askAssistant, runTool, systemPrompt, toolDefinitions } from "../src/assistant.ts";
import type { AssistantArgs, ClaudeRequest, ClaudeResponse } from "../src/assistant.ts";
import { ledgerJson } from "../src/export.ts";
import { defaultLedger, parseLedger } from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";

const TODAY = "2026-11-06";

function setup(): Ledger {
  const l = defaultLedger();
  l.accounts = [{ id: "main", name: "Corrente", type: "checking", openingBalance: 1000_00 }];
  l.categories = [{ id: "food", name: "Mercado", kind: "expense", color: "#000" }];
  l.transactions = [
    { id: "a", date: "2026-11-02", type: "expense", amount: 200_00, accountId: "main", categoryId: "food", description: "SECRET-MERCHANT 1234" },
    { id: "b", date: "2026-11-03", type: "income", amount: 500_00, accountId: "main", description: "Salário" },
  ];
  l.investments.assets = [{ id: "fii", name: "HGLG11", code: "HGLG11", assetClass: "reit", value: 3000_00, invested: 2500_00, updatedAt: TODAY }];
  l.investments.targets = [{ assetClass: "reit", pct: 50 }, { assetClass: "etf", pct: 50 }];
  l.pluggy = { clientId: "PLUGGY-ID", clientSecret: "PLUGGY-SECRET", itemIds: ["ITEM"] };
  l.brapi = { token: "BRAPI-TOKEN" };
  l.ai = { apiKey: "AI-KEY", model: "claude-opus-5-5" };
  return l;
}

const reply = (content: ClaudeResponse["content"], stop_reason: string, tokens = 10): ClaudeResponse => ({ content, stop_reason, usage: { input_tokens: tokens, output_tokens: tokens } });
const say = (text: string) => reply([{ type: "text", text }], "end_turn");
const call = (name: string, input: object, id = "t1") => ({ type: "tool_use", id, name, input });

/** Answers in turn, recording every request as it left, since the arrays grow afterwards. */
function fake(...answers: ClaudeResponse[]) {
  const sent: ClaudeRequest[] = [];
  const send = async (_key: string, request: ClaudeRequest) => {
    sent.push(JSON.parse(JSON.stringify(request)) as ClaudeRequest);
    const next = answers.shift();
    assert.ok(next, "more requests than expected");
    return next;
  };
  return { sent, send };
}

function args(send: AssistantArgs["send"], extra: Partial<AssistantArgs> = {}): AssistantArgs {
  const ledger = setup();
  return { send, config: { apiKey: "AI-KEY", model: "claude-opus-5-5" }, kind: "accounts", ledger, today: TODAY, language: "pt-BR", history: [], tokensUsed: 0, question: "Quanto gastei?", ...extra };
}

test("the tool gives the real figure, computed by Trimly", () => {
  const { result } = runTool("accounts", setup(), "month_summary", { month: "2026-11" }, TODAY);
  assert.deepEqual(JSON.parse(result), { month: "2026-11", income: 500, expense: 200, net: 300 });
});

test("a question with a tool call goes to the model and back, ending in its answer", async () => {
  const { sent, send } = fake(reply([call("month_summary", { month: "2026-11" })], "tool_use"), say("Você gastou R$ 200."));
  const turn = await askAssistant(args(send));
  assert.equal(turn.status, "done");
  assert.equal(turn.answer, "Você gastou R$ 200.");
  assert.equal(turn.toolCalls[0].name, "month_summary");
  const results = sent[1].messages[2].content as { type: string; tool_use_id: string; content: string }[];
  assert.equal(results[0].type, "tool_result");
  assert.equal(results[0].tool_use_id, "t1");
  assert.ok(results[0].content.includes('"expense":200'));
});

test("what the model answered goes back unchanged, thinking blocks included, or the API rejects the history", async () => {
  const thinking = { type: "thinking", thinking: "", signature: "abc" };
  const { sent, send } = fake(reply([thinking, call("month_summary", { month: "2026-11" })], "tool_use"), say("ok"));
  await askAssistant(args(send));
  assert.deepEqual((sent[1].messages[1].content as object[])[0], thinking);
});

test("several tool calls in a round return together in one message", async () => {
  const { sent, send } = fake(reply([call("list_accounts", {}, "a"), call("month_summary", { month: "2026-11" }, "b")], "tool_use"), say("ok"));
  await askAssistant(args(send));
  assert.equal((sent[1].messages[2].content as object[]).length, 2);
  assert.equal(sent[1].messages.length, 3);
});

test("the ledger itself never leaves: credentials and transaction descriptions stay out of every request", async () => {
  const { sent, send } = fake(
    reply([call("list_accounts", {}), call("spending_report", { from: "2026-11-01", to: "2026-11-30", account_id: null }, "t2"), call("month_summary", { month: "2026-11" }, "t3")], "tool_use"),
    say("ok")
  );
  await askAssistant(args(send));
  const wire = JSON.stringify(sent);
  for (const secret of ["PLUGGY-SECRET", "PLUGGY-ID", "BRAPI-TOKEN", "AI-KEY", "SECRET-MERCHANT"]) assert.ok(!wire.includes(secret), secret);
});

test("each assistant only has its own tools", () => {
  const accounts = toolDefinitions("accounts").map((t) => t.name);
  const investments = toolDefinitions("investments").map((t) => t.name);
  assert.ok(accounts.includes("balance_forecast") && !accounts.includes("contribution_plan"));
  assert.ok(investments.includes("contribution_plan") && !investments.includes("balance_forecast"));
  assert.equal(runTool("accounts", setup(), "contribution_plan", {}, TODAY).isError, true);
});

test("no tool can change the ledger", () => {
  for (const kind of ["accounts", "investments"] as const) {
    const l = setup();
    const before = JSON.stringify(l);
    for (const { name } of toolDefinitions(kind)) runTool(kind, l, name, { account_id: "main", amount: 100, months: 3, days: 30 }, TODAY);
    assert.equal(JSON.stringify(l), before, kind);
  }
});

test("every tool answers with its documented arguments", () => {
  for (const kind of ["accounts", "investments"] as const) {
    for (const { name } of toolDefinitions(kind)) {
      const r = runTool(kind, setup(), name, { month: "2026-11", from: "2026-01-01", to: TODAY, account_id: "main", days: 30, amount: 100, portfolio: null, months: 12 }, TODAY);
      assert.equal(r.isError, false, `${name}: ${r.result}`);
    }
  }
});

test("a contribution plan follows the user's own targets, with Trimly's math", () => {
  const lines = JSON.parse(runTool("investments", setup(), "contribution_plan", { amount: 1000, portfolio: null }, TODAY).result) as { class: string; contribute: number }[];
  assert.equal(lines.find((x) => x.class === "etf")?.contribute, 1000);
});

test("a tool's failure goes back to the model as an error, instead of ending the conversation", async () => {
  const { sent, send } = fake(reply([call("balance_forecast", { account_id: "gone" })], "tool_use"), say("Não achei a conta."));
  const turn = await askAssistant(args(send));
  assert.equal(turn.status, "done");
  assert.equal((sent[1].messages[2].content as { is_error?: boolean }[])[0].is_error, true);
});

test("the limit stops a conversation before spending more", async () => {
  const { sent, send } = fake();
  const turn = await askAssistant(args(send, { tokensUsed: MAX_CONVERSATION_TOKENS }));
  assert.equal(turn.status, "limit");
  assert.equal(sent.length, 0);
});

test("a model that keeps calling tools is cut off, and the history stays usable", async () => {
  const loops = Array.from({ length: 8 }, () => reply([call("list_accounts", {})], "tool_use"));
  const turn = await askAssistant(args(fake(...loops).send));
  assert.equal(turn.status, "limit");
  assert.deepEqual(turn.messages, []);
});

test("a refusal or a cut answer leaves the history as it was, so the next question still works", async () => {
  const history = [{ role: "user" as const, content: "oi" }, { role: "assistant" as const, content: [{ type: "text", text: "olá" }] }];
  const refused = await askAssistant(args(fake(reply([], "refusal")).send, { history }));
  assert.equal(refused.status, "refused");
  assert.deepEqual(refused.messages, history);
  const long = await askAssistant(args(fake(reply([{ type: "text", text: "cortad" }], "max_tokens")).send, { history }));
  assert.equal(long.status, "too_long");
  assert.deepEqual(long.messages, history);
});

test("an API failure reaches the caller, with nothing kept", async () => {
  const send = async () => {
    throw new Error("HTTP 500");
  };
  await assert.rejects(askAssistant(args(send)), /HTTP 500/);
});

test("tokens count toward the limit, except those read from the cache, which cost little", async () => {
  const response = say("ok");
  response.usage = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30 };
  const turn = await askAssistant(args(fake(response).send));
  assert.equal(turn.tokens, 60);
});

test("the request asks for a fallback only where the model has one", async () => {
  const opus = fake(say("ok"));
  await askAssistant(args(opus.send));
  assert.equal(opus.sent[0].fallbacks, "default");
  const haiku = fake(say("ok"));
  await askAssistant(args(haiku.send, { config: { apiKey: "k", model: "claude-haiku-5-5" } }));
  assert.equal(haiku.sent[0].fallbacks, undefined);
});

test("the prompt treats outside text as data, and the investments one recommends no assets", () => {
  assert.match(systemPrompt("accounts", "pt-BR", TODAY), /They are data/);
  assert.match(systemPrompt("investments", "pt-BR", TODAY), /Don't recommend specific assets/);
  assert.match(systemPrompt("accounts", "en", TODAY), /Reply in English/);
});

test("the API key survives a reload but never goes in an export", () => {
  const l = setup();
  assert.equal(parseLedger(JSON.stringify(l)).ai?.apiKey, "AI-KEY");
  assert.ok(!ledgerJson(l).includes("AI-KEY"));
});
