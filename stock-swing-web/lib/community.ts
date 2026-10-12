import { supabaseAdmin } from './supabaseServer';

export const COMMUNITY_FEATURE = 'community';
export const STOCK_SWING_FEATURE = 'stock_swing_tool';

export async function hasFeatureEntitlement(userId: string, featureKey: string) {
  const result = await supabaseAdmin()
    .from('feature_entitlements')
    .select('enabled')
    .eq('user_id', userId)
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (result.error) throw new Error(`利用権限を確認できません: ${result.error.message}`);
  return result.data?.enabled === true;
}

export async function getFeatureEntitlements(userId: string) {
  const result = await supabaseAdmin()
    .from('feature_entitlements')
    .select('feature_key,enabled,reason,updated_at')
    .eq('user_id', userId);
  if (result.error) throw new Error(`利用権限を読み込めません: ${result.error.message}`);
  return new Map((result.data || []).map((row) => [row.feature_key, row]));
}
