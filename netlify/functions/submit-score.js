exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { score, total, pct, manual_filter } = JSON.parse(event.body);

    if (
      typeof score !== 'number' || !Number.isInteger(score) || score < 0 ||
      typeof total !== 'number' || !Number.isInteger(total) || total < 1 ||
      score > total
    ) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid score or total' }) };
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    const res = await fetch(`${url}/rest/v1/quiz_scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        score,
        total,
        pct: pct ?? Math.round((score / total) * 100),
        manual_filter: manual_filter ?? null
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase ${res.status}: ${text}`);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
