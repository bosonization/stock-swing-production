import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

const FORBIDDEN_TAG_WORDS = ['損切り', '利確', '目標株価', 'エントリー', '推奨', '買い候補', '急騰候補', '有望株'];
const FORBIDDEN_METRIC_KEYS = new Set(['stop_loss_reference', 'stop_loss_distance_pct', 'take_profit_20pct', 'rr_stop_candidate', 'rr_target_candidate', 'rr2_entry_price', 'target_price']);

function sanitizeRow(row: any) {
  const metrics: Record<string, any> = { ...(row.metrics || {}) };
  for (const key of Object.keys(metrics)) {
    if (FORBIDDEN_METRIC_KEYS.has(key) || key.includes('stop_loss') || key.includes('take_profit') || key.includes('target_price') || key.startsWith('rr_')) {
      delete metrics[key];
    }
  }
  const tags = Array.isArray(row.tags) ? row.tags.filter((t: any) => !FORBIDDEN_TAG_WORDS.some((w) => String(t).includes(w))) : row.tags;
  return { ...row, tags, metrics };
}


export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const supabase = supabaseAdmin();

  const runs = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1);

  if (runs.error) return NextResponse.json({ error: runs.error.message }, { status: 500 });
  const run = runs.data?.[0] ?? null;
  if (!run) return NextResponse.json({ run: null, rows: [] });

  const results = await supabase
    .from('analysis_results')
    .select('*')
    .eq('run_id', run.id);

  if (results.error) return NextResponse.json({ error: results.error.message }, { status: 500 });

  const rows = (results.data ?? []).sort((a: any, b: any) => {
    const as = typeof a.score === 'number' && Number.isFinite(a.score) ? a.score : null;
    const bs = typeof b.score === 'number' && Number.isFinite(b.score) ? b.score : null;
    if (as === null && bs === null) return String(a.code).localeCompare(String(b.code), 'ja');
    if (as === null) return 1;
    if (bs === null) return -1;
    if (bs !== as) return bs - as;
    return String(a.code).localeCompare(String(b.code), 'ja');
  });

  return NextResponse.json({ run, rows: rows.map(sanitizeRow) });
}
