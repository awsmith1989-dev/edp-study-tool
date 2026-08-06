// netlify/functions/claude.js
// Proxies AI explanation requests to Anthropic.
// Requires authentication. Licensed users are unlimited; trial users are
// capped by the same 20-question allowance tracked on their profile.

const { createClient } = require('@supabase/supabase-js');

const QUESTION_LIMIT = 20;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { message: 'Sign in to use AI explanations.' } }),
    };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'Your session expired. Sign in again.' } }),
      };
    }

    // Licensed users pass straight through
    const now = new Date().toISOString();
    const { data: license } = await supabase
      .from('licenses')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now)
      .limit(1)
      .single();

    if (!license) {
      // Trial user — check they still have questions left
      const { data: profile } = await supabase
        .from('profiles')
        .select('trial_questions_used')
        .eq('id', user.id)
        .single();

      if ((profile?.trial_questions_used || 0) >= QUESTION_LIMIT) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: { message: 'Your free trial is complete. Unlock full access to keep using AI explanations.' },
          }),
        };
      }
    }

    const body = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error('claude proxy error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
