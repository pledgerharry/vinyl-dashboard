# Vinyl Dashboard — Setup Instructions

Complete setup takes about 20 minutes. Everything is free.

---

## Files in this zip

- `index.html` — the app
- `data.js` — seed data (initial collection + wishlist)
- `vercel.json` — hosting config
- `icon.svg` — home screen icon
- `api/artwork.js` — Discogs artwork proxy
- `api/search.js` — Discogs search proxy
- `api/sheets.js` — Google Sheets proxy
- `google-apps-script.js` — paste this into Google Apps Script
- `SETUP.md` — this file

---

## Step 1 — Create a Google Sheet

1. Go to **sheets.google.com** and create a new blank spreadsheet
2. Name it `Vinyl Dashboard`
3. Copy the Sheet ID from the URL — it's the long string between `/d/` and `/edit`
   Example: `https://docs.google.com/spreadsheets/d/**1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms**/edit`

---

## Step 2 — Set up Google Apps Script

1. In your Google Sheet, click **Extensions** → **Apps Script**
2. Delete all the default code in the editor
3. Open `google-apps-script.js` from this zip and paste the entire contents
4. Find the line `const SHEET_ID = 'YOUR_SHEET_ID_HERE';` and replace the placeholder with your actual Sheet ID from Step 1
5. Click **Save** (the floppy disk icon)
6. In the toolbar, select the function `setupSheets` from the dropdown and click **Run**
   - This creates the two tabs (collection and wishlist) with the right headers
   - You'll be asked to authorise access — click through and allow it
7. Now deploy it as a web app:
   - Click **Deploy** → **New deployment**
   - Click the gear icon next to "Type" and select **Web app**
   - Set **Execute as**: Me
   - Set **Who has access**: Anyone
   - Click **Deploy**
   - Copy the web app URL — it looks like `https://script.google.com/macros/s/XXXX/exec`

---

## Step 3 — Get a Discogs API token

1. Log into **discogs.com**
2. Go to **Settings** → **Developers** (or discogs.com/settings/developers)
3. Click **Generate new token** and copy it

---

## Step 4 — GitHub

Upload all files to your GitHub repo. Make sure the structure looks like this:

```
index.html
data.js
vercel.json
icon.svg
api/
  artwork.js
  search.js
  sheets.js
google-apps-script.js
```

To create the api folder: click **Add file** → **Create new file** → type `api/artwork.js` in the name box.

---

## Step 5 — Vercel environment variables

In your Vercel project → **Settings** → **Environment Variables**, add:

| Name | Value |
|------|-------|
| `DISCOGS_TOKEN` | your Discogs token from Step 3 |
| `APPS_SCRIPT_URL` | your Apps Script web app URL from Step 2 |

Then redeploy: go to your Vercel project → **Deployments** → click the three dots on the latest → **Redeploy**.

---

## Step 6 — Populate the sheet

On first load, the app reads from the sheet. Since it's empty, it falls back to the seed data in `data.js` and you'll see a red dot in the header.

To populate the sheet with your collection and wishlist:

1. Open your Google Sheet
2. On the **collection** tab, copy and paste the data from `data.js` (the `COLL_SEED` array) — or just use the app normally and let it build up over time
3. Alternatively, run the Apps Script function `populateFromSeed` if you add one — or ask Claude to write a one-off migration script

The easiest route: once the app is deployed and the environment variables are set, just use the app. Any record you mark as Purchased or add manually will sync to the sheet automatically.

---

## Step 7 — Add to phone home screen

**iPhone (Safari only):**
1. Open your Vercel URL in Safari
2. Tap the Share icon → **Add to Home Screen**
3. Name it `Vinyl` → tap **Add**

**Android (Chrome):**
1. Open in Chrome → three-dot menu → **Add to Home screen**

---

## Updating collection data

Drop your Discogs CSV export here and ask Claude for an updated `data.js`. Then replace the file in GitHub — but note the sheet is now the source of truth. Use the migration script approach or update the sheet directly.

## The sync dot

The small dot in the header shows sync status:
- **Grey** — not yet synced
- **Yellow pulsing** — syncing
- **Green** — all good
- **Red** — sheets not reachable (app still works from seed data)
