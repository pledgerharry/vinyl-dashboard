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
  if (yr >= 2014 && price >= 18 && price <= 26) return { tier: 'hmv', hmvNote: 'deal' };
  if (price >= 35) return { tier: 'patience', hmvNote: 'nothmv' };
  if (price <= 14 || yr < 1990) return { tier: 'sh', hmvNote: 'nothmv' };
  return { tier: 'store', hmvNote: 'nothmv' };
}

async function getMarketPrice(releaseId, headers) {
  // Strategy 1: Discogs marketplace stats (most accurate — real sale prices)
  try {
    const r = await fetch(
      `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=GBP`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      // median_price is the most reliable indicator
      if (d.median?.value > 0) return Math.round(d.median.value);
      if (d.lowest_price?.value > 0) {
        // If we only have lowest, estimate median as ~1.4x lowest
        return Math.round(d.lowest_price.value * 1.4);
      }
    }
  } catch {}

  // Strategy 2: price_suggestions (requires auth but worth trying)
  try {
    const r = await fetch(
      `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      const vgp = d['Very Good Plus (VG+)'];
      const vg  = d['Very Good (VG)'];
      if (vgp?.value > 0) return Math.round(vgp.value);
      if (vg?.value > 0)  return Math.round(vg.value * 1.2);
    }
  } catch {}

  return null;
}

function priceFromCommunity(r) {
  // Use community have/want ratio + year to estimate realistic UK price
  const have = r.community?.have || 0;
  const want = r.community?.want || 0;
  const year = parseInt(r.year) || 1980;

  if (have === 0) return 12; // no data

  const ratio = want / have;
  const age = Math.max(0, 2025 - year);

  // Base price from want/have scarcity
  let base;
  if (ratio > 3)      base = 40;  // very sought after
  else if (ratio > 1.5) base = 25;
  else if (ratio > 0.8) base = 18;
  else if (ratio > 0.4) base = 13;
  else                  base = 9;  // very common pressing

  // Age premium: older records tend to cost more
  const ageMult = year < 1970 ? 1.4 : year < 1980 ? 1.2 : year < 1990 ? 1.1 : 1.0;

  return Math.round(Math.min(base * ageMult, 60)); // cap at £60
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

    const results = await Promise.allSettled(
      raw.slice(0, 4).map(async r => {
        // Try real marketplace price first, fall back to community estimate
        let price = await getMarketPrice(r.id, headers);
        if (!price) price = priceFromCommunity(r);

        const genreList = r.genre || [];
        const styleList = r.style || r.styles || [];
        const genre = inferGenre(styleList, genreList);

        const parts = (r.title || '').split(' - ');
        const dt = parts.length > 1 ? parts.slice(1).join(' - ') : r.title;
        const da = parts[0] || artist || '';
        const year = r.year || r.released_formatted?.split('-')[0] || '';
        const inferredTier = inferTier(price, year);

        return {
          title: r.title || '',
          displayArtist: da,
          displayTitle: dt,
          year: String(year),
          label: (r.label || r.labels)?.[0]?.name || (r.label || [])?.[0] || '',
          catno: r.catno || r.labels?.[0]?.catno || '',
          image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image
               : r.images?.find(i => i.type === 'primary')?.uri || null,
          price,
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
