// netlify/functions/trial-status.js
// Returns license state and remaining trial allowance for the current user.
// Trial usage is tracked on the profiles row, not in localStorage.

const { createClient } = require('@supabase/supabase-js');

const QUESTION_LIMIT = 20;
const REVIEW_LIMIT = 1;
const TRIAL_SECTION = 'objective';   // the only plan section a trial user may review

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Invalid token');

    const now = new Date().toISOString();
    const { data: license } = await supabase
      .from('licenses')
      .select('id, expires_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now)
      .order('expires_at', { ascending: false })
      .limit(1)
      .single();

    if (license) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licensed: true, license }),
      };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('trial_questions_used, trial_reviews_used')
      .eq('id', user.id)
      .single();

    const qUsed = profile?.trial_questions_used || 0;
    const rUsed = profile?.trial_reviews_used || 0;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licensed: false,
        trial: {
          questionsUsed: qUsed,
          questionsLimit: QUESTION_LIMIT,
          questionsRemaining: Math.max(0, QUESTION_LIMIT - qUsed),
          reviewsUsed: rUsed,
          reviewsLimit: REVIEW_LIMIT,
          reviewsRemaining: Math.max(0, REVIEW_LIMIT - rUsed),
          allowedSection: TRIAL_SECTION,
        },
      }),
    };

  } catch (err) {
    console.error('trial-status error:', err);
    return { statusCode: 401, body: JSON.stringify({ error: err.message }) };
  }
};
