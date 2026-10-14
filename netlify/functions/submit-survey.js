// netlify/functions/submit-survey.js
// Records the in-app beta survey response. One response per user —
// upserts so a double-submit (e.g. a slow network retry) can't error.

const { createClient } = require('@supabase/supabase-js');

const VALID_WOULD_PAY = ['yes', 'maybe', 'no'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const { usefulness, feedback, wouldPay } = JSON.parse(event.body || '{}');
  const usefulnessNum = Number(usefulness);
  if (!Number.isInteger(usefulnessNum) || usefulnessNum < 1 || usefulnessNum > 5) {
    return { statusCode: 400, body: JSON.stringify({ error: 'usefulness must be 1–5' }) };
  }
  if (!VALID_WOULD_PAY.includes(wouldPay)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid wouldPay value' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Invalid token');

    const { error } = await supabase.from('survey_responses').upsert({
      user_id: user.id,
      usefulness: usefulnessNum,
      feedback: feedback || null,
      would_pay: wouldPay,
    }, { onConflict: 'user_id' });
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('submit-survey error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
