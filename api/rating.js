export default async function handler(req, res) {
  const { artist, title } = req.query;
  if (!artist || !title) return res.status(400).json({ error: 'Missing params' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=604800');

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // ── Pitchfork ─────────────────────────────────────────────
  try {
    // Try Pitchfork's search
    const q = encodeURIComponent(`${artist} ${title}`);
    const pfRes = await fetch(
      `https://pitchfork.com/api/v2/search/?query=${q}&types=reviews&hierarchy=sections%2Freviews&size=8`,
      { headers: browserHeaders }
    );

    if (pfRes.ok) {
      const text = await pfRes.text();
      // Parse JSON carefully — Pitchfork sometimes returns HTML on bot detection
      if (text.trim().startsWith('{')) {
        const pfData = JSON.parse(text);
        const hits = pfData?.results?.hits || [];

        const al = artist.toLowerCase().replace(/[^a-z0-9]/g,'');
        const tl = title.toLowerCase().replace(/[^a-z0-9]/g,'');

        for (const h of hits) {
          const albums = h?.tombstone?.albums || [];
          for (const alb of albums) {
            const ha = (alb?.album?.artists?.[0]?.display_name || '').toLowerCase().replace(/[^a-z0-9]/g,'');
            const ht = (alb?.album?.displayName || '').toLowerCase().replace(/[^a-z0-9]/g,'');
            const rating = alb?.rating?.displayRating || h?.tombstone?.ratings?.[0]?.displayRating;
            const artistMatch = ha.includes(al.slice(0,5)) || al.includes(ha.slice(0,5));
            const titleMatch  = ht.includes(tl.slice(0,5)) || tl.includes(ht.slice(0,5));
            if (artistMatch && titleMatch && rating) {
              return res.status(200).json({
                source: 'Pitchfork',
                rating: parseFloat(rating),
                outOf: 10,
                url: h?.url ? `https://pitchfork.com${h.url}` : null,
                bnm: h?.tombstone?.bnm || false,
                bne: h?.tombstone?.bne || false,
              });
            }
          }
        }
      }
    }
  } catch {}

  // ── MusicBrainz ───────────────────────────────────────────
  try {
    // MusicBrainz requires rate-limit friendly User-Agent
    await new Promise(r => setTimeout(r, 200)); // brief pause for MB rate limits
    const q = encodeURIComponent(`"${title}" AND artist:"${artist}"`);
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=8`,
      { headers: { 'User-Agent': 'VinylDashboard/1.0 (hazzp24@vinyl.app)' } }
    );

    if (mbRes.ok) {
      const mbData = await mbRes.json();
      const groups = mbData?.['release-groups'] || [];
      const al = artist.toLowerCase().replace(/[^a-z0-9]/g,'');
      const tl = title.toLowerCase().replace(/[^a-z0-9]/g,'');

      for (const g of groups) {
        const ga = (g['artist-credit']?.[0]?.name || '').toLowerCase().replace(/[^a-z0-9]/g,'');
        const gt = (g.title || '').toLowerCase().replace(/[^a-z0-9]/g,'');
        const artistMatch = ga.includes(al.slice(0,5)) || al.includes(ga.slice(0,5));
        const titleMatch  = gt.includes(tl.slice(0,5)) || tl.includes(gt.slice(0,5));
        if (artistMatch && titleMatch && g?.rating?.value && g.rating['votes-count'] >= 3) {
          return res.status(200).json({
            source: 'MusicBrainz',
            rating: parseFloat((g.rating.value / 10).toFixed(1)),
            outOf: 10,
            url: `https://musicbrainz.org/release-group/${g.id}`,
            bnm: false,
            bne: false,
          });
        }
      }
    }
  } catch {}

  return res.status(200).json({ source: null, rating: null });
}
