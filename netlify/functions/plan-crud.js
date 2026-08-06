// netlify/functions/plan-crud.js
// Save and load project plan drafts. Any authenticated user, trial or
// licensed — review-plan.js and the frontend gate what a trial user can
// do with the draft, not this endpoint.

const { createClient } = require('@supabase/supabase-js');

const EMPTY_PLAN = {
  candidate_name: '',
  objective: { statement: '', entrepreneur_types: '', collaboration_barriers: '', ten_things: '' },
  action_steps: [],
  funding: [],
  metrics: [],
  timeline: [],
};

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

    const { action, plan } = JSON.parse(event.body || '{}');

    // ── Load ───────────────────────────────────────────────────
    if (action === 'load') {
      const { data: existing } = await supabase
        .from('project_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (!existing) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: EMPTY_PLAN, isNew: true }),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: {
            candidate_name: existing.candidate_name || '',
            objective: existing.objective || EMPTY_PLAN.objective,
            action_steps: existing.action_steps || [],
            funding: existing.funding || [],
            metrics: existing.metrics || [],
            timeline: existing.timeline || [],
          },
          updatedAt: existing.updated_at,
          isNew: false,
        }),
      };
    }

    // ── Save ───────────────────────────────────────────────────
    if (action === 'save') {
      if (!plan) throw new Error('No plan data provided');

      const row = {
        user_id: user.id,
        candidate_name: plan.candidate_name || '',
        objective: plan.objective || {},
        action_steps: plan.action_steps || [],
        funding: plan.funding || [],
        metrics: plan.metrics || [],
        timeline: plan.timeline || [],
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('project_plans')
        .select('id')
        .eq('user_id', user.id)
        .limit(1)
        .single();

      if (existing) {
        const { error } = await supabase
          .from('project_plans')
          .update(row)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_plans').insert(row);
        if (error) throw error;
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, savedAt: row.updated_at }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('plan-crud error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
