import { requestUrl } from "obsidian";
import { parseRss } from "./feeds";
import type { FeedItem, FeedSource } from "./feeds";

export interface FeedFetch {
  items: FeedItem[];
  /** names of the sources that could not be read; the others still count */
  failed: string[];
}

export async function fetchFeeds(sources: FeedSource[]): Promise<FeedFetch> {
  const out: FeedFetch = { items: [], failed: [] };
  await Promise.all(
    sources.map(async (source) => {
      try {
        const res = await requestUrl({ url: source.url, throw: false });
        if (res.status >= 300) out.failed.push(source.name);
        else out.items.push(...parseRss(res.text, source));
      } catch {
        out.failed.push(source.name);
      }
    })
  );
  return out;
}
