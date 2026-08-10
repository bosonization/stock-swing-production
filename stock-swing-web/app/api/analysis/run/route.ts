import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { apiAppUser } from '../../../../lib/auth';

function normalizeKey(raw: unknown) {
  return String(raw ?? '').trim();
}

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const userId = String(body.userId || '').trim();
  const actor = await apiAppUser();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!userId || (actor.id !== userId && actor.role !== 'admin')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const supabase = supabaseAdmin();
  const user = await supabase
    .from('app_users')
    .select('id,status')
    .eq('id', userId)
    .single();

  if (user.error || !user.data) {
    return NextResponse.json({ error: `user not found: ${userId}` }, { status: 404 });
  }
  if (user.data.status !== 'active') {
    return NextResponse.json({ error: `user is not active: ${userId}` }, { status: 403 });
  }

  const token = process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_TOKEN_FOR_DISPATCH;
  const owner = process.env.GITHUB_OWNER || 'swing-tech-service';
  const repo = process.env.GITHUB_CORE_REPO || 'stock-swing-core';
  const workflow = process.env.GITHUB_WORKFLOW_ID || 'run_daily.yml';
  const ref = process.env.GITHUB_REF || 'main';

  if (!token) {
    return NextResponse.json({ error: 'GITHUB_ACTIONS_TOKEN is not configured in Vercel' }, { status: 500 });
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const payload = { ref, inputs: { user_id: userId } };

  const gh = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'stock-swing-web',
    },
    body: JSON.stringify(payload),
  });

  if (!gh.ok) {
    const text = await gh.text();
    return NextResponse.json({
      error: `GitHub Actions dispatch failed: ${gh.status} ${text}`,
      request: { owner, repo, workflow, ref, userId },
    }, { status: 500 });
  }

  await supabase.from('app_event_logs').insert({ user_id: userId, actor_id: actor.auth_user_id, event_type: 'condition_analysis_requested', event_version: 'production_v1', payload: { owner, repo, workflow, ref }, created_at: new Date().toISOString() }).then(() => null);

  return NextResponse.json({
    ok: true,
    message: `${userId} の条件判定更新を開始しました。GitHub Actions完了後に銘柄整理画面へ反映されます。`,
    actionsUrl: `https://github.com/${owner}/${repo}/actions`,
    request: { owner, repo, workflow, ref, userId },
  });
}
