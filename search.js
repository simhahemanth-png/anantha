const rateLimit = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit: 10 requests per IP per hour
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const window = 60 * 60 * 1000;
  const limit = 10;

  if (!rateLimit.has(ip)) rateLimit.set(ip, []);
  const timestamps = rateLimit.get(ip).filter(t => now - t < window);
  if (timestamps.length >= limit) {
    return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });
  }
  timestamps.push(now);
  rateLimit.set(ip, timestamps);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server.' });

  try {
    const { query, prompt: customPrompt } = req.body;
    if (!query) return res.status(400).json({ error: 'No query provided.' });

    const prompt = customPrompt || `You are a deep expert on Indian history, archaeology, culture, and heritage. The user is asking about: "${query}" in India.

Return ONLY a JSON object (no markdown, no preamble, no backticks) with exactly this structure:

{
  "found": true,
  "name": "Official place name",
  "type": "City / Town / Village / Taluk",
  "state": "State name",
  "district": "District name",
  "region": "Geographical region",
  "icon_symbol": "one thematic emoji",
  "description": "3-sentence engaging cultural description of this place and its significance",
  "best_time": "Best months to visit and why",
  "food": ["local dish 1", "local dish 2", "local dish 3"],
  "famous_for": ["cultural item 1", "cultural item 2", "cultural item 3", "cultural item 4"],
  "connectivity": ["Nearest airport: X (~Ykm)", "Railway: station name", "Major highway: NH/SH number"],
  "nearby_major_cities": ["City A (~Xkm)", "City B (~Xkm)", "City C (~Xkm)"],
  "history": "2-3 sentence paragraph on historical importance — dynasties, inscriptions, ancient significance",
  "heritage_sites": [
    {
      "rank": 1,
      "name": "Site name",
      "distance_km": 0.5,
      "type": "Temple / Fort / Cave / Mosque / Church / Step-well / Ruins / Museum / Ghat / etc",
      "era": "e.g. Vijayanagara (14th-16th c.) / Mughal (17th c.) / etc",
      "description": "2 sentences describing the site's appearance and what makes it special",
      "cultural_significance": "1-2 sentences on why this site matters — ASI listing, UNESCO status, pilgrimage importance, historical events, artistic value etc.",
      "map_query": "exact google maps search string for this site"
    }
  ]
}

Up to 10 heritage_sites, sorted nearest (0km) to farthest (within ~40km of city centre). Only include sites with genuine cultural value documented on Wikipedia, ASI, or UNESCO. Do NOT invent sites.

If not in India: { "found": false, "name": "${query}" }`;

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: data.error?.message || 'API error' });

    const raw = data.content.map(i => i.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const info = JSON.parse(clean);
    return res.status(200).json(info);

  } catch (e) {
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
