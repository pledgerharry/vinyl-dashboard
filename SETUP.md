# Vinyl Dashboard — Setup Instructions

You'll need about 15–20 minutes and your phone nearby at the end.
No coding knowledge required. Everything is free.

---

## Files you have

- `index.html` — the app
- `data.js` — your collection and wishlist data
- `vercel.json` — hosting config
- `icon.svg` — home screen icon
- `SETUP.md` — this file

---

## Step 1 — Create a GitHub account

1. Go to **github.com**
2. Click **Sign up** and create a free account
3. Verify your email

---

## Step 2 — Create a new repository

1. Once logged in, click the **+** icon (top right) → **New repository**
2. Name it: `vinyl-dashboard` (or anything you like)
3. Make sure it's set to **Public**
4. Tick **Add a README file**
5. Click **Create repository**

---

## Step 3 — Upload the files

1. On your new repository page, click **Add file** → **Upload files**
2. Drag all four files into the upload area:
   - `index.html`
   - `data.js`
   - `vercel.json`
   - `icon.svg`
3. Scroll down and click **Commit changes**

---

## Step 4 — Deploy with Vercel

1. Go to **vercel.com**
2. Click **Sign up** → choose **Continue with GitHub** (easiest option)
3. Once logged in, click **Add New Project**
4. You'll see your GitHub repositories — click **Import** next to `vinyl-dashboard`
5. On the next screen, leave everything as default and click **Deploy**
6. Wait about 30 seconds — Vercel will give you a URL like:
   `https://vinyl-dashboard-abc123.vercel.app`

---

## Step 5 — Add to your phone home screen

**On iPhone:**
1. Open the URL in **Safari** (must be Safari, not Chrome)
2. Tap the **Share** icon (box with arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Name it `Vinyl` and tap **Add**

**On Android:**
1. Open the URL in **Chrome**
2. Tap the three-dot menu (top right)
3. Tap **Add to Home screen**
4. Tap **Add**

It'll appear on your home screen like an app and open full screen.

---

## Updating the data (when you get new records)

When you want to update your collection or wishlist:

1. Send your new Discogs CSV to Claude and ask for an updated `data.js` file
2. Go to your GitHub repository
3. Click on `data.js`
4. Click the **pencil icon** (Edit this file)
5. Select all the text and replace it with the new content
6. Click **Commit changes**

Vercel will automatically redeploy within 30 seconds.
Your URL stays the same — just refresh the page on your phone.

---

## Troubleshooting

**Artwork not loading?**
The app fetches album artwork from the Cover Art Archive (coverartarchive.org).
This requires an internet connection. If you're offline, you'll see vinyl record placeholders instead — everything else works fine.

**The URL looks ugly?**
You can set a custom domain on Vercel for free if you own one, but the default URL works perfectly.

**Lost your URL?**
Log into vercel.com — all your deployments are listed there.
