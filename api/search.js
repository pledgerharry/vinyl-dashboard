export default async function handler(req, res) {
  const { artist, title, catalog } = req.query;

  if (!artist && !title && !catalog) {
    return res.status(400).json({ error: 'Provide at least one search field' });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) return res.status(500).json({ results: [] });

  try {
    const headers = {
      'Authorization': `Discogs token=${token}`,
      'User-Agent': 'VinylDashboard/1.0'
    };

    // Catalog number is most precise — use it as primary query if provided
    let url;
    if (catalog) {
      const q = encodeURIComponent(catalog + (artist ? ' ' + artist : ''));
      url = `https://api.discogs.com/database/search?q=${q}&catno=${encodeURIComponent(catalog)}&type=release&per_page=8&format=vinyl`;
    } else {
      const q = encodeURIComponent(`${artist || ''} ${title || ''}`.trim());
      url = `https://api.discogs.com/database/search?q=${q}&type=release&per_page=8&format=vinyl`;
    }

    const searchRes = await fetch(url, { headers });
    if (!searchRes.ok) return res.status(200).json({ results: [] });

    const data = await searchRes.json();
    const raw = data.results || [];

    const results = raw.slice(0, 6).map(r => ({
      title: r.title || '',
      year: r.year || '',
      label: (r.label || [])[0] || '',
      catno: r.catno || '',
      image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image : null,
      have: r.community?.have || 0,
      want: r.community?.want || 0,
      id: r.id,
    }));

    res.setHeader('Cache-Control', 's-maxage=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ results });

  } catch (err) {
    return res.status(200).json({ results: [] });
  }
}
