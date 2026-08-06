// netlify/functions/review-plan.js
// AI feedback on EDP project plan sections, graded against IEDC exemplar standards.

const { createClient } = require('@supabase/supabase-js');

const REVIEW_LIMIT = 1;
const TRIAL_SECTION = 'objective';   // only section a trial user may review

const RUBRIC = `You are an experienced IEDC assessor giving a candidate brief, practical feedback on their Entrepreneurship-Led Economic Development (ELED) Project Plan, which they submit with their EDP application and defend before a three-person oral exam panel.

YOUR MOST IMPORTANT CONSTRAINT: be brief and be conservative. Candidates revise this plan over weeks. Feedback that is long, highly prescriptive, or that chases an ideal sends them in circles rewriting work that was already good enough. Your job is to catch what would genuinely cost them in the oral exam, not to co-author the perfect plan.

HARD RULES:
- 120 to 160 words for a single section. 200 to 250 for a full-plan review. Do not exceed this.
- Name at most TWO improvements. If only one matters, name one. If the section is sound, say so and stop there.
- Frame improvements as observations or questions, not rewrites. Write "this objective describes an outcome that takes years to attribute, so is there a twelve-month version of it?" rather than "rewrite the objective as follows."
- NEVER speculate about the candidate's community, its demographics, its industries, its organizations, or its entrepreneurs. You do not know these things. If a section lacks specificity, say that naming specifics would strengthen it. Do not guess at what those specifics should be.
- End with one short sentence saying whether the section reads as ready to submit or is worth one more pass. Candidates need a stopping signal.
- Plain prose. No headers, no bullet lists, no bold, no numbered points.

WHAT STRONG PLANS DO, as your yardstick rather than something to recite back:
Objectives are bounded and describe something the candidate controls, often extending an existing asset rather than proposing an ecosystem from scratch. Partners, data sources, and resources are named specifically. Gaps are acknowledged honestly rather than papered over with invented funding. The same action steps recur across the funding table and timeline, so the sections cohere. Metrics are collectable now rather than lagging outcomes. Policy and advocacy appear, which most candidates omit. The EDO is positioned as convener and connector, not sole provider.

WHAT GOOD ENOUGH LOOKS LIKE:
A plan does not need to be exemplary to pass. It needs to be specific, internally coherent, and defensible under questioning. When a section clears that bar, say it is ready and stop. Do not manufacture improvements to appear thorough, because an unnecessary suggestion costs the candidate more time than it saves.`;

const SECTION_FOCUS = {
  objective: 'Review Section 1 (Objective) only. Is the objective bounded and within the candidate\'s control? Is the entrepreneur segment specific enough to design services around? Do the ten items read as executable steps rather than aspirations?',
  action_steps: 'Review Section 2 (Action Steps) only. Are partners named specifically rather than described generically? Does the resources column show real awareness of what is needed? Is the EDO positioned as connector rather than sole provider?',
  funding: 'Review Section 3 (Funding) only. Do the sources plausibly match each action step? Is the plan honest about what is currently funded versus aspirational? Note that repeating one real source across several steps is more credible than inventing variety.',
  metrics: 'Review Section 4 (Metrics) only. Do the metrics measure the stated objective? Is each data source named and realistically obtainable by this candidate? Favor metrics collectable now over lagging outcomes.',
  timeline: 'Review Section 5 (Timeline) only. Do early months front-load relationship building and quick wins? Are milestones written as outcomes rather than restated activities? Do the action items match those in Sections 2 and 3?',
  full: 'Review the ENTIRE plan, weighting coherence above all: do the action steps in Section 2 recur in Sections 3 and 5, and do the metrics in Section 4 measure the objective in Section 1? Then give one sentence on readiness for the oral exam. Name at most two improvements across the whole plan.',
};

function renderPlan(plan) {
  const o = plan.objective || {};
  const lines = [];

  lines.push('=== SECTION 1: OBJECTIVE ===');
  lines.push(`Objective: ${o.statement || '(blank)'}`);
  lines.push(`Entrepreneurs served: ${o.entrepreneur_types || '(blank)'}`);
  lines.push(`Reducing collaboration barriers: ${o.collaboration_barriers || '(blank)'}`);
  lines.push(`Ten things to move toward the goal:\n${o.ten_things || '(blank)'}`);

  lines.push('\n=== SECTION 2: ACTION STEPS ===');
  const steps = plan.action_steps || [];
  if (!steps.length) lines.push('(blank)');
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. Step: ${s.step || '(blank)'}`);
    lines.push(`   Partners: ${s.partners || '(blank)'}`);
    lines.push(`   Resources/info needed: ${s.resources || '(blank)'}`);
  });

  lines.push('\n=== SECTION 3: FUNDING ===');
  const funding = plan.funding || [];
  if (!funding.length) lines.push('(blank)');
  funding.forEach((f) => {
    lines.push(`- ${f.action_step || '(blank)'} → ${f.source || '(blank)'}`);
  });

  lines.push('\n=== SECTION 4: METRICS ===');
  const metrics = plan.metrics || [];
  if (!metrics.length) lines.push('(blank)');
  metrics.forEach((m) => {
    lines.push(`- ${m.metric || '(blank)'} | Data source: ${m.data_source || '(blank)'}`);
  });

  lines.push('\n=== SECTION 5: TIMELINE ===');
  const timeline = plan.timeline || [];
  if (!timeline.length) lines.push('(blank)');
  timeline.forEach((t) => {
    lines.push(`- [${t.milestone || '?'}] ${t.action_item || '(blank)'} → ${t.completion || '(blank)'}`);
  });

  return lines.join('\n');
}

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
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now)
      .limit(1)
      .single();

    const { section, plan } = JSON.parse(event.body || '{}');
    if (!plan) throw new Error('No plan data provided');

    // Trial users get one review, and only of the objective section
    let trialReview = false;
    if (!license) {
      if (section !== TRIAL_SECTION) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: `Free trial includes one review of the Objective section. Unlock full access to review all five sections.`,
            trialSection: TRIAL_SECTION,
          }),
        };
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('trial_reviews_used')
        .eq('id', user.id)
        .single();

      if ((profile?.trial_reviews_used || 0) >= REVIEW_LIMIT) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: 'You have used your free plan review. Unlock full access to review all five sections and export your plan.',
            exhausted: true,
          }),
        };
      }
      trialReview = true;
    }

    const focus = SECTION_FOCUS[section] || SECTION_FOCUS.full;

    const prompt = `${RUBRIC}

${focus}

Here is the candidate's plan:

${renderPlan(plan)}

Give your feedback now.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const text = data?.content?.find((b) => b.type === 'text')?.text || 'No feedback returned.';

    await supabase
      .from('project_plans')
      .update({ last_reviewed_at: new Date().toISOString() })
      .eq('user_id', user.id);

    if (trialReview) {
      const { data: p } = await supabase
        .from('profiles').select('trial_reviews_used').eq('id', user.id).single();
      await supabase
        .from('profiles')
        .update({ trial_reviews_used: (p?.trial_reviews_used || 0) + 1 })
        .eq('id', user.id);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: text }),
    };

  } catch (err) {
    console.error('review-plan error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
