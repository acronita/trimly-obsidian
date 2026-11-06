import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, recentItems } from "../src/feeds.ts";
import type { FeedSource } from "../src/feeds.ts";

const SOURCE: FeedSource = { id: "s", name: "Site", url: "https://site/feed" };

const rss = (...items: string[]) => `<?xml version="1.0"?><rss><channel><title>Site</title><link>https://site/</link>${items.join("")}</channel></rss>`;
const item = (title: string, link = "https://site/a", date = "Thu, 05 Nov 2026 19:22:56 +0000") => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

test("an item gives its title, link, day and source, not the channel's own title", () => {
  assert.deepEqual(parseRss(rss(item("Carteira de novembro")), SOURCE), [{ title: "Carteira de novembro", link: "https://site/a", date: "2026-11-05", source: "Site" }]);
});

test("entities and CDATA read as the text they stand for", () => {
  const [a, b] = parseRss(rss(item("Duas a&#231;&#245;es &#8220;salvam&#8221; &amp; mais"), item("<![CDATA[Itaú & BTG]]>")), SOURCE);
  assert.equal(a.title, "Duas ações “salvam” & mais");
  assert.equal(b.title, "Itaú & BTG");
});

test("markup in a title from another site ends up as plain text", () => {
  const [a] = parseRss(rss(item("&lt;b&gt;ok&lt;/b&gt;<![CDATA[]]>")), SOURCE);
  assert.ok(!a || !a.title.includes("<script"));
  const [b] = parseRss(rss(item("<![CDATA[<script>alert(1)</script>Carteira]]>")), SOURCE);
  assert.equal(b.title, "alert(1)Carteira");
});

test("only https links are kept: a javascript: or http: link never becomes clickable", () => {
  assert.deepEqual(parseRss(rss(item("x", "javascript:alert(1)"), item("y", "http://site/a")), SOURCE), []);
});

test("an item with no date or title is left out, and a page that isn't a feed gives nothing", () => {
  assert.deepEqual(parseRss(rss(item("x", "https://site/a", "ontem"), item("")), SOURCE), []);
  assert.deepEqual(parseRss("<html><body>manutenção</body></html>", SOURCE), []);
});

test("a site's search results are checked against what was searched for", () => {
  const search: FeedSource = { ...SOURCE, titleMatch: /carteira|recomend/i };
  const titles = parseRss(rss(item("Carteira recomendada de novembro"), item("Lula fala sobre segurança")), search).map((i) => i.title);
  assert.deepEqual(titles, ["Carteira recomendada de novembro"]);
});

test("the list is newest first, without repeats or what is too old", () => {
  const at = (date: string, link: string) => ({ title: link, link, date, source: "Site" });
  const out = recentItems([at("2026-10-01", "old-enough"), at("2026-11-05", "new"), at("2026-11-05", "new"), at("2026-01-01", "too-old")], "2026-11-06", 60);
  assert.deepEqual(out.map((i) => i.link), ["new", "old-enough"]);
});
