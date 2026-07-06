# Concert Word Score

A self-contained, offline listening guide for live concerts. Tap a movement to start its
timer; the guide advances section to section, showing what to watch and listen for. Tap a
highlighted event cue (♪ hear / ◉ see) the moment it happens to re-sync the timer.

Installed to an iPhone home screen (as a PWA), it runs **fully offline** in the hall.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The player. Loads `program.json` automatically. |
| `program.json` | The concert data (the "word score"). Swap this to change concerts. |
| `manifest.webmanifest` | Makes it installable as an app. |
| `service-worker.js` | Caches everything so it works with no signal. |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | App icons. |

## Publish (one time)

1. Put all these files in the **root** of the `ConcertDescription` repo (see below).
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. Wait ~1 minute. Your app is live at:
   **https://bruce454wilson.github.io/ConcertDescription/**

## Install on the iPhone (one time, over Wi-Fi)

1. Open that URL in **Safari** (must be Safari, not the in-app browser).
2. Tap the **Share** button → **Add to Home Screen**.
3. Open it once from the home screen while still online — this lets the service worker
   cache everything.
4. After that it launches from the home screen and **works offline** in the hall.

## Update the program for a new concert

Replace `program.json` with the new concert's data and push. Next time you open the app
online, it fetches and caches the new program automatically. (Offline, it keeps showing the
last one it cached.)

If you change `index.html` or the service worker itself, bump the `CACHE` version string in
`service-worker.js` (e.g. `...-v1` → `...-v2`) so phones pick up the new version.

## Getting the files into the repo

**Option A — GitHub website (easiest):** open the repo, **Add file → Upload files**, drag in
all the files from this folder, then **Commit changes**.

**Option B — git command line:**
```
git clone https://github.com/bruce454wilson/ConcertDescription.git
# copy all files from this folder into the cloned ConcertDescription folder
cd ConcertDescription
git add .
git commit -m "Add Concert Word Score PWA"
git push
```
