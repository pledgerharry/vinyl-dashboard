export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ error: 'No token' });

  const { records } = req.body || {};
  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ error: 'No records provided' });
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  async function getReleasePrice(releaseId) {
    // Step 1: get the release to find the master_id
    let masterId = null;
    let releaseYear = null;
    let communityHave = 0;
    let communityWant = 0;

    try {
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        masterId = d.master_id || null;
        releaseYear = d.year || null;
        communityHave = d.community?.have || 0;
        communityWant = d.community?.want || 0;
      }
    } catch {}

    // Step 2: try marketplace stats on master first (bigger sample), then release
    const idsToTry = masterId
      ? [`masters/${masterId}`, `releases/${releaseId}`]
      : [`releases/${releaseId}`];

    for (const endpoint of idsToTry) {
      try {
        // Use GBP for UK market pricing
        const r = await fetch(
          `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
          { headers }
        );
        if (r.ok) {
          const d = await r.json();
          const numSales = d.num_for_sale || 0;
          const blocked = d.blocked_from_sale;

          if (!blocked && d.median?.value > 0) {
            let price = d.median.value;
            // If many copies for sale, lowest price is a better signal (competitive market)
            if (numSales > 20 && d.lowest_price?.value > 0) {
              // Blend median and lowest — closer to lowest when market is flooded
              const blend = numSales > 50 ? 0.3 : 0.5;
              price = (price * (1 - blend)) + (d.lowest_price.value * blend);
            }
            return Math.round(price);
          }

          // Median is 0 but lowest price exists — use lowest + 30% (median tends to be higher)
          if (!blocked && d.lowest_price?.value > 0) {
            return Math.round(d.lowest_price.value * 1.3);
          }
        }
      } catch {}
    }

    // Step 3: try master release stats directly (different endpoint structure)
    if (masterId) {
      try {
        const r = await fetch(
          `https://api.discogs.com/masters/${masterId}`,
          { headers }
        );
        if (r.ok) {
          const d = await r.json();
          // Masters have lowest_price in the main data
          if (d.lowest_price > 0) {
            return Math.round(d.lowest_price * 1.35);
          }
        }
      } catch {}
    }

    // Step 4: price suggestions (VG+ condition)
    try {
      const r = await fetch(
        `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
        { headers }
      );
      if (r.ok) {
        const d = await r.json();
        const vgp = d['Very Good Plus (VG+)'];
        const vg  = d['Very Good (VG)'];
        const g   = d['Good Plus (G+)'];
        if (vgp?.value > 0) return Math.round(vgp.value);
        if (vg?.value  > 0) return Math.round(vg.value * 1.25);
        if (g?.value   > 0) return Math.round(g.value  * 1.6);
      }
    } catch {}

    // Step 5: community have/want heuristic — improved formula
    if (communityHave > 0) {
      const ratio = communityWant / communityHave;
      const yr = parseInt(releaseYear) || 1985;

      // Base price — more nuanced bands
      let base;
      if (ratio > 5)      base = 55;   // extremely rare/sought after
      else if (ratio > 3) base = 38;
      else if (ratio > 2) base = 28;
      else if (ratio > 1) base = 20;
      else if (ratio > 0.5) base = 15;
      else if (ratio > 0.2) base = 12;
      else base = 10;                  // very common pressing

      // Popularity floor — records with huge ownership are usually well-known
      // classics that still command a decent price regardless of ratio
      if (communityHave > 10000) base = Math.max(base, 14);
      if (communityHave > 50000) base = Math.max(base, 16);

      // Age premium
      const ageMult = yr < 1965 ? 1.6
                    : yr < 1970 ? 1.4
                    : yr < 1975 ? 1.25
                    : yr < 1980 ? 1.15
                    : yr < 1990 ? 1.05
                    : 1.0;

      return Math.round(Math.min(base * ageMult, 80));
    }

    // Absolute fallback: decade estimate
    const yr = parseInt(releaseYear) || 0;
    return yr < 1970 ? 22 : yr < 1980 ? 16 : yr < 1990 ? 13 : yr < 2000 ? 11 : 13;
  }

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      const price = releaseId ? await getReleasePrice(releaseId) : (() => {
        const yr = parseInt(year) || 0;
        return yr < 1970 ? 22 : yr < 1980 ? 16 : yr < 1990 ? 13 : yr < 2000 ? 11 : 13;
      })();
      return { releaseId, artist, title, price };
    })
  );

  const prices = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ prices });
}
