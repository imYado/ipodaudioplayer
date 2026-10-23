/* GET /api/spotify-config?code=<unlock code>
   Returns { clientId } only when the code matches SPOTIFY_UNLOCK_CODE, so
   the Spotify option stays hidden for everyone without the secret link.
   The client ID itself isn't secret (sign-in uses PKCE, no client secret);
   this just keeps the feature invisible. Spotify's own allow-list in the
   developer dashboard is what actually limits who can sign in. */
import { timingSafeEqual } from "node:crypto";
import { json } from "./_shared.js";

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function GET(request) {
  const code = new URL(request.url).searchParams.get("code") || "";
  const expected = process.env.SPOTIFY_UNLOCK_CODE;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!expected || !clientId) return json({ error: "Spotify isn't set up on this site." }, 503);
  if (!code || !sameString(code, expected)) return json({ error: "Wrong unlock code." }, 403);
  return json({ clientId });
}
