// netlify/functions/flag-question.js
// Records "Flag this question" feedback from a logged-in user.

const { createClient } = require('@supabase/supabase-js');

const VALID_REASONS = ['Wrong answer', 'Unclear wording', 'Outdated', 'Too easy', 'Other'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const authHeader = event.headers['authorization'];
  if (!authHeader) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  const { questionId, reason, comment } = JSON.parse(event.body || '{}');
  if (!questionId || !reason) {
    return { statusCode: 400, body: JSON.stringify({ error: 'questionId and reason required' }) };
  }
  if (!VALID_REASONS.includes(reason)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid reason' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Invalid token');

    const { error } = await supabase.from('question_flags').insert({
      user_id: user.id,
      question_id: String(questionId),
      reason,
      comment: comment || null,
    });
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('flag-question error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
