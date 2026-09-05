import fs from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.PROPERTY_MASTER_API_URL || "https://api.propertymaster.com/api/news";
const DRY_RUN = process.env.DRY_RUN === "true";
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 24);
const MAX_IMAGE_BYTES = 5_000_000;
const GENERIC_IMAGE_HASHES = new Set(["51b4e6b5454541def3a23ef7d3a9d040654b61308a13c34bfb7a6a50b9b13847"]);
const statePath = path.resolve("data/fingerprints.json");
const sources = JSON.parse(await fs.readFile("sources.json", "utf8"));
const prior = new Set(JSON.parse(await fs.readFile(statePath, "utf8")));
const now = new Date();
const report = { startedAt: now.toISOString(), dryRun: DRY_RUN, published: [], skipped: [], errors: [] };
const relevance = /real estate|property|properties|realty|builder|developer|housing|residential|commercial|rera|project|land|launch|metro|road|expressway|highway|flyover|underpass|airport|rrts|namo bharat|infrastructure|authority|master plan|circle rate|stamp duty|registry|township|corridor|sewer|drainage|water supply|revamp|repair|renovat|rehabilitat|upgrade|m3m|sobha|shobha|amolik|godrej|dlf|prestige|bptp|ace group/i;
const headlineRelevance = /real estate|property|properties|realty|builder|developer|housing|residential|commercial|rera|project|plot|land|launch|metro|road|expressway|highway|flyover|underpass|airport|rrts|namo bharat|infrastructure|master plan|circle rate|stamp duty|registry|township|corridor|sewer|drain|revamp|repair|renovat|rehabilitat|upgrade|m3m|sobha|shobha|amolik|godrej|dlf|prestige|bptp|ace group/i;
const positiveDevelopment = /launch|acquir|purchase|land deal|development agreement|joint development|partnership|signs? (?:an? )?(?:mou|agreement)|invest|proposal|propos(?:e|es|ed|ing)|plans?|directs?|targets?|set to|to develop|approval|approv(?:es|ed|al)|clears?|sanction|tender|construction (?:starts|begins|completed)|work (?:starts|begins|completed)|inaugurat|commission|new (?:project|road|metro|corridor|flyover|underpass|expressway|housing)|expand|extension|upgrade|upgradation|overhaul|redevelop|revamp|repair|renovat|rehabilitat|multimodal|multi-modal|connectivity|milestone|rera registration|possession|handover|sales bookings?|pre-sales|booking value|complet(?:e|ed|ion)/i;
const rejection = /murder|assault|robbery|arrest|\bfirs?\b|corruption|bribery|bribe|scam|fraud|forgery|cheating case|criminal investigation|vigilance (?:probe|raid|case)|accident|suicide|killed|\bdies\b|\bdied\b|death|injured|crash|collision|collides?|vehicle\s+.*\brams?\b|\brams?\s+into\b|\bhits?\s+(?:a\s+)?(?:pole|divider)\b|power\s*cut|power\s+outage|without\s+(?:electricity|power)|electrocution|stunt|viral|police|gangster|liquor|pilgrim|devotee|school bus|biryani|sanitation strike|garbage heap|rain havoc|traffic snarl|horoscope|election|celebrity|sports|lifestyle/i;
const nonArticleUrl = /\/web-stories?\/|\/photos?\/|\/videos?\/|\/podcasts?\/|\/blogs?\/|\/opinion\//i;
const civicProblemOrSpeculation = /flooding crisis|flooded|waterlogging|municipal bonds?|\bcan ppps?\b|city needs\?/i;
const negativeDevelopment = /\braids?\b|assets? frozen|sealed|sealing|demolition|illegal construction|violations?|under scanner|defying orders?|\bjail\b|suspend(?:ed|sion)|cancel(?:led|lation)|dispute|court battle|complaints?|delays?|stalled|lagging|drop(?:s|ped)?|decline|slump|crisis|woes|shortage/i;
const remedialDevelopment = /(?:directs?|approv(?:es|ed|al)|clears?|sanction|tender|work (?:starts|begins)|set to|plans?|proposal|propos(?:e|es|ed|ing)).{0,100}(?:revamp|repair|renovat|rehabilitat|upgrade|overhaul|redevelop)|(?:revamp|repair|renovat|rehabilitat|upgrade|overhaul|redevelop).{0,100}(?:road|stretch|drain|sewer|infrastructure)/i;
const cityRules = { gurugram: /gurugram|gurgaon|manesar|dwarka expressway/i, noida: /(?<!greater )\bnoida\b|new okhla industrial development authority/i, faridabad: /faridabad|greater faridabad|fmda/i };

function decodeHtml(s = "") { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function meta(html, key) { const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, "i")); const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i")); return decodeHtml(a?.[1] || b?.[1] || ""); }
function canonical(html, fallback) { return decodeHtml(html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || fallback); }
function siteIcon(html, baseUrl) { const raw = html.match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)/i)?.[1]; try { return new URL(decodeHtml(raw || "/favicon.ico"), baseUrl).href; } catch { return ""; } }
function publishedAt(html) { const raw = meta(html, "article:published_time") || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]; const date = raw ? new Date(raw) : null; return date && Number.isFinite(date.valueOf()) ? date : null; }
function xmlValue(xml, tag) { const value = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || ""; return decodeHtml(value.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "")); }
function parseFeed(xml) {
  return [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map(match => {
    const item = match[1];
    const rawDate = xmlValue(item, "pubDate") || xmlValue(item, "published") || xmlValue(item, "updated") || xmlValue(item, "dc:date");
    const date = rawDate ? new Date(rawDate) : null;
    return {
      title: xmlValue(item, "title"),
      description: xmlValue(item, "description") || xmlValue(item, "summary") || xmlValue(item, "content:encoded"),
      url: xmlValue(item, "link") || decodeHtml(item.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || ""),
      image: decodeHtml(item.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)/i)?.[1] || ""),
      date: date && Number.isFinite(date.valueOf()) ? date : null
    };
  });
}
function normalize(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100); }
function eventKey(title) { const stop = new Set(["the","a","an","to","for","in","on","of","and","as","with","by","from","rs","crore"]); return normalize(title).split("-").filter(x => x && !stop.has(x)).slice(0, 3).join("-"); }
async function fetchText(url) { const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PropertyMasterNewsBot/1.0 (+https://www.propertymaster.com/)" } }); if (!response.ok) throw new Error(`${response.status} ${url}`); return { html: await response.text(), finalUrl: response.url }; }
async function imageWorks(url) { if (!url?.startsWith("https://") || /favicon|(?:^|[\/_-])(?:site-)?logo\.(?:png|jpe?g|webp|svg)(?:$|\?)|msid-47529300|ht-generic|generic[_-]?cities/i.test(url)) return false; const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) }); const length = Number(response.headers.get("content-length") || 0); if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("image/") || (length && length < 15000) || length > MAX_IMAGE_BYTES) return false; const bytes = await response.arrayBuffer(); if (bytes.byteLength > MAX_IMAGE_BYTES) return false; const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join(""); return !GENERIC_IMAGE_HASHES.has(hash); }
async function articleImage(candidates, publisherLogo) { for (const candidate of candidates) { if (candidate && candidate !== publisherLogo && await imageWorks(candidate)) return candidate; } return ""; }

const seenUrls = new Set();
for (const source of sources) {
  let feed;
  try { feed = await fetchText(source.rssUrl); } catch (error) { report.errors.push({ source: source.publisher, feed: source.rssUrl, error: error.message }); continue; }
  const items = parseFeed(feed.html).sort((a, b) => (b.date?.valueOf() || 0) - (a.date?.valueOf() || 0));
  if (!items.length) report.errors.push({ source: source.publisher, feed: source.rssUrl, error: "RSS feed contained no readable items" });
  for (const item of items.slice(0, 50)) {
    const url = item.url;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    if (nonArticleUrl.test(url)) { report.skipped.push({ source: source.publisher, title: item.title, reason: "not a full news article" }); continue; }
    if (!item.date || item.date > now || now - item.date > MAX_AGE_HOURS * 3600_000) { report.skipped.push({ source: source.publisher, title: item.title, reason: "outside freshness window or missing RSS date" }); continue; }
    try { if (!new URL(url).hostname.endsWith(source.host)) { report.skipped.push({ source: source.publisher, title: item.title, reason: "RSS link is not on publisher domain" }); continue; } } catch { continue; }
    let page; try { page = await fetchText(url); } catch (error) { report.skipped.push({ source: source.publisher, title: item.title, reason: `article unavailable: ${error.message}` }); continue; }
    const title = meta(page.html, "og:title") || item.title || decodeHtml(page.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]);
    const description = meta(page.html, "og:description") || meta(page.html, "description") || item.description;
    const articleDate = publishedAt(page.html);
    const date = item.date;
    const text = `${title} ${description}`;
    const isRemedialDevelopment = remedialDevelopment.test(text);
    if (!title || !description || /\?\s*$/.test(title) || !headlineRelevance.test(title) || !relevance.test(text) || !positiveDevelopment.test(text) || rejection.test(text) || ((civicProblemOrSpeculation.test(text) || negativeDevelopment.test(text)) && !isRemedialDevelopment)) { report.skipped.push({ source: source.publisher, title, reason: "not relevant positive real-estate/infrastructure news" }); continue; }
    if (articleDate && Math.abs(articleDate - date) > 24 * 3600_000) { report.skipped.push({ source: source.publisher, title, reason: "RSS and article publication dates conflict" }); continue; }
    const matches = Object.entries(cityRules).filter(([, rule]) => rule.test(text)).map(([city]) => city);
    const isNcr = /delhi ncr|\bncr\b/i.test(text);
    const cities = isNcr ? ["gurugram", "noida", "faridabad"] : matches.filter(city => city !== "noida" || !/greater noida/i.test(title));
    const publisherLogo = source.logo || siteIcon(page.html, page.finalUrl);
    const thumbnailImage = await articleImage([item.image, meta(page.html, "og:image"), meta(page.html, "twitter:image")], publisherLogo);
    if (!cities.length) { report.skipped.push({ source: source.publisher, title, reason: "supported city not established" }); continue; }
    if (!publisherLogo) { report.skipped.push({ source: source.publisher, title, reason: "publisher logo unavailable" }); continue; }
    if (!thumbnailImage) { report.skipped.push({ source: source.publisher, title, reason: "usable original article image unavailable" }); continue; }
    const newsLink = canonical(page.html, page.finalUrl);
    for (const cityCode of cities) {
      const fingerprint = `${cityCode}|${eventKey(title)}|${date.toISOString().slice(0, 10)}`;
      if (prior.has(fingerprint)) { report.skipped.push({ source: source.publisher, title, cityCode, reason: "duplicate fingerprint" }); continue; }
      const payload = { title, description: isNcr ? `${description} This NCR-wide development is relevant to the ${cityCode} market.` : description, cityCode, isActive: true, newsLink, thumbnailImage, postedBy: source.publisher, postedByLogo: publisherLogo, createdAt: new Date().toISOString() };
      if (DRY_RUN) { report.published.push({ dryRun: true, fingerprint, payload }); continue; }
      try { const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) }); const body = await response.json(); if (!response.ok || !body?.data?.id || !body?.data?.createdAt) throw new Error(`${response.status} ${JSON.stringify(body)}`); prior.add(fingerprint); report.published.push({ cityCode, title, newsLink, apiId: body.data.id, createdAt: body.data.createdAt, fingerprint }); } catch (error) { report.errors.push({ cityCode, title, error: error.message }); }
    }
  }
}
await fs.writeFile(statePath, `${JSON.stringify([...prior].sort(), null, 2)}\n`);
await fs.writeFile("run-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
