import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_SOURCES, NEWS_SOURCES, PORTFOLIO_SOURCES, articleText, isFeedSite, newsForTickers, newsPages, parseRss, portfolioGroups, recentItems } from "../src/feeds.ts";
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

const SEARCH: FeedSource = { ...SOURCE, portfolio: "search" };
const TAG: FeedSource = { ...SOURCE, portfolio: "tag" };
const kindOf = (title: string, source = SEARCH) => parseRss(rss(item(title)), source)[0]?.kind;

test("each article goes under the type of asset it recommends, so FIIs and fixed income aren't lost among stocks", () => {
  assert.equal(kindOf("Os FIIs mais recomendados para julho"), "fii");
  assert.equal(kindOf("Fundos imobiliários mais indicados pelas corretoras"), "fii");
  assert.equal(kindOf("Menos crédito pós-fixado, mais prefixados: a estratégia da XP"), "fixedIncome");
  assert.equal(kindOf("XP lança três carteiras de ETFs"), "etf");
  assert.equal(kindOf("De Amazon a Google: veja as ações internacionais recomendadas"), "abroad");
  assert.equal(kindOf("Os melhores BDRs para investir"), "abroad");
  assert.equal(kindOf("Os multimercados favoritos das casas"), "funds");
  assert.equal(kindOf("Como montar uma carteira diversificada"), "diversified");
  assert.equal(kindOf("As 8 ações mais indicadas pelas corretoras"), "stocks");
});

test("a site's search brings guides and market news too, which don't recommend anything", () => {
  assert.equal(kindOf("Interesse em BDR cresce e volume na B3 aumenta"), undefined);
  assert.equal(kindOf("Bolsas da Ásia fecham em alta"), undefined);
  assert.equal(kindOf("Fundo cambial: o que é, como funciona"), undefined);
  assert.equal(kindOf("O boom dos FIIs: acertos da indústria"), undefined);
});

test("a tag about recommended portfolios counts whole, as stocks when no other type is named", () => {
  assert.equal(kindOf("BTG troca duas posições para novembro", TAG), "stocks");
  assert.equal(kindOf("Os FIIs da carteira de novembro", TAG), "fii");
});

test("news feeds carry no type", () => {
  assert.equal(kindOf("As ações mais indicadas", SOURCE), undefined);
});

test("portfolios are grouped by type with the mixed ones first, reach back a year, and each type stays short", () => {
  const at = (kind: "fii" | "diversified", n: number, date = "2026-10-01") => ({ title: `${kind}${n}`, link: `https://s/${kind}${n}`, date, source: "S", kind });
  const fiis = Array.from({ length: 12 }, (_, n) => at("fii", n));
  const groups = portfolioGroups([...fiis, at("diversified", 0, "2026-01-10"), at("diversified", 1, "2025-10-01")], "2026-11-08");
  assert.deepEqual(groups.map((g) => [g.kind, g.items.length]), [["diversified", 1], ["fii", 8]]);
});

test("every type of portfolio is searched on sites that honor it, sharing those sites' switches", () => {
  const searches = PORTFOLIO_SOURCES.filter((s) => s.portfolio === "search");
  assert.ok(searches.length >= 14);
  assert.ok(searches.every((s) => s.url.includes("?s=") && !s.url.includes(" ") && (s.id === "investnews" || s.id === "infomoney")));
  assert.equal(new Set(ALL_SOURCES.map((s) => s.id)).size, ALL_SOURCES.length);
});

const news = (title: string) => ({ title, link: `https://site/${title}`, date: "2026-11-05", source: "Site" });

test("news counts only with a held ticker in the title, any share class of the company", () => {
  const items = [news("Petrobras (PETR4) anuncia dividendos"), news("Petrobras: PETR3 sobe"), news("HGLG11 compra galpão"), news("VALE3 cai"), news("PETROBRAS sem ticker")];
  const found = newsForTickers(items, ["PETR4", "HGLG11"]);
  assert.deepEqual(found.map((i) => [i.ticker, i.title.slice(0, 9)]), [["PETR4", "Petrobras"], ["PETR4", "Petrobras"], ["HGLG11", "HGLG11 co"]]);
});

test("part of a word is not a ticker", () => {
  assert.deepEqual(newsForTickers([news("XPETR4 não é ticker"), news("PETR é só o começo")], ["PETR4"]), []);
});

test("every news page is read in turn, with the switches shared between a site's feeds", () => {
  const pages = newsPages(NEWS_SOURCES);
  assert.equal(pages.length, NEWS_SOURCES.length * 5);
  assert.ok(pages[1].url.endsWith("?paged=2"));
  assert.equal(new Set(ALL_SOURCES.map((s) => s.id)).size, ALL_SOURCES.length);
});

test("an article can only come from a site Trimly already reads, over https", () => {
  assert.ok(isFeedSite("https://www.moneytimes.com.br/carteira/"));
  assert.ok(!isFeedSite("http://www.moneytimes.com.br/carteira/"));
  assert.ok(!isFeedSite("https://evil.example/www.moneytimes.com.br"));
  assert.ok(!isFeedSite("not a url"));
});

test("an article reads as its text, without scripts or page furniture", () => {
  const text = articleText("<html><head><style>x{}</style><script>steal()</script></head><body><nav>Menu</nav><p>Itaú &amp; BTG</p><p>trocam</p></body></html>");
  assert.equal(text, "Itaú & BTG trocam");
});
