/* GET /api/playlist?url=<Spotify playlist or album link>
   Returns { type, id, name, image, tracks: [{ id, title, artist, album, durationMs, image }] }

   Uses the Spotify Web API (client-credentials, no user sign-in, so it is
   not limited to allow-listed accounts) when SPOTIFY_CLIENT_ID and
   SPOTIFY_CLIENT_SECRET are set. Otherwise, or if the API refuses the
   playlist (e.g. Spotify's own editorial playlists), it falls back to the
   public embed page, which lists the tracks without needing a key. */
import { json } from "./_shared.js";

const MAX_TRACKS = 500;

export function parseSpotifyLink(input) {
  const s = String(input || "").trim();
  let m = s.match(/^spotify:(playlist|album):([A-Za-z0-9]{10,})/);
  if (m) return { type: m[1], id: m[2] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{10,})/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  return null;
}

let tokenCache = { token: null, expires: 0 };

async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function spotifyGet(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = new Error(`Spotify API ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function bestImage(images) {
  if (!Array.isArray(images) || !images.length) return null;
  // Prefer ~640px; Spotify lists largest first.
  return images[0].url || null;
}

function mapApiTrack(t, fallbackAlbum) {
  if (!t || !t.id || t.is_local) return null;
  const album = t.album || fallbackAlbum || {};
  return {
    id: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(", "),
    album: album.name || "",
    durationMs: t.duration_ms || 0,
    image: bestImage(album.images),
  };
}

async function fromApi({ type, id }, token) {
  const base = "https://api.spotify.com/v1";
  if (type === "album") {
    const album = await spotifyGet(`${base}/albums/${id}`, token);
    const tracks = [];
    let page = album.tracks;
    while (page) {
      page.items.forEach((t) => { const m = mapApiTrack(t, album); if (m) tracks.push(m); });
      if (!page.next || tracks.length >= MAX_TRACKS) break;
      page = await spotifyGet(page.next, token);
    }
    return { type, id, name: album.name, image: bestImage(album.images), tracks };
  }
  const fields = "name,images,tracks.next,tracks.items(track(id,name,duration_ms,is_local,artists(name),album(name,images)))";
  const pl = await spotifyGet(`${base}/playlists/${id}?fields=${encodeURIComponent(fields)}`, token);
  const tracks = [];
  let page = pl.tracks;
  while (page) {
    page.items.forEach((it) => { const m = mapApiTrack(it && it.track); if (m) tracks.push(m); });
    if (!page.next || tracks.length >= MAX_TRACKS) break;
    page = await spotifyGet(page.next, token);
  }
  return { type, id, name: pl.name, image: bestImage(pl.images), tracks };
}

/* Finds the first object in a JSON tree that has a non-empty `trackList`. */
function findEntity(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 12) return null;
  if (Array.isArray(node.trackList) && node.trackList.length) return node;
  for (const v of Object.values(node)) {
    const found = findEntity(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function embedImage(entity) {
  const sources = (entity.coverArt && entity.coverArt.sources) ||
    (entity.visualIdentity && entity.visualIdentity.image) || [];
  if (!sources.length) return null;
  const sorted = sources.slice().sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0));
  return sorted[0].url || null;
}

export function parseEmbedHtml(html, { type, id }) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Couldn't read that playlist");
  const entity = findEntity(JSON.parse(m[1]));
  if (!entity) throw new Error("That playlist looks empty or private");
  const image = embedImage(entity);
  const tracks = entity.trackList.map((t) => {
    const tid = String(t.uri || "").split(":").pop();
    if (!tid || !t.title) return null;
    return {
      id: tid,
      title: t.title,
      artist: t.subtitle || "",
      album: type === "album" ? (entity.name || entity.title || "") : "",
      durationMs: t.duration || 0,
      image: type === "album" ? image : null,
    };
  }).filter(Boolean);
  return { type, id, name: entity.name || entity.title || "Playlist", image, tracks };
}

async function fromEmbed(ref) {
  const res = await fetch(`https://open.spotify.com/embed/${ref.type}/${ref.id}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; RetroIpod/1.0)", "accept-language": "en" },
  });
  if (!res.ok) throw new Error(`Spotify returned ${res.status} for that link`);
  return parseEmbedHtml(await res.text(), ref);
}

export async function GET(request) {
  const url = new URL(request.url);
  const ref = parseSpotifyLink(url.searchParams.get("url"));
  if (!ref) return json({ error: "That doesn't look like a Spotify playlist or album link." }, 400);

  try {
    let data = null;
    const token = await getSpotifyToken().catch(() => null);
    if (token) {
      try { data = await fromApi(ref, token); } catch (e) { data = null; }
    }
    if (!data || !data.tracks.length) data = await fromEmbed(ref);
    if (!data.tracks.length) return json({ error: "No playable tracks in that link." }, 404);
    return json(data, 200, 600);
  } catch (e) {
    return json({ error: e.message || "Couldn't load that link." }, 502);
  }
}
