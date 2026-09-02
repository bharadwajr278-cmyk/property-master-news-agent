import fs from "node:fs/promises";
import path from "node:path";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PROPERTY_MASTER_API_URL = process.env.PROPERTY_MASTER_API_URL || "https://api.propertymaster.com/api/news";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const DRY_RUN = process.env.DRY_RUN === "true";
const statePath = path.resolve("data/fingerprints.json");

if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const prior = new Set(JSON.parse(await fs.readFile(statePath, "utf8")));
const now = new Date();

const prompt = `You are a conservative real-estate news researcher. Today is ${now.toISOString()}.
Search the web for genuinely new, useful real-estate or property-impacting infrastructure news published in the last 24 hours for Gurugram/Gurgaon, Noida, Faridabad/Greater Faridabad, or Delhi NCR as a whole. Extend to 48 hours only if necessary. Prefer official government, RERA, authority, regulatory, stock-exchange, or original publisher sources.

Reject crime, politics, accidents, lifestyle, generic business, advertisements, marketing copy, rumours, stale/reposted articles, and Greater-Noida-only news. Open and verify original pages. Return at most 5 candidates. An NCR-wide story must genuinely affect the region, not merely mention NCR.

Return ONLY a JSON array. Each item must contain:
{"title":"concise verified headline","description":"standalone factual description","scope":"gurugram|noida|faridabad|ncr","newsLink":"canonical original article URL","thumbnailImage":"public directly-loadable relevant image URL","postedBy":"actual publisher","postedByLogo":"public directly-loadable publisher logo URL","publishedAt":"ISO-8601 source publication time","authority":"normalized developer or authority","subject":"normalized project or infrastructure name","event":"normalized key event"}

Do not return an item if any field is missing, uncertain, invented, inaccessible, or if the image is irrelevant. No markdown.`;

const aiResponse = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: MODEL, tools: [{ type: "web_search_preview" }], input: prompt })
});
if (!aiResponse.ok) throw new Error(`OpenAI request failed: ${aiResponse.status} ${await aiResponse.text()}`);
const ai = await aiResponse.json();
const outputText = ai.output?.flatMap(x => x.content || []).find(x => x.type === "output_text")?.text;
if (!outputText) throw new Error("Research response contained no output_text");

let candidates;
try { candidates = JSON.parse(outputText); }
catch { throw new Error(`Research output was not valid JSON: ${outputText.slice(0, 500)}`); }
if (!Array.isArray(candidates)) throw new Error("Research output must be an array");

const cityRoutes = { gurugram: ["gurugram"], noida: ["noida"], faridabad: ["faridabad"], ncr: ["gurugram", "noida", "faridabad"] };
const report = { startedAt: now.toISOString(), dryRun: DRY_RUN, published: [], skipped: [] };

async function checkUrl(url, image = false) {
  if (!/^https:\/\//i.test(url)) return false;
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!response.ok) return false;
  if (image && !response.headers.get("content-type")?.toLowerCase().startsWith("image/")) return false;
  return true;
}

for (const item of candidates) {
  const routes = cityRoutes[item.scope];
  if (!routes) { report.skipped.push({ title: item.title, reason: "invalid scope" }); continue; }
  const publishedAt = new Date(item.publishedAt);
  if (!Number.isFinite(publishedAt.valueOf()) || now - publishedAt > 48 * 3600_000 || publishedAt > now) {
    report.skipped.push({ title: item.title, reason: "invalid or stale publication time" }); continue;
  }
  try {
    const [articleOk, imageOk, logoOk] = await Promise.all([
      checkUrl(item.newsLink), checkUrl(item.thumbnailImage, true), checkUrl(item.postedByLogo, true)
    ]);
    if (!articleOk || !imageOk || !logoOk) {
      report.skipped.push({ title: item.title, reason: "source, thumbnail, or logo validation failed" }); continue;
    }
  } catch (error) {
    report.skipped.push({ title: item.title, reason: `URL validation error: ${error.message}` }); continue;
  }

  for (const cityCode of routes) {
    const fingerprint = `${cityCode}|${item.authority}|${item.subject}|${item.event}`.toLowerCase().replace(/\s+/g, "-");
    if (prior.has(fingerprint)) { report.skipped.push({ title: item.title, cityCode, reason: "duplicate fingerprint" }); continue; }
    const payload = {
      title: item.title,
      description: item.scope === "ncr" ? `${item.description} This verified NCR-wide development is relevant to the ${cityCode} property market.` : item.description,
      cityCode,
      isActive: true,
      newsLink: item.newsLink,
      thumbnailImage: item.thumbnailImage,
      postedBy: item.postedBy,
      postedByLogo: item.postedByLogo,
      createdAt: new Date().toISOString()
    };
    if (DRY_RUN) { report.published.push({ dryRun: true, fingerprint, payload }); continue; }
    const response = await fetch(PROPERTY_MASTER_API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Property Master POST failed: ${response.status} ${body}`);
    const parsed = JSON.parse(body);
    if (!parsed?.data?.id || !parsed?.data?.createdAt) throw new Error(`Invalid success response or null createdAt: ${body}`);
    prior.add(fingerprint);
    report.published.push({ fingerprint, cityCode, apiId: parsed.data.id, createdAt: parsed.data.createdAt, newsLink: item.newsLink });
  }
}

await fs.writeFile(statePath, `${JSON.stringify([...prior].sort(), null, 2)}\n`);
await fs.writeFile("run-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
