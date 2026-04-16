export default async function handler(req, res) {
  const { artist, title } = req.query;

  if (!artist || !title) {
    return res.status(400).json({ error: 'Missing artist or title' });
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'No Discogs token configured' });
  }

  try {
    const q = encodeURIComponent(`${artist} ${title}`);
    const searchRes = await fetch(
      `https://api.discogs.com/database/search?q=${q}&type=release&per_page=8&format=vinyl`,
      {
        headers: {
          'Authorization': `Discogs token=${token}`,
          'User-Agent': 'VinylDashboard/1.0'
        }
      }
    );

    if (!searchRes.ok) {
      return res.status(200).json({ results: [] });
    }

    const data = await searchRes.json();
    const raw = data.results || [];

    // Return top 5 results with enough info for the user to pick
    const results = raw.slice(0, 5).map(r => ({
      title: r.title || '',
      year: r.year || '',
      label: (r.label || [])[0] || '',
      image: (r.cover_image && !r.cover_image.includes('spacer')) ? r.cover_image : null,
      // community.have/want used to estimate price category
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
