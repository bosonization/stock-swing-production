import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

function adminUrl(req: Request, message: string, kind: 'message' | 'error' = 'message') {
  const url = new URL('/admin/community', req.url);
  url.searchParams.set(kind, message);
  return url;
}

function jstLocalToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function POST(req: Request) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);
  if (actor.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const form = await req.formData();
  const action = String(form.get('action') || '');
  const supabase = supabaseAdmin();

  if (action === 'announcement') {
    const title = String(form.get('title') || '').trim();
    const body = String(form.get('body') || '').trim();
    const status = String(form.get('status') || 'draft');
    if (title.length < 3 || title.length > 160 || !body || body.length > 10000 || !['draft', 'published'].includes(status)) return NextResponse.redirect(adminUrl(req, 'お知らせの入力内容を確認してください。', 'error'), 303);
    const saved = await supabase.from('announcements').insert({ slug: `notice-${Date.now()}-${randomUUID().slice(0, 8)}`, title, body, status, published_at: status === 'published' ? new Date().toISOString() : null, created_by: actor.auth_user_id });
    if (saved.error) return NextResponse.redirect(adminUrl(req, `保存できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ actor_id: actor.auth_user_id, event_type: 'community.announcement_created', event_version: 'community_v1', payload: { title, status } });
    return NextResponse.redirect(adminUrl(req, status === 'published' ? '公式のお知らせを公開しました。' : 'お知らせを下書き保存しました。'), 303);
  }

  if (action === 'lesson') {
    const title = String(form.get('title') || '').trim();
    const summary = String(form.get('summary') || '').trim();
    const body = String(form.get('body') || '').trim();
    const status = String(form.get('status') || 'draft');
    const sortOrder = Number(form.get('sortOrder') || 100);
    if (title.length < 3 || title.length > 160 || summary.length > 500 || !body || body.length > 30000 || !['draft', 'published'].includes(status) || !Number.isInteger(sortOrder)) return NextResponse.redirect(adminUrl(req, '教材の入力内容を確認してください。', 'error'), 303);
    const saved = await supabase.from('lessons').insert({ slug: `lesson-${Date.now()}-${randomUUID().slice(0, 8)}`, title, summary, body, status, sort_order: sortOrder, published_at: status === 'published' ? new Date().toISOString() : null, created_by: actor.auth_user_id });
    if (saved.error) return NextResponse.redirect(adminUrl(req, `保存できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ actor_id: actor.auth_user_id, event_type: 'community.lesson_created', event_version: 'community_v1', payload: { title, status } });
    return NextResponse.redirect(adminUrl(req, status === 'published' ? '教材を公開しました。' : '教材を下書き保存しました。'), 303);
  }

  if (action === 'event') {
    const title = String(form.get('title') || '').trim();
    const description = String(form.get('description') || '').trim();
    const startsAt = jstLocalToIso(String(form.get('startsAt') || ''));
    const endsRaw = String(form.get('endsAt') || '');
    const endsAt = endsRaw ? jstLocalToIso(endsRaw) : null;
    const meetingUrl = String(form.get('meetingUrl') || '').trim();
    const status = String(form.get('status') || 'draft');
    const urlValid = !meetingUrl || /^https:\/\//i.test(meetingUrl);
    if (title.length < 3 || title.length > 160 || description.length > 5000 || !startsAt || (endsRaw && !endsAt) || (endsAt && endsAt <= startsAt) || !urlValid || !['draft', 'published'].includes(status)) return NextResponse.redirect(adminUrl(req, 'イベントの日時・URL・入力内容を確認してください。', 'error'), 303);
    const saved = await supabase.from('community_events').insert({ title, description, starts_at: startsAt, ends_at: endsAt, meeting_url: meetingUrl || null, status, created_by: actor.auth_user_id });
    if (saved.error) return NextResponse.redirect(adminUrl(req, `保存できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ actor_id: actor.auth_user_id, event_type: 'community.event_created', event_version: 'community_v1', payload: { title, status, starts_at: startsAt } });
    return NextResponse.redirect(adminUrl(req, status === 'published' ? 'イベントを公開しました。' : 'イベントを下書き保存しました。'), 303);
  }

  if (action === 'content_status') {
    const kind = String(form.get('kind') || '');
    const contentId = String(form.get('contentId') || '');
    const status = String(form.get('status') || '');
    const rules: Record<string, { table: 'announcements' | 'lessons' | 'community_events'; statuses: string[] }> = {
      announcement: { table: 'announcements', statuses: ['published', 'archived'] },
      lesson: { table: 'lessons', statuses: ['published', 'archived'] },
      event: { table: 'community_events', statuses: ['published', 'cancelled'] },
    };
    const rule = rules[kind];
    if (!contentId || !rule || !rule.statuses.includes(status)) return NextResponse.redirect(adminUrl(req, '公開状態の指定を確認してください。', 'error'), 303);
    const updates: Record<string, any> = { status };
    if (status === 'published' && kind !== 'event') updates.published_at = new Date().toISOString();
    const saved = await supabase.from(rule.table).update(updates).eq('id', contentId).select('id,title').single();
    if (saved.error) return NextResponse.redirect(adminUrl(req, `公開状態を更新できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ actor_id: actor.auth_user_id, event_type: 'community.content_status_changed', event_version: 'community_v1', payload: { kind, content_id: contentId, title: saved.data.title, status } });
    return NextResponse.redirect(adminUrl(req, `「${saved.data.title}」の状態を更新しました。`), 303);
  }

  if (action === 'ticket') {
    const ticketId = String(form.get('ticketId') || '');
    const status = String(form.get('status') || '');
    if (!ticketId || !['open', 'in_progress', 'resolved', 'closed'].includes(status)) return NextResponse.redirect(adminUrl(req, '問い合わせの更新内容を確認してください。', 'error'), 303);
    const saved = await supabase.from('support_tickets').update({ status, assigned_to: actor.auth_user_id, resolved_at: ['resolved', 'closed'].includes(status) ? new Date().toISOString() : null }).eq('id', ticketId).select('user_id,subject').single();
    if (saved.error) return NextResponse.redirect(adminUrl(req, `更新できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ user_id: saved.data.user_id, actor_id: actor.auth_user_id, event_type: 'community.support_status_changed', event_version: 'community_v1', payload: { ticket_id: ticketId, subject: saved.data.subject, status } });
    return NextResponse.redirect(adminUrl(req, '問い合わせの対応状況を更新しました。'), 303);
  }

  if (action === 'role') {
    const userId = String(form.get('userId') || '').trim();
    const role = String(form.get('role') || '');
    if (!userId || !['business_owner', 'technical_admin', 'community_manager', 'instructor', 'member'].includes(role)) return NextResponse.redirect(adminUrl(req, '担当者と役割を確認してください。', 'error'), 303);
    const saved = await supabase.from('role_assignments').upsert({ user_id: userId, role, is_active: true, granted_by: actor.auth_user_id }, { onConflict: 'user_id,role' });
    if (saved.error) return NextResponse.redirect(adminUrl(req, `役割を保存できませんでした: ${saved.error.message}`, 'error'), 303);
    await supabase.from('app_event_logs').insert({ user_id: userId, actor_id: actor.auth_user_id, event_type: 'community.role_assigned', event_version: 'community_v1', payload: { role } });
    return NextResponse.redirect(adminUrl(req, '担当役割を記録しました。'), 303);
  }

  return NextResponse.redirect(adminUrl(req, '操作内容を確認してください。', 'error'), 303);
}
