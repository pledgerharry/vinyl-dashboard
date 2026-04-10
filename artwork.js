export default async function handler(req, res) {
  const { artist, title } = req.query;

  if (!artist || !title) {
    return res.status(400).json({ error: 'Missing artist or title' });
  }

  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const response = await fetch(
      `https://itunes.apple.com/search?term=${q}&entity=album&limit=8`,
      { headers: { 'User-Agent': 'VinylDashboard/1.0' } }
    );

    if (!response.ok) {
      return res.status(502).json({ url: null });
    }

    const data = await response.json();
    const results = data.results || [];

    const al = artist.toLowerCase();
    const tl = title.toLowerCase().split(' ')[0];

    // Try to find a result where both artist and title match reasonably
    let best = results.find(x => {
      const ra = (x.artistName || '').toLowerCase();
      const rt = (x.collectionName || '').toLowerCase();
      return ra.includes(al.split(' ')[0]) && rt.includes(tl);
    }) || results[0];

    const url = best?.artworkUrl100
      ? best.artworkUrl100.replace('100x100bb', '300x300bb')
      : null;

    // Cache for 30 days on CDN
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ url });

  } catch (err) {
    return res.status(200).json({ url: null });
  }
}
