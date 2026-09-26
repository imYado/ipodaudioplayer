# Retro iPod — offline PWA music player

A click-wheel music player that looks and works like a classic iPod. Your
music files never leave your phone — they're read once from the Files app
and stored in the browser's IndexedDB, so the app works with airplane mode
on.

## What's inside

```
ipod-pwa/
├── index.html          the whole UI (screen + click wheel)
├── manifest.json        makes it installable ("Add to Home Screen")
├── service-worker.js    caches the app shell for offline use
├── css/style.css        the silver shell / LCD screen look
├── js/id3.js             tiny built-in MP3 tag reader (title/artist/album/art)
├── js/app.js             library, navigation, playback, lock-screen controls
└── icons/                app icons
```

No build step, no npm install, no external libraries — it's plain
HTML/CSS/JS, so you can also just open `index.html` locally to test in a
desktop browser (arrow keys = scroll wheel, Enter = select, Esc = menu,
space = play/pause).

## 1. Deploy it somewhere with HTTPS

iOS requires HTTPS (or localhost) for "Add to Home Screen" to register a
service worker. Pick whichever you're comfortable with:

**GitHub Pages**
```bash
cd ipod-pwa
git init
git add .
git commit -m "Retro iPod PWA"
git branch -M main
git remote add origin https://github.com/<you>/ipod-pwa.git
git push -u origin main
```
Then in the repo: **Settings → Pages → Source: Deploy from a branch → main
/ (root)**. Your app will be live at `https://<you>.github.io/ipod-pwa/`.

**Vercel**
```bash
cd ipod-pwa
npx vercel
```
Follow the prompts (no framework, no build command — it's static files).

**Netlify**
```bash
cd ipod-pwa
npx netlify deploy --prod
```
Or just drag the `ipod-pwa` folder onto https://app.netlify.com/drop.

## 2. Install it on your iPhone

1. Open the deployed URL in **Safari** (must be Safari, not Chrome, for
   Add to Home Screen on iOS).
2. Tap the **Share** button.
3. Tap **Add to Home Screen** → **Add**.
4. Launch it from the home screen icon — it opens full-screen with no
   Safari address bar, like a real app.

## 3. Add your music

From the Main Menu, select **Add Music...** — this opens the iPhone's
native file picker (Files app, iCloud Drive, or "On My iPhone"). Pick any
number of MP3/M4A/AAC/WAV files. Each one is read once, its ID3 tags
(title/artist/album/cover art) are parsed for MP3s, and the audio itself is
saved into IndexedDB. After that, the file is not re-read from Files —
it's fully local to the app.

## How to use the click wheel

- **Touch and drag around the ring** in a circle — clockwise moves the
  selection down / turns volume up, counter-clockwise the opposite.
- **MENU** — go back one screen.
- **Center button** — select a highlighted item; on the Now Playing
  screen, toggles play/pause.
- **⏮ / ⏭** — skip tracks on the Now Playing screen, or jump 5 rows at a
  time when browsing a list.
- **⏯** — play/pause from anywhere.
- **HOLD switch** (top right) — locks the wheel and buttons, just like the
  real thing.

Lock the phone or swipe to another app and the track title, artist, album
art, and playback controls will show on the Lock Screen / Control Center
via the Media Session API.

## Known limitations, honestly

- **M4A/AAC files**: the built-in tag reader only understands MP3 (ID3v2)
  tags. M4A files will still play, but title/artist/album fall back to the
  filename (e.g. name your files `Artist - Title.m4a` for a clean fallback).
- **First tap to play**: iOS sometimes blocks the very first `play()` call
  if it's not tied closely enough to your tap (this is an iOS autoplay
  rule, not a bug in the app) — if a track doesn't start immediately,
  press ⏯ once more.
- **Storage persistence**: the app asks the browser for "persistent
  storage" on first load, which helps, but Safari can still occasionally
  clear site data for installed web apps that go unused for a long time.
  There's no built-in backup/export yet — treat this as a fun local
  player, not your only copy of your music.
- **Battery icon** in the status bar is decorative (browsers don't expose
  real battery level to web apps anymore).
- Big libraries (many hundreds of long tracks) will use real phone
  storage, same as any offline music app — check **Settings → Storage
  Used** inside the app.

## Updating after you make changes

Bump `CACHE_NAME` in `service-worker.js` (e.g. `v1` → `v2`) whenever you
edit any shell file, so returning visitors actually get the new version
instead of the cached one.
