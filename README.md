# Petal – a free, private period tracker

A Progressive Web App (PWA). It installs on Android and iPhone from a link, gets a home-screen icon,
works offline, never expires, and needs no backend or account. All data stays on the phone.

No build step and nothing to install: it is plain HTML/CSS/JS.

## 1. Try it on your computer and your iPhone (VS Code)

1. Open this folder in VS Code.
2. Install the **Live Server** extension, right-click `index.html` → **Open with Live Server**.
3. On your iPhone (same Wi-Fi), open `http://<your-computer-IP>:5500`.
   (Over plain http the offline/install features are off, but you can test every screen.)

Run the logic tests any time: `node tests/engine.test.js`

## 2. Put it online once (this is what makes it installable and permanent)

Free and permanent: **GitHub Pages**.

1. Create a GitHub account, then a new **public** repo (e.g. `petal`).
2. Upload everything in this folder (drag and drop in the web UI works).
3. Repo **Settings → Pages → Build from branch → main / root → Save**.
4. After a minute you get a link like `https://yourname.github.io/petal/`.

Only the app code is public. Her data never goes to GitHub, it stays on her phone.
Do not put any personal info in the repo.

To update the app later, upload the changed files. She gets the update the next time she opens it
(the service worker refreshes in the background). If you change files, bump `CACHE = 'petal-v1'` in `sw.js`.

## 3. Install on her Android

Open the link in **Chrome → ⋮ menu → Install app**. Open Petal from the new icon and do the setup there.

## 4. Install on your iPhone

Open the link in **Safari → Share → Add to Home Screen**. Do the setup inside the installed app,
because on iPhone the home-screen app keeps its own separate storage from Safari.

## How predictions work

- Cycle length: weighted average of the last 6 cycles (recent ones count more). With fewer than 3 cycles,
  her own estimate fills the gap. A forgotten log (one huge outlier cycle) is ignored.
- Window of uncertainty (±days) comes from how much her cycles actually vary.
- Ovulation = next period minus luteal phase (default 14 days). Fertile window = 5 days before to 1 day after.
- A positive LH test or a temperature shift (3-over-6 rule) confirms ovulation, tightens the next-period
  prediction, and teaches Petal her personal luteal length.
- Insights include a back-test: how far off past predictions would have been.

Predictions are estimates. Petal is not birth control.

## Data & backup

Everything is in the browser's localStorage. Settings → **Back up data** exports a JSON file
(restore it on a new phone with **Restore backup**). Clearing site data or uninstalling deletes the data,
so back up occasionally. The PIN is a privacy screen, not encryption.

## Files

`index.html`, `styles.css`, `app.js` (UI), `engine.js` (predictions), `sw.js` (offline),
`manifest.webmanifest`, `icons/`, `tests/`.
