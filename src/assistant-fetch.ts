import { requestUrl } from "obsidian";
import { t } from "./i18n";
import type { ClaudeRequest, ClaudeResponse } from "./assistant";

/**
 * Plain HTTP through Obsidian's requestUrl: the dependency policy asks for approval
 * before a new package, and a plugin can't count on CORS for fetch.
 */
export async function sendToClaude(apiKey: string, request: ClaudeRequest): Promise<ClaudeResponse> {
  const res = await requestUrl({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    throw: false,
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      ...(request.fallbacks ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
    },
    body: JSON.stringify(request),
  });
  if (res.status === 401) throw new Error(t.assistant.badKey);
  if (res.status === 429) throw new Error(t.assistant.rateLimited);
  if (res.status >= 300) {
    let detail = "";
    try {
      detail = (res.json as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      // not JSON: the status says enough
    }
    throw new Error(t.assistant.apiError(res.status, detail));
  }
  return res.json as ClaudeResponse;
}
