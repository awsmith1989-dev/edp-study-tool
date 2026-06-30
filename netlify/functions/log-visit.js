// netlify/functions/log-visit.js
// Logs anonymous page visits for conversion tracking

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { page, sessionId } = JSON.parse(event.body || '{}');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    await supabase.from('page_visits').insert({
      page: page || '/',
      session_id: sessionId || null,
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('log-visit error:', err);
    // Non-fatal — never block page load over a logging failure
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }
};
