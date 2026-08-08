import Link from 'next/link';
import { supabaseAdmin } from '../../../../../lib/supabaseServer';

type ResultRow = {
  id: string;
  code: string;
  name: string | null;
  score: number | null;
  condition_count: number | null;
  failed_star_numbers: string | null;
  tags: string[] | null;
  close: number | null;
  metrics: Record<string, any> | null;
  tag_reasons: Record<string, any> | null;
  kabutan_url: string | null;
};

type ConditionView = {
  no: string;
  title: string;
  star?: boolean;
  ok: boolean;
  criterion: string;
  actual: string;
  ng: string;
};

function fmt(value: any, suffix = '') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return '-';
  return `${value}${suffix}`;
}

function yn(v: any) {
  return v ? '一致' : '非一致';
}

function formatJst(value: any) {
  if (!value) return '未実行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date) + ' JST';
}

const ADMIN_USER_ID = 'takashimasaakiadmin';

const HIDDEN_TAGS = new Set([
  'TRADE READY', 'TRADEREADY', 'ボラOK', 'ボラ不足', 'ボラ判定不可',
  '出来高OK', '出来高強い', '出来高不足', '出来高判定不可',
]);

function visibleTags(row: ResultRow) {
  return Array.from(new Set((row.tags || [])
    .map((t) => t === 'BBスクイーズブレイク' ? 'BBブレイク' : t)
    .filter((t) => !HIDDEN_TAGS.has(t))));
}

async function getLatestResult(userId: string, code: string) {
  const supabase = supabaseAdmin();
  const runs = await supabase
    .from('analysis_runs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1);

  if (runs.error) throw new Error(runs.error.message);
  const run = runs.data?.[0] ?? null;
  if (!run) return { run: null, row: null as ResultRow | null };

  const result = await supabase
    .from('analysis_results')
    .select('*')
    .eq('run_id', run.id)
    .eq('code', code)
    .single();

  if (result.error) throw new Error(result.error.message);
  return { run, row: result.data as ResultRow };
}

function pt(m: Record<string, any>, key: string, fallback: number) {
  const p = m.score_points || {};
  return typeof p[key] === 'number' ? p[key] : fallback;
}

function buildConditions(metrics: Record<string, any> | null): ConditionView[] {
  const m = metrics || {};
  const c = m.conditions || {};
  const item = (no: string, key: string, title: string, criterion: string, actual: string, ng: string, fallbackPoint: number): ConditionView => ({
    no,
    title: `${title}（${pt(m, key, fallbackPoint)}点）`,
    ok: !!c[key],
    criterion,
    actual,
    ng,
  });
  return [
    item('①', 'c01', '日足終値 > 日足5MA', '終値 > 日足5MA', `終値 ${fmt(m.close)} / 5MA ${fmt(m.daily_sma5)}`, '終値が5MA以下です。', 1),
    item('②', 'c02', '日足5MAの傾きが0以上', '最新5MA - 前日5MA >= 0', `最新5MA ${fmt(m.daily_sma5)} / 前日5MA ${fmt(m.prev_daily_sma5)} / 差 ${fmt(m.daily_sma5_slope)}`, '5MAが前日比で下向きです。', 2),
    item('③', 'c03', '日足5MA > 日足25MA', '日足5MA > 日足25MA', `5MA ${fmt(m.daily_sma5)} / 25MA ${fmt(m.daily_sma25)}`, '5MAが25MA以下です。', 1),
    item('④', 'c04', '週足MAの上昇配列', '原則: 13週MA > 26週MA > 52週MA。52週MA未算出時は52週MAを対象外とし、13週MA > 26週MAで判定', `13MA ${fmt(m.weekly_sma13)} / 26MA ${fmt(m.weekly_sma26)} / 52MA ${fmt(m.weekly_sma52)} / 判定 ${fmt(m.weekly_ma_order_rule)} / 対象外 ${Array.isArray(m.weekly_ma_order_excluded) && m.weekly_ma_order_excluded.length ? m.weekly_ma_order_excluded.join('・') : '-'}`, '週足MAが上昇配列ではありません。', 2),
    item('⑤', 'c05', '週足13MAの傾きが0以上', '最新13週MA - 前週13週MA >= 0', `最新13MA ${fmt(m.weekly_sma13)} / 前週13MA ${fmt(m.prev_weekly_sma13)} / 差 ${fmt(m.weekly_sma13_slope)}`, '13週MAが前週比で下向きです。', 2),
    item('⑥', 'c06', '週足終値が13週MAから+10%以内', '週足終値 / 13週MA - 1 <= 10%', `週足終値 ${fmt(m.weekly_close)} / 13MA ${fmt(m.weekly_sma13)} / 乖離 ${fmt(m.weekly_sma13_gap_pct, '%')}`, '13週MAから上に離れすぎています。', 2),
    item('⑦', 'c07', '日足200MA割れペナルティ', '日足終値 < 日足200MA の場合は減点', `終値 ${fmt(m.close)} / 200MA ${fmt(m.daily_sma200)} / 判定 ${m.daily_close_below_sma200_penalty ? '減点対象' : '対象外'}`, '日足終値が200MAを下回っているため、-2点です。', -2),
    item('⑧', 'c08', '週足BB拡大', '週足BB幅 >= 前週BB幅', `BB幅 ${fmt(m.weekly_bb_width)} / 前週BB幅 ${fmt(m.prev_weekly_bb_width)}`, '週足BB幅が前週以上に拡大していません。', 2),
    item('⑨', 'c09', '日足MACD良好', '日足MACD > 日足Signal', `MACD ${fmt(m.daily_macd)} / Signal ${fmt(m.daily_macd_signal)}`, '日足MACDがSignal以下です。', 2),
    item('⑩', 'c10', '週足MACD良好', '週足MACD > 週足Signal', `週MACD ${fmt(m.weekly_macd)} / 週Signal ${fmt(m.weekly_macd_signal)}`, '週足MACDがSignal以下です。', 2),
    item('⑪', 'c11', '日足RSI9条件', 'RSI9<=10かつ傾き負、または60<=RSI9<=80かつ傾き正', `RSI9 ${fmt(m.daily_rsi9)} / 前日RSI9 ${fmt(m.prev_daily_rsi9)} / 傾き ${fmt(m.daily_rsi9_slope)}`, '日足RSI9条件を満たしていません。', 2),
    item('⑫', 'c12', '週足RSI14条件', 'RSI14<=10かつ傾き負、または60<=RSI14<=80かつ傾き正', `RSI14 ${fmt(m.weekly_rsi14)} / 前週RSI14 ${fmt(m.prev_weekly_rsi14)} / 傾き ${fmt(m.weekly_rsi14_slope)}`, '週足RSI14条件を満たしていません。', 2),
    item('⑬', 'c13', '日足終値が一目雲上限より上', '終値 > 日足雲上限', `終値 ${fmt(m.close)} / 日足雲上限 ${fmt(m.daily_ichimoku_cloud_upper)}`, '終値が日足雲上限を上回っていません。', 2),
    item('⑭', 'c14', '廃止: 週足終値が一目雲上限より上', '廃止条件のため常に0点', `週足終値 ${fmt(m.weekly_close)} / 週足雲上限 ${fmt(m.weekly_ichimoku_cloud_upper)}`, '廃止条件です。', 0),
    item('⑮', 'c15', '週足13MA上抜け', '週足終値 > 13週MA', `週足終値 ${fmt(m.weekly_close)} / 13MA ${fmt(m.weekly_sma13)}`, '週足終値が13週MAより上ではありません。', 2),
    item('⑯', 'c16', '日足BB収斂5日以上', 'BB2σ幅/終値 <= 10% が5日以上継続', `現在BB2σ幅 ${fmt(m.daily_bb_2sigma_width_pct, '%')}`, 'BB2σ幅10%以内が5日以上継続していません。', 2),
    item('⑰', 'c17', '日足BB幅20%以下', 'BB2σ幅/終値 <= 20%', `現在BB2σ幅 ${fmt(m.daily_bb_2sigma_width_pct, '%')}`, '日足BB2σ幅が20%を超えています。', 3),
    item('⑱', 'c18', '日足BB収斂から拡大', 'BB2σ幅10%以内から1割増となった日が3営業日以内', `基準 ${fmt(m.daily_bb_expand_base_width_pct, '%')} / 拡大 ${fmt(m.daily_bb_expand_signal_width_pct, '%')} / 日付 ${fmt(m.daily_bb_expand_signal_date)} / 経過 ${fmt(m.daily_bb_expand_days_since)}`, '日足BB収斂から拡大の条件を満たしていません。', 5),
    item('⑲', 'c19', '日足MACDのGCから3日以内', '日足MACDがSignalを上抜けて3営業日以内', `GC日 ${fmt(m.daily_macd_gc_date)} / 経過 ${fmt(m.daily_macd_gc_days_since)}`, '日足MACD GCから3営業日以内ではありません。', 3),
    item('⑳', 'c20', '週足MACDのGCから3週以内', '週足MACDがSignalを上抜けて3週以内', `GC週 ${fmt(m.weekly_macd_gc_date)} / 経過 ${fmt(m.weekly_macd_gc_days_since)}`, '週足MACD GCから3週以内ではありません。', 3),
    item('㉑', 'c21', '日足RSI9低位反転継続', 'RSI9<=10かつ傾き0以上発生後、RSI9<=20が継続', `RSI9 ${fmt(m.daily_rsi9)} / 発生日 ${fmt(m.daily_rsi_low_trigger_date)} / 経過 ${fmt(m.daily_rsi_low_days_since)}`, '日足RSI9低位反転継続条件を満たしていません。', 5),
    item('㉒', 'c22', '週足RSI14低位反転継続', 'RSI14<=10かつ傾き0以上発生後、RSI14<=20が継続', `RSI14 ${fmt(m.weekly_rsi14)} / 発生日 ${fmt(m.weekly_rsi_low_trigger_date)} / 経過 ${fmt(m.weekly_rsi_low_days_since)}`, '週足RSI14低位反転継続条件を満たしていません。', 5),
    item('㉓', 'c23', '週足BB収斂から拡大', '週足BB2σ幅10%以内から1割増となった週が2週以内', `基準 ${fmt(m.weekly_bb_expand_base_width_pct, '%')} / 拡大 ${fmt(m.weekly_bb_expand_signal_width_pct, '%')} / 日付 ${fmt(m.weekly_bb_expand_signal_date)} / 経過 ${fmt(m.weekly_bb_expand_days_since)}`, '週足BB収斂から拡大の条件を満たしていません。', 5),
    item('㉔', 'c24', '日足MA収斂', '5MA/25MA/75MAが5%以内、5MAが最上位、5MA傾き正', `5MA ${fmt(m.daily_sma5)} / 25MA ${fmt(m.daily_sma25)} / 75MA ${fmt(m.daily_sma75)} / 収斂幅 ${fmt(m.daily_ma_convergence_gap_pct, '%')}`, '日足MA収斂条件を満たしていません。', 4),
    item('㉕', 'c25', '週足MA収斂', '原則: 13MA/26MA/52MAが10%以内、13MAが最上位、13MA傾き正。52MA未算出時は52MAを対象外とし、13MA/26MAが10%以内で判定', `13MA ${fmt(m.weekly_sma13)} / 26MA ${fmt(m.weekly_sma26)} / 52MA ${fmt(m.weekly_sma52)} / 収斂幅 ${fmt(m.weekly_ma_convergence_gap_pct, '%')} / 判定 ${fmt(m.weekly_ma_convergence_rule)} / 対象外 ${Array.isArray(m.weekly_ma_convergence_excluded) && m.weekly_ma_convergence_excluded.length ? m.weekly_ma_convergence_excluded.join('・') : '-'}`, '週足MA収斂条件を満たしていません。', 4),
    item('㉖', 'c26', '日足一目雲のねじれ＋10営業日高値', '一目均衡表の雲のねじれが現在±5営業日以内、かつ日足終値が直近10営業日内の終値最高値', `ねじれ日 ${fmt(m.daily_ichimoku_twist_date)} / 現在から ${fmt(m.daily_ichimoku_twist_days_to)}営業日 / 10日高値 ${fmt(m.daily_10d_high_value)} (${fmt(m.daily_10d_high_date)}) / ${fmt(m.daily_ichimoku_twist_reason)} / ${fmt(m.daily_10d_high_reason)}`, '一目雲のねじれ±5営業日以内、または10営業日内高値の条件を満たしていません。', 4),
  ];
}


const SCORE_GROUP_ORDER = [
  ['ma', 'MA'],
  ['bb', 'BB'],
  ['macd', 'MACD'],
  ['rsi', 'RSI'],
  ['cloud', '雲'],
] as const;

function ScoreCategoryHistoryTable({ metrics, isAdmin }: { metrics: Record<string, any> | null | undefined; isAdmin: boolean }) {
  if (!isAdmin) return null;
  const rows = Array.isArray(metrics?.score_category_history_10d) ? metrics?.score_category_history_10d : [];
  if (!rows.length) {
    return (
      <section className="section">
        <h2>カテゴリ別条件整理点推移（管理者）</h2>
        <p>10営業日分のカテゴリ別条件整理点履歴がありません。再分析後に表示されます。</p>
      </section>
    );
  }
  const groupText = (row: any, key: string) => {
    const g = row?.groups?.[key];
    if (!g) return '-';
    return `${fmt(g.score)} / ${fmt(g.max)}`;
  };
  const achievedText = (row: any, key: string) => {
    const g = row?.groups?.[key];
    if (!g || !Array.isArray(g.achieved) || !g.achieved.length) return '-';
    return g.achieved.map((x: string) => x.replace('c', '')).join(',' );
  };
  return (
    <section className="section">
      <h2>カテゴリ別条件整理点推移（管理者・10営業日）</h2>
      <p className="meta">MA / BB / MACD / RSI / 雲の5分類で、各日付時点の条件整理点を集計します。</p>
      <table>
        <thead>
          <tr>
            <th>日付</th><th>区分</th><th>総合</th>
            {SCORE_GROUP_ORDER.map(([key, label]) => <th key={key}>{label}</th>)}
            <th>一致条件</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={`${row.date}-${row.label}`}>
              <td>{fmt(row.date)}</td>
              <td>{fmt(row.label)}</td>
              <td><b>{fmt(row.score)}</b></td>
              {SCORE_GROUP_ORDER.map(([key]) => <td key={key}>{groupText(row, key)}</td>)}
              <td>
                {SCORE_GROUP_ORDER.map(([key, label]) => (
                  <div key={key}><b>{label}</b>: {achievedText(row, key)}</div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="meta">分類: MA=①②③④⑤⑥⑮㉔㉕ / BB=⑦⑧⑯⑰⑱㉓ / MACD=⑨⑩⑲⑳ / RSI=⑪⑫㉑㉒ / 雲=⑬⑭㉖</p>
    </section>
  );
}

export default async function ScoreDetail({ params }: { params: Promise<{ userId: string; code: string }> }) {
  const { userId, code } = await params;
  const isAdmin = userId === ADMIN_USER_ID;

  if (!isAdmin) {
    return (
      <>
        <header className="hero"><div className="eyebrow">PoC / Beta</div><h1>条件詳細</h1></header>
        <main className="wrap">
          <section className="section">
            <p>現在、この検証用ページは利用できません。</p>
          </section>
        </main>
      </>
    );
  }

  let run: any = null;
  let row: ResultRow | null = null;
  let errorMessage = '';

  try {
    const data = await getLatestResult(userId, code);
    run = data.run;
    row = data.row;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const conditions = buildConditions(row?.metrics || null);

  return (
    <>
      <header className="hero">
        <div className="eyebrow">Condition Detail</div>
        <h1>{code} {row?.name || ''}</h1>
        <p className="meta">{userId} / 最終更新: {formatJst(run?.finished_at || run?.started_at)}</p>
      </header>
      <main className="wrap">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <Link className="btn" href={`/u/${userId}`}>銘柄整理画面へ戻る</Link>
          {row?.kabutan_url ? <a className="btn" href={row.kabutan_url} target="_blank" rel="noreferrer">株探</a> : null}
        </div>
        {errorMessage ? <div className="alert">エラー: {errorMessage}</div> : null}
        {row ? (
          <>
            <div className="cards">
              <div className="card">条件整理点<br /><b>{fmt(row.score)}</b></div>
              <div className="card">一致<br /><b>{fmt(row.condition_count)}</b></div>
              <div className="card">高配点非一致<br /><b>{fmt(row.failed_star_numbers)}</b></div>
              <div className="card">株価<br /><b>{fmt(row.close)}</b></div>
            </div>
            <p className="disclaimer">条件整理点は、あらかじめ定めた確認条件への一致状況を数値化したものであり、売買判断、将来の値上がり可能性、投資成果を示すものではありません。</p>
            <ScoreCategoryHistoryTable metrics={row.metrics} isAdmin={isAdmin} />
            <section className="section">
              <h2>条件一致状況</h2>
              <table>
                <thead><tr><th>No</th><th>結果</th><th>条件名</th><th>条件</th><th>株価・指標</th><th>非一致理由</th></tr></thead>
                <tbody>
                  {conditions.map((c) => (
                    <tr key={c.no}>
                      <td><b>{c.no}{c.star ? '★' : ''}</b></td>
                      <td><span className={`badge ${c.ok ? 'green' : 'red'}`}>{yn(c.ok)}</span></td>
                      <td>{c.title}</td>
                      <td>{c.criterion}</td>
                      <td>{c.actual}</td>
                      <td>{c.ok ? '-' : c.ng}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="section">
              <h2>補助テクニカル・タグ理由</h2>
              <table>
                <tbody>
                  <tr><th>タグ</th><td>{visibleTags(row).map((t) => <span className="badge gray" key={t}>{t}</span>)}</td></tr>
                  <tr><th>BB判定</th><td>{fmt(row.metrics?.daily_bb_position)} / {fmt(row.metrics?.daily_bb_width_percentile, '%順位')}</td></tr>
                  <tr><th>BB理由</th><td>{fmt(row.tag_reasons?.bb || row.metrics?.reason)}</td></tr>
                  <tr><th>6か月値幅</th><td>{fmt(row.metrics?.six_month_range_pct, '%')} / 高値 {fmt(row.metrics?.six_month_high)} / 安値 {fmt(row.metrics?.six_month_low)}</td></tr>
                  <tr><th>売買代金</th><td>20日平均 {fmt(row.metrics?.avg_trading_value_20d)}</td></tr>
                </tbody>
              </table>
            </section>
          </>
        ) : <section className="section">対象銘柄の分析結果がありません。</section>}
      </main>
    </>
  );
}
