import type { App } from "obsidian";
import type { AssistantKind, ChatMessage, ToolCall } from "./assistant.ts";
import type { EncryptedStore } from "./store.ts";

const STORAGE_KEY = "trimly-chats";
/** localStorage is small; the oldest conversations go first. */
const MAX_CHATS = 50;
/** Past this a save would run into the browser's quota, and every later one would fail too. */
const MAX_CHARS = 4_000_000;

export interface SavedChat {
  id: string;
  kind: AssistantKind;
  title: string;
  /** ISO timestamp of the last message */
  updatedAt: string;
  /** what goes to the API */
  messages: ChatMessage[];
  /** what the user sees */
  log: ({ role: "user" | "assistant" | "notice"; text: string } | { role: "tool"; calls: ToolCall[] })[];
  tokens: number;
}

/** Newest first, without what doesn't fit. */
export function trimChats(chats: SavedChat[]): SavedChat[] {
  let chars = 0;
  return [...chats]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, MAX_CHATS)
    .filter((chat, i) => {
      chars += JSON.stringify(chat).length;
      return i === 0 || chars <= MAX_CHARS;
    });
}

/**
 * The assistants' conversations, kept apart from the ledger in this device's
 * localStorage, outside the vault, so they never sync. They hold financial data, so
 * they are encrypted with the ledger's key all the same.
 */
export class ChatStore {
  private app: App;
  private store: Pick<EncryptedStore, "seal" | "unseal">;
  private passphrase: () => string | null;

  constructor(app: App, store: Pick<EncryptedStore, "seal" | "unseal">, passphrase: () => string | null) {
    this.app = app;
    this.store = store;
    this.passphrase = passphrase;
  }

  /** Empty when there is nothing, or it can't be read, as after changing the passphrase. */
  async load(): Promise<SavedChat[]> {
    const stored: unknown = this.app.loadLocalStorage(STORAGE_KEY);
    const passphrase = this.passphrase();
    if (typeof stored !== "string" || !stored || !passphrase) return [];
    const text = await this.store.unseal(stored, passphrase);
    if (text === null) return [];
    try {
      return JSON.parse(text) as SavedChat[];
    } catch {
      return [];
    }
  }

  async save(chats: SavedChat[]): Promise<void> {
    const sealed = await this.store.seal(JSON.stringify(trimChats(chats)));
    this.app.saveLocalStorage(STORAGE_KEY, sealed);
  }
}
