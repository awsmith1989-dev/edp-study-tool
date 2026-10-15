// netlify/functions/admin-data.js
// Returns aggregated admin dashboard data. Protected by ADMIN_PASSWORD env var.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { password } = JSON.parse(event.body || '{}');

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid password' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // ── Users & licenses ──────────────────────────────────────
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const totalUsers = users.length;

    const now = new Date().toISOString();
    const { data: activeLicenses } = await supabase
      .from('licenses')
      .select('id, user_id, status, expires_at, stripe_session_id, auth_code, license_type, created_at')
      .eq('status', 'active')
      .gte('expires_at', now);

    const { data: allLicenses } = await supabase
      .from('licenses')
      .select('status');

    const licenseCounts = {
      active: (allLicenses || []).filter(l => l.status === 'active').length,
      revoked: (allLicenses || []).filter(l => l.status === 'revoked').length,
      total: (allLicenses || []).length,
    };

    const trialUsers = totalUsers - (activeLicenses?.length || 0);

    // Beta vs. paid vs. code, among currently-active licenses only
    const activeByType = { beta: 0, paid: 0, code: 0 };
    (activeLicenses || []).forEach(l => {
      const t = l.license_type || 'paid';
      if (activeByType[t] == null) activeByType[t] = 0;
      activeByType[t]++;
    });

    // ── Recent signups (last 20) ──────────────────────────────
    const recentSignups = users
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20)
      .map(u => ({
        email: u.email,
        created_at: u.created_at,
        first_name: u.user_metadata?.first_name || '',
        last_name: u.user_metadata?.last_name || '',
      }));

    // ── Code redemption ────────────────────────────────────────
    const { data: codes } = await supabase
      .from('auth_codes')
      .select('code, redeemed, redeemed_at, batch_label, expires_at');

    const codesByBatch = {};
    (codes || []).forEach(c => {
      const batch = c.batch_label || 'Unlabeled';
      if (!codesByBatch[batch]) codesByBatch[batch] = { total: 0, redeemed: 0 };
      codesByBatch[batch].total++;
      if (c.redeemed) codesByBatch[batch].redeemed++;
    });

    // ── Quiz scores & percentiles ──────────────────────────────
    const { data: quizScores } = await supabase
      .from('quiz_scores')
      .select('score, total, pct, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    const avgPct = quizScores?.length
      ? Math.round(quizScores.reduce((sum, q) => sum + q.pct, 0) / quizScores.length)
      : 0;

    // ── Study activity summary ─────────────────────────────────
    const { data: activitySample, count: totalAnswered } = await supabase
      .from('study_activity')
      .select('correct', { count: 'exact' });

    const totalCorrect = (activitySample || []).filter(a => a.correct).length;
    const overallAccuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    // ── Per-user activity summary (top 20 most active) ─────────
    const { data: allActivity } = await supabase
      .from('study_activity')
      .select('user_id, correct');

    const userActivityMap = {};
    (allActivity || []).forEach(a => {
      if (!userActivityMap[a.user_id]) userActivityMap[a.user_id] = { total: 0, correct: 0 };
      userActivityMap[a.user_id].total++;
      if (a.correct) userActivityMap[a.user_id].correct++;
    });

    const userInfoMap = {};
    users.forEach(u => {
      const name = [u.user_metadata?.first_name, u.user_metadata?.last_name].filter(Boolean).join(' ');
      userInfoMap[u.id] = { email: u.email, name: name || null };
    });

    const topUsers = Object.entries(userActivityMap)
      .map(([userId, stats]) => ({
        email: userInfoMap[userId]?.email || 'Unknown',
        questionsAnswered: stats.total,
        accuracy: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0,
      }))
      .sort((a, b) => b.questionsAnswered - a.questionsAnswered)
      .slice(0, 20);

    // ── Daily active users (last 14 days, named/emailed) ────────
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const { data: recentActivity } = await supabase
      .from('study_activity')
      .select('user_id, created_at')
      .gte('created_at', fourteenDaysAgo.toISOString());

    const dailyActiveUserIds = {};
    (recentActivity || []).forEach(a => {
      const day = new Date(a.created_at).toISOString().split('T')[0];
      if (!dailyActiveUserIds[day]) dailyActiveUserIds[day] = new Set();
      dailyActiveUserIds[day].add(a.user_id);
    });

    const dailyActiveUsers = {};
    Object.entries(dailyActiveUserIds).forEach(([day, idSet]) => {
      dailyActiveUsers[day] = Array.from(idSet)
        .map(id => userInfoMap[id] || { email: 'Unknown', name: null })
        .sort((a, b) => a.email.localeCompare(b.email));
    });

    const today = now.split('T')[0];
    const activeTodayCount = dailyActiveUsers[today]?.length || 0;

    // ── Page visits & conversion ────────────────────────────────
    // Conversion rate only counts signups since visit tracking began —
    // otherwise old signups (before tracking existed) skew the rate above 100%
    const { data: earliestVisit } = await supabase
      .from('page_visits')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    const trackingStart = earliestVisit?.created_at || new Date().toISOString();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // Use whichever is more recent: 30 days ago, or when tracking started
    const windowStart = new Date(trackingStart) > thirtyDaysAgo ? trackingStart : thirtyDaysAgo.toISOString();

    const { data: allVisits, count: totalVisits } = await supabase
      .from('page_visits')
      .select('session_id, created_at', { count: 'exact' })
      .gte('created_at', windowStart);

    const uniqueSessions = new Set((allVisits || []).map(v => v.session_id)).size;

    const usersInWindow = users.filter(u => new Date(u.created_at) >= new Date(windowStart)).length;
    const conversionRate = uniqueSessions ? Math.round((usersInWindow / uniqueSessions) * 1000) / 10 : null;

    // Daily visits for last 14 days (for simple trend display)
    const dailyVisits = {};
    (allVisits || []).forEach(v => {
      const day = new Date(v.created_at).toISOString().split('T')[0];
      dailyVisits[day] = (dailyVisits[day] || 0) + 1;
    });

    // ── Certification pathway breakdown ──────────────────────────
    const { data: profiles } = await supabase
      .from('profiles')
      .select('cert_pathway');

    const pathwayCounts = {};
    (profiles || []).forEach(p => {
      const key = p.cert_pathway || 'Not set';
      pathwayCounts[key] = (pathwayCounts[key] || 0) + 1;
    });

    // ── Question flags ────────────────────────────────────────────
    const { data: flags } = await supabase
      .from('question_flags')
      .select('question_id, user_id, reason, comment, created_at')
      .order('created_at', { ascending: false });

    const flagsByQuestion = {};
    (flags || []).forEach(f => {
      if (!flagsByQuestion[f.question_id]) flagsByQuestion[f.question_id] = [];
      flagsByQuestion[f.question_id].push({
        email: userInfoMap[f.user_id]?.email || 'Unknown',
        reason: f.reason,
        comment: f.comment,
        created_at: f.created_at,
      });
    });

    const questionFlags = Object.entries(flagsByQuestion)
      .map(([questionId, entries]) => ({ questionId, count: entries.length, entries }))
      .sort((a, b) => b.count - a.count);

    // ── Survey results ────────────────────────────────────────────
    const { data: surveyResponses } = await supabase
      .from('survey_responses')
      .select('user_id, usefulness, feedback, would_pay, created_at')
      .order('created_at', { ascending: false });

    const avgUsefulness = surveyResponses?.length
      ? Math.round((surveyResponses.reduce((sum, s) => sum + s.usefulness, 0) / surveyResponses.length) * 10) / 10
      : null;

    const wouldPayCounts = { yes: 0, maybe: 0, no: 0 };
    (surveyResponses || []).forEach(s => {
      if (wouldPayCounts[s.would_pay] != null) wouldPayCounts[s.would_pay]++;
    });

    const surveyFeedback = (surveyResponses || [])
      .filter(s => s.feedback)
      .map(s => ({
        email: userInfoMap[s.user_id]?.email || 'Unknown',
        usefulness: s.usefulness,
        wouldPay: s.would_pay,
        feedback: s.feedback,
        created_at: s.created_at,
      }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: {
          total: totalUsers,
          licensed: activeLicenses?.length || 0,
          trial: trialUsers,
        },
        licenses: { ...licenseCounts, activeByType },
        recentSignups,
        codes: {
          byBatch: codesByBatch,
          totalCodes: codes?.length || 0,
          totalRedeemed: (codes || []).filter(c => c.redeemed).length,
        },
        quizzes: {
          total: quizScores?.length || 0,
          avgPct,
          recent: (quizScores || []).slice(0, 10),
        },
        studyActivity: {
          totalAnswered: totalAnswered || 0,
          overallAccuracy,
          topUsers,
        },
        engagement: {
          activeTodayCount,
          dailyActiveUsers,
        },
        traffic: {
          totalVisits30d: totalVisits || 0,
          uniqueSessions30d: uniqueSessions,
          newSignups30d: usersInWindow,
          conversionRate,
          dailyVisits,
          trackingStart,
        },
        pathways: pathwayCounts,
        questionFlags,
        survey: {
          total: surveyResponses?.length || 0,
          avgUsefulness,
          wouldPayCounts,
          feedback: surveyFeedback,
        },
      }),
    };

  } catch (err) {
    console.error('admin-data error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
