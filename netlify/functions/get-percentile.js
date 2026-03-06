exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pct } = JSON.parse(event.body);

    if (typeof pct !== 'number') {
      return { statusCode: 400, body: JSON.stringify({ error: 'pct required' }) };
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    const headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'count=exact',
      'Range': '0-0'
    };

    // Run both counts in parallel: total rows, and rows where pct <= user's pct
    const [totalRes, atOrBelowRes] = await Promise.all([
      fetch(`${url}/rest/v1/quiz_scores?select=id`, { headers }),
      fetch(`${url}/rest/v1/quiz_scores?select=id&pct=lte.${pct}`, { headers })
    ]);

    function parseCount(res) {
      const cr = res.headers.get('content-range');
      if (!cr) return 0;
      const match = cr.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    const total = parseCount(totalRes);
    const atOrBelow = parseCount(atOrBelowRes);
    const percentile = total > 0 ? Math.round((atOrBelow / total) * 100) : 50;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percentile, total, atOrBelow, pct })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
