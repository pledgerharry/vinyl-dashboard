// Fetches album rating from Pitchfork via their internal search API
// Falls back to MusicBrainz community rating if Pitchfork has no review

export default async function handler(req, res) {
  const { artist, title } = req.query;
  if (!artist || !title) return res.status(400).json({ error: 'Missing artist or title' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=604800'); // cache 7 days

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  // ── Try Pitchfork ─────────────────────────────────────────
  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const pfRes = await fetch(
      `https://pitchfork.com/api/v2/search/?query=${q}&types=reviews&hierarchy=sections%2Freviews&size=5`,
      { headers }
    );

    if (pfRes.ok) {
      const pfData = await pfRes.json();
      const hits = pfData?.results?.hits || [];

      // Find best match
      const al = artist.toLowerCase();
      const tl = title.toLowerCase().replace(/[^a-z0-9 ]/g, '');

      const match = hits.find(h => {
        const albums = h?.tombstone?.albums || [];
        return albums.some(a => {
          const ha = (a?.album?.artists?.[0]?.display_name || '').toLowerCase();
          const ht = (a?.album?.displayName || '').toLowerCase().replace(/[^a-z0-9 ]/g, '');
          return (ha.includes(al.split(' ')[0]) || al.includes(ha.split(' ')[0]))
              && (ht.includes(tl.split(' ')[0]) || tl.includes(ht.split(' ')[0]));
        });
      });

      if (match) {
        const albums = match?.tombstone?.albums || [];
        const rating = albums[0]?.rating?.displayRating;
        const url = match?.url ? `https://pitchfork.com${match.url}` : null;
        const bnm = match?.tombstone?.bnm || false;
        const bne = match?.tombstone?.bne || false;
        if (rating) {
          return res.status(200).json({
            source: 'Pitchfork',
            rating: parseFloat(rating),
            outOf: 10,
            url,
            bnm, // Best New Music
            bne, // Best New Reissue
          });
        }
      }
    }
  } catch {}

  // ── Fall back to MusicBrainz community rating ─────────────
  try {
    const q = encodeURIComponent(`release:${title} AND artist:${artist}`);
    const mbRes = await fetch(
      `https://musicbrainz.org/ws/2/release-group/?query=${q}&fmt=json&limit=5`,
      { headers: { 'User-Agent': 'VinylDashboard/1.0 (vinyl@hazzp24.com)' } }
    );

    if (mbRes.ok) {
      const mbData = await mbRes.json();
      const groups = mbData?.['release-groups'] || [];
      const al = artist.toLowerCase();
      const tl = title.toLowerCase();

      const match = groups.find(g => {
        const ga = (g['artist-credit']?.[0]?.name || '').toLowerCase();
        const gt = (g.title || '').toLowerCase();
        return (ga.includes(al.split(' ')[0]) || al.includes(ga.split(' ')[0]))
            && (gt.includes(tl.split(' ')[0]) || tl.includes(gt.split(' ')[0]));
      });

      if (match?.rating?.value && match.rating['votes-count'] > 2) {
        // MusicBrainz is 0-100, convert to 0-10
        const rating = Math.round(match.rating.value) / 10;
        return res.status(200).json({
          source: 'MusicBrainz',
          rating,
          outOf: 10,
          url: `https://musicbrainz.org/release-group/${match.id}`,
          bnm: false,
          bne: false,
        });
      }
    }
  } catch {}

  // No rating found
  return res.status(200).json({ source: null, rating: null });
}
