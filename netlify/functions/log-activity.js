// netlify/functions/log-activity.js
// Logs individual question activity and increments the trial counter
// for unlicensed users. Returns remaining trial allowance so the UI
// can gate without a second round trip.

const { createClient } = require('@supabase/supabase-js');

const QUESTION_LIMIT = 20;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  const { questionId, manual, domain, correct } = JSON.parse(event.body || '{}');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }

    await supabase.from('study_activity').insert({
      user_id: user.id,
      question_id: questionId || null,
      manual: manual || null,
      domain: domain || null,
      correct: !!correct,
    });

    // Licensed users need no counting
    const now = new Date().toISOString();
    const { data: license } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now)
      .limit(1)
      .single();

    if (license) {
      return { statusCode: 200, body: JSON.stringify({ success: true, licensed: true }) };
    }

    // Trial user — increment and report what's left
    const { data: profile } = await supabase
      .from('profiles')
      .select('trial_questions_used')
      .eq('id', user.id)
      .single();

    const used = (profile?.trial_questions_used || 0) + 1;

    await supabase
      .from('profiles')
      .update({ trial_questions_used: used })
      .eq('id', user.id);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        licensed: false,
        trial: {
          questionsUsed: used,
          questionsLimit: QUESTION_LIMIT,
          questionsRemaining: Math.max(0, QUESTION_LIMIT - used),
          exhausted: used >= QUESTION_LIMIT,
        },
      }),
    };

  } catch (err) {
    console.error('log-activity error:', err);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, error: err.message }) };
  }
};
