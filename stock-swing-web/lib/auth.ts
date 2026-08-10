import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from './supabaseServer';

export const ACCESS_COOKIE = 'stock_swing_access_token';
export const REFRESH_COOKIE = 'stock_swing_refresh_token';

export async function currentAppUser() {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const supabase = supabaseAdmin();
  const auth = await supabase.auth.getUser(token);
  if (auth.error || !auth.data.user) return null;
  const appUser = await supabase
    .from('app_users')
    .select('id,auth_user_id,display_name,email,plan,role,status,max_watchlist_count')
    .eq('auth_user_id', auth.data.user.id)
    .eq('status', 'active')
    .single();
  return appUser.error ? null : appUser.data;
}

export async function requireAppUser() {
  const user = await currentAppUser();
  if (!user) redirect('/?error=login_required');
  return user;
}

export async function authorizeUserId(userId: string) {
  const user = await requireAppUser();
  if (user.id !== userId && user.role !== 'admin') redirect(`/u/${encodeURIComponent(user.id)}`);
  return user;
}

export async function apiAppUser() {
  return currentAppUser();
}
