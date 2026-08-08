import { createHash } from 'crypto';
import { headers } from 'next/headers';
import { supabaseAdmin } from './supabaseServer';

export type PocAccessResult = 'success' | 'missing_param' | 'invalid_user' | 'invalid_key' | 'inactive_user' | 'error';

type ValidatePocAccessInput = {
  pathUserId: string;
  queryUser?: string | string[];
  queryKey?: string | string[];
  path: string;
};

type ValidatePocAccessOutput = {
  allowed: boolean;
  result: PocAccessResult;
  userCode: string | null;
};

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashIp(ipAddress: string | null) {
  if (!ipAddress) return null;
  const salt = process.env.POC_IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return sha256(`${salt}:${ipAddress}`);
}

async function writePocAccessLog(userCode: string | null, path: string, result: PocAccessResult) {
  try {
    const h = await headers();
    const userAgent = h.get('user-agent') || null;
    const ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
    const supabase = supabaseAdmin();

    await supabase.from('poc_access_logs').insert({
      user_code: userCode,
      path,
      result,
      user_agent: userAgent,
      ip_hash: hashIp(ipAddress),
      accessed_at: new Date().toISOString(),
    });
  } catch (_) {
    // Access logging must not make the dashboard unavailable.
  }
}

export async function validatePocAccess(input: ValidatePocAccessInput): Promise<ValidatePocAccessOutput> {
  const queryUser = firstParam(input.queryUser);
  const queryKey = firstParam(input.queryKey);
  const userCode = queryUser || null;

  let result: PocAccessResult = 'error';
  let allowed = false;

  try {
    if (!queryUser || !queryKey) {
      result = 'missing_param';
      return { allowed, result, userCode };
    }

    const supabase = supabaseAdmin();
    const user = await supabase
      .from('poc_users')
      .select('user_code,target_user_code,access_key_hash,is_active')
      .eq('user_code', queryUser)
      .eq('target_user_code', input.pathUserId)
      .maybeSingle();

    if (user.error) {
      result = 'error';
      return { allowed, result, userCode };
    }

    if (!user.data) {
      result = 'invalid_user';
      return { allowed, result, userCode };
    }

    if (user.data.is_active !== true) {
      result = 'inactive_user';
      return { allowed, result, userCode };
    }

    const providedHash = sha256(queryKey);
    if (!user.data.access_key_hash || user.data.access_key_hash !== providedHash) {
      result = 'invalid_key';
      return { allowed, result, userCode };
    }

    const update = await supabase
      .from('poc_users')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('user_code', queryUser)
      .eq('target_user_code', input.pathUserId);

    if (update.error) {
      result = 'error';
      return { allowed, result, userCode };
    }

    allowed = true;
    result = 'success';
    return { allowed, result, userCode };
  } catch (_) {
    result = 'error';
    return { allowed: false, result, userCode };
  } finally {
    await writePocAccessLog(userCode, input.path, result);
  }
}
