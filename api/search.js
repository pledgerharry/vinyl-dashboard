// Genre mapping from Discogs styles/genres to our app's genre labels
const GENRE_MAP = {
  'soul': 'Soul / Funk', 'funk': 'Soul / Funk', 'rhythm & blues': 'Soul / Funk',
  'r&b': 'Soul / Funk', 'disco': 'Disco / Pop', 'motown': 'Motown',
  'hip hop': 'Hip-Hop', 'hip-hop': 'Hip-Hop', 'rap': 'Hip-Hop',
  'neo soul': 'Neo-Soul / Leftfield', 'neo-soul': 'Neo-Soul / Leftfield',
  'contemporary r&b': 'Neo-Soul / Leftfield', 'indie r&b': 'Neo-Soul / Leftfield',
  'afrobeat': 'Neo-Soul / Leftfield', 'leftfield': 'Neo-Soul / Leftfield',
  'jazz': 'Jazz', 'jazz-funk': 'Jazz', 'jazz funk': 'Jazz', 'bossa nova': 'Jazz',
  'reggae': 'Reggae', 'dub': 'Reggae', 'ska': 'Reggae', 'rocksteady': 'Reggae',
  'electronic': 'Electronic', 'house': 'Electronic', 'techno': 'Electronic',
  'synth-pop': 'Electronic', 'new wave': 'Rock / New Wave', 'post-punk': 'Rock / New Wave',
  'rock': 'Rock / New Wave', 'punk': 'Rock / New Wave', 'indie rock': 'Rock / New Wave',
  'pop rock': 'Rock / New Wave', 'classic rock': 'Rock / New Wave',
  'pop': 'R&B / Pop',
};

function inferGenre(styles = [], genres = []) {
  const all = [...styles, ...genres].map(s => s.toLowerCase());
  for (const tag of all) {
    for (const [key, val] of Object.entries(GENRE_MAP)) {
      if (tag.includes(key)) return val;
    }
  }
  return null;
}

function inferTier(price, year) {
  const yr = parseInt(year) || 0;
  // HMV deal: modern releases on major labels, typically £22
  if (yr >= 2014 && price >= 18 && price <= 26) return { tier: 'hmv', hmvNote: 'deal' };
  // Patience: expensive or box sets
  if (price >= 35) return { tier: 'patience', hmvNote: 'nothmv' };
  // S/H: cheap older records
  if (price <= 14 || yr < 1990) return { tier: 'sh', hmvNote: 'nothmv' };
  // Default: store
  return { tier: 'store', hmvNote: 'nothmv' };
}

export default async function handler(req, res) {
  const { artist, title, catalog, releaseId } = req.query;

  if (!artist && !title && !catalog && !releaseId) {
    return res.status(400).json({ error: 'Provide at least one search field' });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ results: [] });

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'VinylDashboard/1.0'
  };

  try {
    let raw = [];

    if (releaseId) {
      // Direct release lookup — most precise, used when we already have the ID
      const r = await fetch(`https://api.discogs.com/releases/${releaseId}`, { headers });
      if (r.ok) {
        const d = await r.json();
        raw = [{ ...d, id: d.id, title: `${d.artists?.[0]?.name || ''} - ${d.title}`, catno: d.labels?.[0]?.catno || '' }];
      }
    } else {
      let url;
      if (catalog) {
        const q = encodeURIComponent(catalog + (artist ? ' ' + artist : ''));
        url = `https://api.discogs.com/database/search?q=${q}&catno=${encodeURIComponent(catalog)}&type=release&per_page=8&format=vinyl`;
      } else {
        const q = encodeURIComponent(`${artist || ''} ${title || ''}`.trim());
        url = `https://api.discogs.com/database/search?q=${q}&type=release&per_page=8&format=vinyl`;
      }
      const r = await fetch(url, { headers });
      if (!r.ok) return res.status(200).json({ results: [] });
      const d = await r.json();
      raw = d.results || [];
    }

    // For the top 4 results, fetch price suggestions to get real market value
    const results = await Promise.allSettled(
      raw.slice(0, 4).map(async r => {
        let price = null;
        let genre = null;
        let styles = [];

        // Try to get price suggestions from Discogs marketplace stats
        try {
          const priceRes = await fetch(
            `https://api.discogs.com/marketplace/price_suggestions/${r.id}`,
            { headers }
          );
          if (priceRes.ok) {
            const pd = await priceRes.json();
            // Use "Very Good Plus" as our reference condition
            const vgp = pd['Very Good Plus (VG+)'];
            if (vgp?.value) price = Math.round(vgp.value);
          }
        } catch {}

        // If no price from marketplace, use community stats to estimate
        if (!price) {
          const have = r.community?.have || 0;
          const want = r.community?.want || 0;
          if (have > 0 && want > 0) {
            // High want/have ratio = rarer = more expensive
            const ratio = want / have;
            price = ratio > 2 ? 28 : ratio > 1 ? 20 : ratio > 0.5 ? 14 : 10;
          }
        }

        // Get genre from styles/genres array
        const genreList = r.genre || [];
        const styleList = r.style || r.styles || [];
        genre = inferGenre(styleList, genreList);

        const parts = (r.title || '').split(' - ');
        const dt = parts.length > 1 ? parts.slice(1).join(' - ') : r.title;
        const da = parts[0] || artist || '';

        const year = r.year || r.released_formatted?.split('-')[0] || '';
        const inferredTier = inferTier(price || 12, year);

        return {
          title: r.title || '',
          displayArtist: da,
          displayTitle: dt,
          year: String(year),
          label: (r.label || r.labels)?.[0]?.name || (r.label || [])?.[0] || '',
          catno: r.catno || r.labels?.[0]?.catno || '',
          image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image
               : r.images?.find(i => i.type === 'primary')?.uri || null,
          price: price || null,
          genre,
          tier: inferredTier.tier,
          hmvNote: inferredTier.hmvNote,
          id: r.id,
        };
      })
    );

    const final = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    res.setHeader('Cache-Control', 's-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ results: final });

  } catch (err) {
    return res.status(200).json({ results: [] });
  }
}
