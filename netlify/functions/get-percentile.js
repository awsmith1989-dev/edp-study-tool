exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { score } = JSON.parse(event.body);

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    const headers = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'count=exact',
      'Range': '0-0'
    };

    // Run both counts in parallel
    const [totalRes, atOrBelowRes] = await Promise.all([
      fetch(`${url}/rest/v1/quiz_scores?select=id`, { headers }),
      fetch(`${url}/rest/v1/quiz_scores?select=id&score=lte.${score}`, { headers })
    ]);

    // PostgREST returns the total count in Content-Range: 0-0/TOTAL
    function parseCount(res) {
      const cr = res.headers.get('content-range');
      if (!cr) return 0;
      const match = cr.match(/\/(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    }

    const total = parseCount(totalRes);
    const atOrBelow = parseCount(atOrBelowRes);

    // Percentile: what share of scores are <= yours
    const percentile = total > 0 ? Math.round((atOrBelow / total) * 100) : 50;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percentile, total, atOrBelow, score })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
