/* Helpers shared by the /api functions (files starting with "_" are not
   deployed as endpoints themselves). */

export function json(body, status = 200, cacheSeconds = 0) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  headers["cache-control"] = cacheSeconds > 0
    ? `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`
    : "no-store";
  return new Response(JSON.stringify(body), { status, headers });
}

/* Optional durable cache (Upstash Redis / Vercel KV REST API). Without it
   the CDN cache on responses still shares results between visitors. */
function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export async function kvGet(key) {
  const kv = kvConfig();
  if (!kv) return null;
  try {
    const res = await fetch(`${kv.url}/get/${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${kv.token}` },
    });
    if (!res.ok) return null;
    const { result } = await res.json();
    return result ? JSON.parse(result) : null;
  } catch (e) {
    return null;
  }
}

export async function kvSet(key, value) {
  const kv = kvConfig();
  if (!kv) return;
  try {
    await fetch(`${kv.url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${kv.token}` },
      body: JSON.stringify(value),
    });
  } catch (e) {}
}
