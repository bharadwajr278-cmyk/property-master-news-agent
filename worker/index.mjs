import { DurableObject } from "cloudflare:workers";

const API_URL = "https://api.propertymaster.com/api/news";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT_BYTES = 5_000_000;

const sources = [
  { publisher: "Magicbricks", rssUrl: "https://www.magicbricks.com/news/feed", host: "magicbricks.com", logo: "https://img.staticmb.com/mbimages/appimages/mailers/mb-logo-web.webp" },
  { publisher: "The Times of India", rssUrl: "https://timesofindia.indiatimes.com/rssfeeds/6547154.cms", host: "timesofindia.indiatimes.com", logo: "https://timesofindia.indiatimes.com/icons/toifavicon.ico" },
  { publisher: "The Times of India", rssUrl: "https://timesofindia.indiatimes.com/rssfeeds/8021716.cms", host: "timesofindia.indiatimes.com", logo: "https://timesofindia.indiatimes.com/icons/toifavicon.ico" },
  { publisher: "Hindustan Times", rssUrl: "https://www.hindustantimes.com/feeds/rss/cities/gurugram-news/rssfeed.xml", host: "hindustantimes.com" },
  { publisher: "Hindustan Times", rssUrl: "https://www.hindustantimes.com/feeds/rss/cities/noida-news/rssfeed.xml", host: "hindustantimes.com" },
  { publisher: "Hindustan Times", rssUrl: "https://www.hindustantimes.com/feeds/rss/cities/faridabad-news/rssfeed.xml", host: "hindustantimes.com" },
  { publisher: "Hindustan Times", rssUrl: "https://www.hindustantimes.com/feeds/rss/real-estate/rssfeed.xml", host: "hindustantimes.com" },
  { publisher: "The Indian Express", rssUrl: "https://indianexpress.com/section/cities/delhi/feed/", host: "indianexpress.com" },
  { publisher: "The Economic Times", rssUrl: "https://economictimes.indiatimes.com/rssfeeds/13357019.cms", host: "economictimes.indiatimes.com" },
  { publisher: "Business Standard", rssUrl: "https://www.business-standard.com/rss/content/real-estate-22310.rss", host: "business-standard.com", logo: "https://www.business-standard.com/bs-favicon.ico" },
  { publisher: "Business Standard", rssUrl: "https://www.business-standard.com/rss/latest.rss", host: "business-standard.com", logo: "https://www.business-standard.com/bs-favicon.ico" },
  { publisher: "Swarajya", rssUrl: "https://swarajyamag.com/stories.rss", host: "swarajyamag.com" },
  { publisher: "RealtyNMore", rssUrl: "https://realtynmore.com/feed/", host: "realtynmore.com" }
];

const relevance = /real estate|property|properties|realty|builder|developer|housing|residential|commercial|rera|project|plot|land|launch|metro|road|expressway|highway|flyover|underpass|airport|rrts|namo bharat|infrastructure|master plan|circle rate|stamp duty|registry|township|corridor|sewer|drain|water supply|landfill|m3m|sobha|shobha|amolik|godrej|dlf|prestige|bptp|ace group/i;
const positiveDevelopment = /launch|acquir|purchase|land deal|development agreement|joint development|partnership|signs? (?:an? )?(?:mou|agreement)|invest|approval|approv(?:es|ed|al)|clears?|sanction|tender|construction (?:starts|begins|completed)|work (?:starts|begins|completed)|inaugurat|commission|new (?:project|road|metro|corridor|flyover|underpass|expressway|housing)|expand|extension|upgrade|upgradation|overhaul|redevelop|revamp|connectivity|milestone|rera registration|possession|handover|sales bookings?|pre-sales|booking value|complet(?:e|ed|ion)/i;
const rejection = /murder|assault|robbery|arrest|\bfirs?\b|corruption|bribery|bribe|scam|fraud|forgery|cheating case|criminal investigation|vigilance (?:probe|raid|case)|accident|suicide|killed|\bdies\b|\bdied\b|death|injured|crash|collision|collides?|vehicle\s+.*\brams?\b|\brams?\s+into\b|\bhits?\s+(?:a\s+)?(?:pole|divider)\b|power\s*cut|power\s+outage|without\s+(?:electricity|power)|electrocution|stunt|viral|police|gangster|liquor|pilgrim|devotee|school bus|biryani|sanitation strike|horoscope|election|celebrity|sports|lifestyle/i;
const nonArticleUrl = /\/web-stories?\/|\/photos?\/|\/videos?\/|\/podcasts?\/|\/blogs?\/|\/opinion\//i;
const civicProblemOrSpeculation = /flooding crisis|flooded|waterlogging|municipal bonds?|\bcan ppps?\b|city needs\?/i;
const negativeDevelopment = /\braids?\b|assets? frozen|sealed|sealing|demolition|illegal construction|violations?|under scanner|defying orders?|\bjail\b|suspend(?:ed|sion)|cancel(?:led|lation)|dispute|court battle|complaints?|delays?|stalled|lagging|drop(?:s|ped)?|decline|slump|crisis|woes|shortage/i;
const cityRules = {
  gurugram: /gurugram|gurgaon|manesar|dwarka expressway/i,
  noida: /(?<!greater )\bnoida\b|new okhla industrial development authority/i,
  faridabad: /faridabad|greater faridabad|fmda/i
};

function decodeHtml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function meta(html, key) {
  const safe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']+)`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${safe}["']`, "i"));
  return decodeHtml(a?.[1] || b?.[1] || "");
}
function xmlValue(xml, tag) {
  const value = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
  return decodeHtml(value.trim().replace(/^<!\[CDATA\[|\]\]>$/g, ""));
}
function parseFeed(xml) {
  return [...xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)].map(match => {
    const item = match[1];
    const rawDate = xmlValue(item, "pubDate") || xmlValue(item, "published") || xmlValue(item, "updated") || xmlValue(item, "dc:date");
    const date = rawDate ? new Date(rawDate) : null;
    return { title: xmlValue(item, "title"), description: xmlValue(item, "description") || xmlValue(item, "summary") || xmlValue(item, "content:encoded"), url: xmlValue(item, "link") || decodeHtml(item.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || ""), image: decodeHtml(item.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)/i)?.[1] || ""), date: date && Number.isFinite(date.valueOf()) ? date : null };
  });
}
function canonical(html, fallback) { return decodeHtml(html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || fallback); }
function siteIcon(html, baseUrl) { const raw = html.match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)/i)?.[1]; try { return new URL(decodeHtml(raw || "/favicon.ico"), baseUrl).href; } catch { return ""; } }
function publishedAt(html) { const raw = meta(html, "article:published_time") || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]; const date = raw ? new Date(raw) : null; return date && Number.isFinite(date.valueOf()) ? date : null; }
function eventKey(title) { const stop = new Set(["the", "a", "an", "to", "for", "in", "on", "of", "and", "as", "with", "by", "from", "rs", "crore"]); return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").filter(x => x && !stop.has(x)).slice(0, 3).join("-"); }
function subjectKey(text) {
  const subjects = [
    ["prestige", /\bprestige(?: group| estates)?\b/i], ["m3m", /\bm3m\b/i], ["sobha", /\b(?:sobha|shobha)\b/i],
    ["amolik", /\bamolik\b/i], ["godrej", /\bgodrej(?: properties)?\b/i], ["dlf", /\bdlf\b/i],
    ["bptp", /\bbptp\b/i], ["ace", /\bace group\b/i], ["gurgaon-metro", /\b(?:gurgaon|gurugram) metro\b/i],
    ["noida-metro", /\b(?:noida|nmrc) metro\b/i]
  ];
  return subjects.find(([, pattern]) => pattern.test(text))?.[0] || "";
}
function materialFacts(text) {
  const facts = [];
  const patterns = [
    /(?:₹|\brs\.?|\binr)\s*[\d,.]+\s*(?:crores?|cr\.?|billions?|millions?|lakhs?)/gi,
    /\b[\d,.]+\s*(?:acres?|sq\.?\s*ft|square feet|sq\.?\s*m|square metres?|km)\b/gi,
    /\bsector\s*[-:]?\s*[a-z]?\d+[a-z]?\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const normalized = match[0].toLowerCase()
        .replace(/₹|\brs\.?|\binr/g, "")
        .replace(/,/g, "")
        .replace(/\bcrores?\b|\bcr\.?\b/g, "crore")
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9.-]/g, "");
      if (normalized) facts.push(normalized);
    }
  }
  return [...new Set(facts)].sort();
}
function semanticReservationKeys(cityCode, text, title, newsLink) {
  const subject = subjectKey(text);
  const keys = [`url:${cityCode}:${newsLink}`];
  if (subject) {
    const facts = materialFacts(text);
    for (const fact of facts) keys.push(`fact:${cityCode}|${subject}|${fact}`);
    keys.push(`headline:${cityCode}|${subject}|${eventKey(title)}`);
  }
  return keys;
}
function normalizeUrl(value) {
  try { const url = new URL(value); url.hash = ""; for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key); return url.href.replace(/\/$/, "").toLowerCase(); }
  catch { return value.toLowerCase(); }
}
async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "PropertyMasterNewsBot/2.0 (+https://www.propertymaster.com/)" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_TEXT_BYTES) throw new Error(`response too large: ${url}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new Error(`response too large: ${url}`);
  return { html: text, finalUrl: response.url };
}
async function imageWorks(url) {
  if (!url?.startsWith("https://") || /favicon|(?:^|[\/_-])(?:site-)?logo\.(?:png|jpe?g|webp|svg)(?:$|\?)|msid-47529300|ht-generic|generic[_-]?cities/i.test(url)) return false;
  const response = await fetch(url, { redirect: "follow", headers: { Range: "bytes=0-1023" } });
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  await response.body?.cancel();
  return response.ok && type.includes("image/");
}
async function articleImage(candidates, publisherLogo) {
  for (const candidate of candidates) {
    if (!candidate || candidate === publisherLogo) continue;
    if (await imageWorks(candidate)) return candidate;
  }
  return "";
}

async function runOnce(env, coordinator) {
  const now = new Date();
  const prior = new Set((await env.NEWS_STATE.get("fingerprints", "json")) || []);
  const report = { startedAt: now.toISOString(), published: [], skipped: 0, errors: [] };
  const seenUrls = new Set();
  let articleChecks = 0;
  for (const source of sources) {
    let feed;
    try { feed = await fetchText(source.rssUrl); } catch (error) { report.errors.push({ source: source.publisher, error: error.message }); continue; }
    const items = parseFeed(feed.html).sort((a, b) => (b.date?.valueOf() || 0) - (a.date?.valueOf() || 0));
    for (const item of items.slice(0, 30)) {
      if (!item.url || seenUrls.has(item.url) || nonArticleUrl.test(item.url) || !item.date || item.date > now || now - item.date > MAX_AGE_MS) { report.skipped++; continue; }
      seenUrls.add(item.url);
      const feedText = `${item.title} ${item.description}`;
      const feedHasCity = /delhi ncr|\bncr\b/i.test(feedText) || Object.values(cityRules).some(rule => rule.test(feedText));
      if (!relevance.test(feedText) || rejection.test(feedText) || !feedHasCity || articleChecks >= 25) { report.skipped++; continue; }
      try { if (!new URL(item.url).hostname.endsWith(source.host)) { report.skipped++; continue; } } catch { report.skipped++; continue; }
      articleChecks++;
      let page;
      try { page = await fetchText(item.url); } catch { report.skipped++; continue; }
      const title = meta(page.html, "og:title") || item.title;
      const description = meta(page.html, "og:description") || meta(page.html, "description") || item.description;
      const articleDate = publishedAt(page.html);
      const text = `${title} ${description}`;
      if (!title || !description || /\?\s*$/.test(title) || !relevance.test(title) || !relevance.test(text) || !positiveDevelopment.test(text) || rejection.test(text) || civicProblemOrSpeculation.test(text) || negativeDevelopment.test(text) || (articleDate && Math.abs(articleDate - item.date) > 86_400_000)) { report.skipped++; continue; }
      const matches = Object.entries(cityRules).filter(([, rule]) => rule.test(text)).map(([city]) => city);
      const isNcr = /delhi ncr|\bncr\b/i.test(text);
      const cities = (isNcr ? ["gurugram", "noida", "faridabad"] : matches).filter(city => city !== "noida" || !/greater noida/i.test(title));
      const publisherLogo = source.logo || siteIcon(page.html, page.finalUrl);
      // RSS media is often the story photo even when the article page exposes a
      // generic section card as og:image (notably Hindustan Times "Cities").
      const thumbnailImage = await articleImage([item.image, meta(page.html, "og:image"), meta(page.html, "twitter:image")], publisherLogo);
      if (!cities.length || !publisherLogo || !thumbnailImage) { report.skipped++; continue; }
      const newsLink = canonical(page.html, page.finalUrl);
      for (const cityCode of cities) {
        const fingerprint = `${cityCode}|${eventKey(title)}|${item.date.toISOString().slice(0, 10)}`;
        if (prior.has(fingerprint)) { report.skipped++; continue; }
        const normalizedNewsLinkDigest = await digest(normalizeUrl(newsLink));
        const semanticKeys = semanticReservationKeys(cityCode, text, title, normalizedNewsLinkDigest);
        const reservationKeys = [`event:${fingerprint}`, ...semanticKeys];
        if (!(await coordinator.claim(reservationKeys))) { report.skipped++; continue; }
        const payload = { title, description: isNcr ? `${description} This NCR-wide development is relevant to the ${cityCode} market.` : description, cityCode, isActive: true, newsLink, thumbnailImage, postedBy: source.publisher, postedByLogo: publisherLogo, createdAt: new Date().toISOString() };
        try {
          const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const body = await response.json();
          if (!response.ok || !body?.data?.id || !body?.data?.createdAt) throw new Error(`${response.status} ${JSON.stringify(body)}`);
          prior.add(fingerprint);
          await coordinator.confirm(reservationKeys);
          report.published.push({ cityCode, title, apiId: body.data.id, fingerprint });
        } catch (error) {
          // Keep the reservation when the POST outcome is uncertain. Retrying
          // could duplicate a record accepted before a timeout or lost response.
          report.errors.push({ cityCode, title, error: error.message });
        }
      }
    }
  }
  await env.NEWS_STATE.put("fingerprints", JSON.stringify([...prior].sort()));
  await env.NEWS_STATE.put("last-report", JSON.stringify(report));
  console.log(JSON.stringify(report));
  return report;
}

export class RunCoordinator extends DurableObject {
  async claim(keys) {
    const existing = await this.ctx.storage.get(keys);
    // Pending and confirmed reservations are both permanent, giving each
    // article/event at-most-once publishing semantics.
    if (keys.some(key => existing.has(key))) {
      // Backfill newly introduced semantic keys from an older URL reservation.
      // This lets previously published records block equivalent coverage from
      // another publisher without reposting the old record.
      const missing = keys.filter(key => !existing.has(key));
      if (missing.length) await this.ctx.storage.put(Object.fromEntries(missing.map(key => [key, { status: "posted", at: Date.now() }])));
      return false;
    }
    const now = Date.now();
    const pending = Object.fromEntries(keys.map(key => [key, { status: "pending", at: now }]));
    await this.ctx.storage.put(pending);
    return true;
  }
  async confirm(keys) {
    await this.ctx.storage.put(Object.fromEntries(keys.map(key => [key, { status: "posted", at: Date.now() }])));
  }
  async execute() {
    const now = Date.now();
    const lockedUntil = await this.ctx.storage.get("run-lock");
    if (typeof lockedUntil === "number" && lockedUntil > now) return { skippedRun: true, reason: "another run is active" };
    await this.ctx.storage.put("run-lock", now + 4 * 60 * 1000);
    try { return await runOnce(this.env, this); }
    finally { await this.ctx.storage.delete("run-lock"); }
  }
}

export default {
  async scheduled(_controller, env, ctx) { ctx.waitUntil(env.RUN_COORDINATOR.getByName("property-master-publisher").execute()); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/status") return Response.json((await env.NEWS_STATE.get("last-report", "json")) || { status: "waiting for first cron run" });
    return new Response("Property Master RSS news worker is active. See /status.", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};
