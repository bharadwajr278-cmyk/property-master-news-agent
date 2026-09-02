import fs from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.PROPERTY_MASTER_API_URL || "https://api.propertymaster.com/api/news";
const DRY_RUN = process.env.DRY_RUN === "true";
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS || 6);
const statePath = path.resolve("data/fingerprints.json");
const sources = JSON.parse(await fs.readFile("sources.json", "utf8"));
const prior = new Set(JSON.parse(await fs.readFile(statePath, "utf8")));
const now = new Date();
const report = { startedAt: now.toISOString(), dryRun: DRY_RUN, published: [], skipped: [], errors: [] };
const relevance = /real estate|property|housing|residential|commercial|rera|project|land|launch|metro|road|expressway|highway|flyover|underpass|airport|rrts|namo bharat|infrastructure|authority|master plan|circle rate|stamp duty|registry|township|corridor|sewer|drainage|water supply/i;
const headlineRelevance = /real estate|property|housing|residential|commercial|rera|project|plot|land|launch|metro|road|expressway|highway|flyover|underpass|airport|rrts|namo bharat|infrastructure|master plan|circle rate|stamp duty|registry|township|corridor|sewer|drain/i;
const rejection = /murder|assault|robbery|arrest|accident|suicide|killed|\bdies\b|\bdied\b|death|injured|crash|stunt|viral|police|gangster|liquor|pilgrim|devotee|school bus|biryani|sanitation strike|garbage heap|rain havoc|traffic snarl|horoscope|election|celebrity|sports|lifestyle/i;
const cityRules = { gurugram: /gurugram|gurgaon|manesar|dwarka expressway/i, noida: /(?<!greater )\bnoida\b|new okhla industrial development authority/i, faridabad: /faridabad|greater faridabad|fmda/i };

function decodeHtml(s = "") { return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function meta(html, key) { const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`, "i")); const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i")); return decodeHtml(a?.[1] || b?.[1] || ""); }
function canonical(html, fallback) { return decodeHtml(html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || fallback); }
function siteIcon(html, baseUrl) { const raw = html.match(/<link[^>]+rel=["'][^"']*(?:icon|shortcut icon)[^"']*["'][^>]+href=["']([^"']+)/i)?.[1]; try { return new URL(decodeHtml(raw || "/favicon.ico"), baseUrl).href; } catch { return ""; } }
function publishedAt(html) { const raw = meta(html, "article:published_time") || html.match(/["']datePublished["']\s*:\s*["']([^"']+)/i)?.[1]; const date = raw ? new Date(raw) : null; return date && Number.isFinite(date.valueOf()) ? date : null; }
function normalize(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100); }
function eventKey(title) { const stop = new Set(["the","a","an","to","for","in","on","of","and","as","with","by","from","rs","crore"]); return normalize(title).split("-").filter(x => x && !stop.has(x)).slice(0, 3).join("-"); }
async function fetchText(url) { const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PropertyMasterNewsBot/1.0 (+https://www.propertymaster.com/)" } }); if (!response.ok) throw new Error(`${response.status} ${url}`); return { html: await response.text(), finalUrl: response.url }; }
async function imageWorks(url) { if (!url?.startsWith("https://") || /favicon|(?:^|[\/_-])logo(?:[\/_\.-]|$)|msid-47529300/i.test(url)) return false; const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) }); const length = Number(response.headers.get("content-length") || 0); return response.ok && response.headers.get("content-type")?.toLowerCase().startsWith("image/") && (!length || length >= 15000); }

for (const source of sources) {
  let index;
  try { index = await fetchText(source.startUrl); } catch (error) { report.errors.push({ source: source.publisher, error: error.message }); continue; }
  const publisherLogo = source.logo || siteIcon(index.html, index.finalUrl);
  const links = [...index.html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map(m => { try { return new URL(decodeHtml(m[1]), index.finalUrl).href; } catch { return null; } }).filter(Boolean).filter(u => new URL(u).hostname.endsWith(source.host)).filter(u => source.articlePattern ? new RegExp(source.articlePattern, "i").test(u) : true);
  for (const url of [...new Set(links)].slice(0, 35)) {
    let page; try { page = await fetchText(url); } catch { continue; }
    const title = meta(page.html, "og:title") || decodeHtml(page.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]);
    const description = meta(page.html, "og:description") || meta(page.html, "description");
    const thumbnailImage = meta(page.html, "og:image");
    const date = publishedAt(page.html); const text = `${title} ${description}`;
    if (!title || !description || !headlineRelevance.test(title) || !relevance.test(text) || rejection.test(text)) continue;
    if (!date || date > now || now - date > MAX_AGE_HOURS * 3600_000) continue;
    const matches = Object.entries(cityRules).filter(([, rule]) => rule.test(text)).map(([city]) => city);
    const isNcr = /delhi ncr|\bncr\b/i.test(text);
    const cities = isNcr ? ["gurugram", "noida", "faridabad"] : matches;
    if (!cities.length || thumbnailImage === publisherLogo || !(await imageWorks(thumbnailImage))) continue;
    const newsLink = canonical(page.html, page.finalUrl);
    for (const cityCode of cities) {
      const fingerprint = `${cityCode}|${eventKey(title)}|${date.toISOString().slice(0, 10)}`;
      if (prior.has(fingerprint)) continue;
      const payload = { title, description: isNcr ? `${description} This NCR-wide development is relevant to the ${cityCode} market.` : description, cityCode, isActive: true, newsLink, thumbnailImage, postedBy: source.publisher, postedByLogo: publisherLogo, createdAt: new Date().toISOString() };
      if (DRY_RUN) { report.published.push({ dryRun: true, fingerprint, payload }); continue; }
      try { const response = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) }); const body = await response.json(); if (!response.ok || !body?.data?.id || !body?.data?.createdAt) throw new Error(`${response.status} ${JSON.stringify(body)}`); prior.add(fingerprint); report.published.push({ cityCode, title, newsLink, apiId: body.data.id, createdAt: body.data.createdAt, fingerprint }); } catch (error) { report.errors.push({ cityCode, title, error: error.message }); }
    }
  }
}
await fs.writeFile(statePath, `${JSON.stringify([...prior].sort(), null, 2)}\n`);
await fs.writeFile("run-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
