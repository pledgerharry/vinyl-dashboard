// Bulk price refresh — fetches live Discogs marketplace median for a batch of releases
// Called in batches of 5 to stay within rate limits

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

  const results = await Promise.allSettled(
    records.map(async ({ releaseId, artist, title, year }) => {
      let price = null;

      if (releaseId) {
        // Strategy 1: marketplace stats — median of real completed sales in GBP
        try {
          const r = await fetch(
            `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
            { headers }
          );
          if (r.ok) {
            const d = await r.json();
            if (d.median?.value > 0) price = Math.round(d.median.value);
            else if (d.lowest_price?.value > 0) price = Math.round(d.lowest_price.value * 1.4);
          }
        } catch {}

        // Strategy 2: price suggestions
        if (!price) {
          try {
            const r = await fetch(
              `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
              { headers }
            );
            if (r.ok) {
              const d = await r.json();
              const vgp = d['Very Good Plus (VG+)'];
              const vg  = d['Very Good (VG)'];
              if (vgp?.value > 0) price = Math.round(vgp.value);
              else if (vg?.value > 0) price = Math.round(vg.value * 1.2);
            }
          } catch {}
        }

        // Strategy 3: community have/want ratio from release data
        if (!price) {
          try {
            const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
            if (r.ok) {
              const d = await r.json();
              const have = d.community?.have || 0;
              const want = d.community?.want || 0;
              const yr = parseInt(d.year || year) || 1980;
              if (have > 0) {
                const ratio = want / have;
                let base = ratio > 3 ? 40 : ratio > 1.5 ? 25 : ratio > 0.8 ? 18 : ratio > 0.4 ? 13 : 9;
                const ageMult = yr < 1970 ? 1.4 : yr < 1980 ? 1.2 : yr < 1990 ? 1.1 : 1.0;
                price = Math.round(Math.min(base * ageMult, 60));
              }
            }
          } catch {}
        }
      }

      // Final fallback: decade estimate
      if (!price) {
        const yr = parseInt(year) || 0;
        price = yr < 1970 ? 20 : yr < 1980 ? 15 : yr < 1990 ? 12 : yr < 2000 ? 10 : yr < 2010 ? 12 : 15;
      }

      return { releaseId, artist, title, price };
    })
  );

  const prices = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ prices });
}
