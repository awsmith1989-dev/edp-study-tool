// netlify/functions/log-activity.js
// Logs individual question activity and increments the trial counter
// for unlicensed users. Returns remaining trial allowance so the UI
// can gate without a second round trip. Also checks whether this is
// the moment to offer the in-app beta survey.

const { createClient } = require('@supabase/supabase-js');

const QUESTION_LIMIT = 20;
const SURVEY_INTERVAL = 25;   // offer after the 25th, then the 50th, question
const SURVEY_MAX_OFFERS = 2;  // never offer a third time

// Decides whether to surface the survey on this answer. An "offer" is
// counted the moment we decide to show it — whether the user goes on to
// submit it or dismiss it — which is what caps this at two tries total.
async function checkSurveyTrigger(supabase, userId) {
  const { data: existingResponse } = await supabase
    .from('survey_responses')
    .select('id')
    .eq('user_id', userId)
    .single();
  if (existingResponse) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('survey_offers_shown')
    .eq('id', userId)
    .single();
  const offersShown = profile?.survey_offers_shown || 0;
  if (offersShown >= SURVEY_MAX_OFFERS) return false;

  const { count: totalAnswered } = await supabase
    .from('study_activity')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  const nextThreshold = SURVEY_INTERVAL * (offersShown + 1);
  if ((totalAnswered || 0) < nextThreshold) return false;

  await supabase
    .from('profiles')
    .update({ survey_offers_shown: offersShown + 1 })
    .eq('id', userId);

  return true;
}

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

    const showSurvey = await checkSurveyTrigger(supabase, user.id);

    // Licensed users (paid, code, or beta) need no counting
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
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, licensed: true, survey: { shouldShow: showSurvey } }),
      };
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
        survey: { shouldShow: showSurvey },
      }),
    };

  } catch (err) {
    console.error('log-activity error:', err);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, error: err.message }) };
  }
};
