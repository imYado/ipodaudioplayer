/* GET /api/match?id=<spotify track id>&title=&artist=&duration=<ms>
   Finds the best YouTube video for a song.
   Returns { videoId, title, channel, durationSec, art, alternates: [{ videoId, title, channel, durationSec }] }

   Needs YOUTUBE_API_KEY. Each new song costs ~101 units of YouTube's
   10,000/day free quota, so results are cached: on Vercel's CDN (shared
   by everyone) and, if configured, in Upstash/KV so they survive deploys. */
import { json, kvGet, kvSet } from "./_shared.js";

const CACHE_SECONDS = 60 * 60 * 24 * 30;

function isoDurationToSec(iso) {
  const m = String(iso || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ぀-ヿ一-鿿]+/g, " ").trim();
}

const UNWANTED = ["live", "cover", "remix", "sped up", "slowed", "reverb", "karaoke", "instrumental",
  "8d", "nightcore", "reaction", "tutorial", "lesson", "acoustic", "piano version", "bass boosted", "1 hour", "loop"];

/* Higher is better. Rewards matching length, the artist's auto-generated
   "Topic" channel (studio audio with the album cover), official uploads and
   title words; penalises live/cover/remix/etc. unless the song itself is. */
export function scoreCandidate(c, { title, artist, durationSec }) {
  let score = 0;
  const vt = norm(c.title);
  const ch = norm(c.channel);
  const wantTitle = norm(title);
  const wantArtist = norm(String(artist || "").split(",")[0]);

  if (durationSec > 0 && c.durationSec > 0) {
    const diff = Math.abs(c.durationSec - durationSec);
    if (diff <= 2) score += 40;
    else if (diff <= 6) score += 28;
    else if (diff <= 15) score += 12;
    else if (diff <= 40) score -= 5;
    else score -= 40;
  }
  if (/ topic$/.test(ch)) score += 25;
  if (wantArtist && (ch.includes(wantArtist) || ch.replace(/ /g, "").includes(wantArtist.replace(/ /g, "")))) score += 15;
  if (/\bvevo$/.test(ch.replace(/ /g, ""))) score += 10;
  if (/official (audio|video|music video)/.test(vt)) score += 8;

  const titleWords = wantTitle.split(" ").filter((w) => w.length > 1);
  if (titleWords.length) {
    const hits = titleWords.filter((w) => vt.includes(w)).length;
    score += Math.round((hits / titleWords.length) * 20);
  }
  if (wantArtist && vt.includes(wantArtist)) score += 6;

  UNWANTED.forEach((w) => {
    const re = new RegExp(`(^| )${w}( |$)`);
    if (re.test(vt) && !re.test(wantTitle)) score -= 18;
  });
  if (/\blyrics?\b/.test(vt) && !/ topic$/.test(ch)) score -= 3;
  return score;
}

async function ytSearch(q, key) {
  const params = new URLSearchParams({
    part: "snippet", q, type: "video", maxResults: "10",
    videoEmbeddable: "true", videoSyndicated: "true", key,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const reason = body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
    const err = new Error(reason === "quotaExceeded" ? "YouTube's daily search limit is used up. Try again tomorrow." : `YouTube search failed (${res.status})`);
    err.status = reason === "quotaExceeded" ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  return (data.items || []).map((it) => it.id && it.id.videoId).filter(Boolean);
}

async function ytDetails(ids, key) {
  if (!ids.length) return [];
  const params = new URLSearchParams({ part: "snippet,contentDetails,status", id: ids.join(","), key });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!res.ok) throw new Error(`YouTube lookup failed (${res.status})`);
  const data = await res.json();
  return (data.items || [])
    .filter((v) => !v.status || v.status.embeddable !== false)
    .filter((v) => !(v.contentDetails && v.contentDetails.regionRestriction && v.contentDetails.regionRestriction.allowed))
    .map((v) => ({
      videoId: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      durationSec: isoDurationToSec(v.contentDetails && v.contentDetails.duration),
    }));
}

/* Per-track cover art via Spotify's public oEmbed endpoint (no key).
   Playlists read from the embed page only carry the playlist cover. */
async function spotifyTrackArt(id) {
  if (!/^[A-Za-z0-9]{10,}$/.test(id)) return null;
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.thumbnail_url || null;
  } catch (e) {
    return null;
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").slice(0, 64);
  const title = (url.searchParams.get("title") || "").slice(0, 200);
  const artist = (url.searchParams.get("artist") || "").slice(0, 200);
  const durationSec = Math.round((+url.searchParams.get("duration") || 0) / 1000);
  if (!title) return json({ error: "Missing title" }, 400);

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return json({ error: "YouTube isn't set up yet (YOUTUBE_API_KEY missing)." }, 503);

  const cacheKey = `ytmatch:v1:${id || norm(`${artist} ${title}`)}`;
  const cached = await kvGet(cacheKey);
  if (cached) return json(cached, 200, CACHE_SECONDS);

  try {
    const primaryArtist = String(artist).split(",")[0].trim();
    const [ids, art] = await Promise.all([
      ytSearch(`${primaryArtist} ${title}`.trim(), key),
      spotifyTrackArt(id),
    ]);
    const candidates = await ytDetails(ids, key);
    if (!candidates.length) return json({ error: "No match on YouTube" }, 404, 3600);
    const want = { title, artist, durationSec };
    candidates.sort((a, b) => scoreCandidate(b, want) - scoreCandidate(a, want));
    const [best, ...rest] = candidates;
    const result = { ...best, art, alternates: rest.slice(0, 4) };
    await kvSet(cacheKey, result);
    return json(result, 200, CACHE_SECONDS);
  } catch (e) {
    return json({ error: e.message || "YouTube lookup failed" }, e.status || 502);
  }
}
