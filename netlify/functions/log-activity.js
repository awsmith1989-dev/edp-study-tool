// netlify/functions/log-activity.js
// Logs individual question activity for per-user analytics

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    // Not logged in (trial user) — silently skip, no error
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  const { questionId, manual, correct } = JSON.parse(event.body || '{}');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      // Invalid token — skip silently, don't block the UI
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    await supabase.from('study_activity').insert({
      user_id: user.id,
      question_id: questionId || null,
      manual: manual || null,
      correct: !!correct,
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('log-activity error:', err);
    // Non-fatal — never block the study flow over a logging failure
    return { statusCode: 200, body: JSON.stringify({ skipped: true, error: err.message }) };
  }
};
