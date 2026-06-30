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
      .select('id, user_id, status, expires_at, stripe_session_id, auth_code, created_at')
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

    const userEmailMap = {};
    users.forEach(u => { userEmailMap[u.id] = u.email; });

    const topUsers = Object.entries(userActivityMap)
      .map(([userId, stats]) => ({
        email: userEmailMap[userId] || 'Unknown',
        questionsAnswered: stats.total,
        accuracy: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0,
      }))
      .sort((a, b) => b.questionsAnswered - a.questionsAnswered)
      .slice(0, 20);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: {
          total: totalUsers,
          licensed: activeLicenses?.length || 0,
          trial: trialUsers,
        },
        licenses: licenseCounts,
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
