// netlify/functions/review-plan.js
// AI feedback on EDP project plan sections, graded against IEDC exemplar standards.

const { createClient } = require('@supabase/supabase-js');

const RUBRIC = `You are an experienced IEDC assessor reviewing a candidate's Entrepreneurship-Led Economic Development (ELED) Project Plan. This plan is submitted with the EDP certification application and forms the basis of the oral exam.

WHAT STRONG PLANS DO (drawn from the exemplar IEDC circulates as a model):

1. SCOPE TO SOMETHING REAL. The strongest objectives extend an existing asset or close a specific named gap — not "build an entrepreneurship ecosystem." The model plan's objective was simply "Grow and expand WVBusinessLink.com by connecting entrepreneurs to resources." Bounded, concrete, already in motion.

2. NAME THINGS. Strong plans name partners (specific organizations, not "stakeholders"), cite real numbers ("160+ resource partners"), and identify actual data sources the candidate can access (SourceLink, Google Analytics). Vagueness is the most common weakness.

3. BE HONEST ABOUT GAPS. The model plan writes "TBD" for an unresolved partner and "Already completed. Ongoing development." on the timeline. Honest acknowledgment reads as competence. Inventing diversified funding streams that don't exist reads as naive.

4. THREAD THE SECTIONS TOGETHER. The same action steps should recur in the funding table and the timeline. Incoherence between sections — metrics that don't measure the stated objective, funding that doesn't map to the action steps — is the single biggest differentiator between strong and weak plans.

5. USE COLLECTABLE, PROCESS-ORIENTED METRICS. Referrals, users, engagement by segment. Not "jobs created" alone, which takes years to manifest and is hard to attribute. Every metric needs a named, plausible data source.

6. INCLUDE POLICY AND ADVOCACY. ELED treats policy engagement as ecosystem infrastructure. Most candidates skip it entirely. Its presence is a mark of sophistication.

7. REFLECT ELED PRINCIPLES. The EDO is a connector and convener, not the sole service provider. Asset mapping precedes building new programs. Ecosystems take 10–20 years while the plan shows credible 12-month progress. Inclusion is designed in, not bolted on.

HOW TO GIVE FEEDBACK:
- Lead with what is genuinely working. Be specific about why.
- Then name the highest-leverage improvements — at most three, ordered by impact.
- Be concrete. Instead of "add more detail," say "the Technology Integration step lists partners as TBD; naming even one candidate partner would strengthen this."
- Where the plan falls short of the exemplar standard, say so directly but constructively.
- Do not invent facts about the candidate's community.
- Write in plain prose. No bullet lists unless comparing parallel items. No headers.
- 150-250 words for a single section. 300-400 words for a full plan review.`;

const SECTION_FOCUS = {
  objective: 'Focus on Section 1 (Objective). Assess whether the objective is bounded and concrete, whether the entrepreneur segments named are specific enough to design services around, whether the collaboration-barrier response reflects real tactics rather than aspiration, and whether the ten action items are specific and executable.',
  action_steps: 'Focus on Section 2 (Action Steps). Assess whether the selected steps are the highest-leverage subset of the ten, whether partners are named specifically, whether the resources column shows real awareness of what is needed, and whether the EDO is positioned as connector rather than sole provider.',
  funding: 'Focus on Section 3 (Funding). Assess whether funding sources realistically match each action step, whether the plan is honest about current funding versus aspirational sources, whether there is any thinking about diversification or runway, and whether the funding sources named actually fund this type of work.',
  metrics: 'Focus on Section 4 (Metrics). Assess whether metrics actually measure the stated objective, whether they include process metrics and not just long-horizon outputs, whether each data source is named and genuinely obtainable, and whether the candidate could realistically collect this data.',
  timeline: 'Focus on Section 5 (Timeline). Assess whether early months front-load relationship building and quick wins, whether milestones are outcomes rather than restated activities, whether the pacing is realistic, and whether the action items match those in Sections 2 and 3.',
  full: 'Review the ENTIRE plan. Weight coherence heavily: do the action steps in Section 2 recur in Sections 3 and 5? Do the metrics in Section 4 actually measure the objective in Section 1? Also assess overall readiness for the oral exam — could this candidate defend every element of this plan under questioning?',
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

    if (!license) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'An active license is required for plan review.' }),
      };
    }

    const { section, plan } = JSON.parse(event.body || '{}');
    if (!plan) throw new Error('No plan data provided');

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
        max_tokens: 1200,
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
