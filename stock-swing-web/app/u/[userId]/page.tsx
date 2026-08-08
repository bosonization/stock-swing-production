import { supabaseAdmin } from '../../../lib/supabaseServer';
import { validatePocAccess } from '../../../lib/pocAccess';
import Link from 'next/link';

type ResultRow = {
  id: string;
  code: string;
  name: string | null;
  score: number | null;
  条件整理点: number | null;
  condition_count: number | null;
  failed_star_numbers: string | null;
  tags: string[] | null;
  close: number | null;
  metrics: Record<string, any> | null;
  kabutan_url: string | null;
};

type MarketIndex = {
  key: string;
  label: string;
  ticker: string;
  date?: string;
  close?: number | null;
  diff?: number | null;
  diff_pct?: number | null;
  ma5_gt_ma25?: boolean;
  close_gt_ma25?: boolean;
  rsi14?: number | null;
  macd_gt_signal?: boolean;
  slow_k?: number | null;
  slow_d?: number | null;
  stoch_cross?: string;
  tone?: string;
  error?: string;
};

type MarketEnv = {
  label?: string;
  stars?: string;
  comment?: string;
  note?: string;
  indices?: MarketIndex[];
};

type StatusKey = 'WATCH_PRIORITY' | 'EARNINGS_CAUTION' | 'EARNINGS_EXCLUDE' | 'OUT_OF_SCOPE' | 'WATCH_LIST';

const ADMIN_USER_ID = 'takashimasaakiadmin';
const POC_CONSENT_VERSION = 'poc_terms_v1';

const STATUS_LABEL_PUBLIC: Record<StatusKey, string> = {
  WATCH_PRIORITY: '条件一致銘柄',
  EARNINGS_CAUTION: 'イベント確認',
  EARNINGS_EXCLUDE: 'イベント前確認',
  OUT_OF_SCOPE: '参考確認',
  WATCH_LIST: '通常確認',
};

const STATUS_LABEL_ADMIN: Record<StatusKey, string> = {
  WATCH_PRIORITY: '確認優先',
  EARNINGS_CAUTION: 'イベント確認',
  EARNINGS_EXCLUDE: 'イベント前確認',
  OUT_OF_SCOPE: '条件判定対象外',
  WATCH_LIST: '通常確認',
};


async function hasPocConsent(userId: string) {
  const supabase = supabaseAdmin();
  const consent = await supabase
    .from('user_consents')
    .select('id')
    .eq('user_id', userId)
    .eq('consent_type', 'poc_terms')
    .eq('version', POC_CONSENT_VERSION)
    .limit(1);
  if (consent.error) return false;
  return (consent.data || []).length > 0;
}

function PocConsentNotice({ userId, returnPath }: { userId: string; returnPath: string }) {
  return (
    <main className="wrap premium-wrap">
      <section className="section consent-box">
        <h1>PoC利用同意</h1>
        <p>本ツールは、株価・出来高等の公開情報をもとに、あらかじめ定めたテクニカル条件への一致状況を機械的に整理するPoC検証用ツールです。</p>
        <p>特定銘柄の取得、売却、保有を推奨するものではありません。</p>
        <p>損切り、利確、目標株価、売買タイミングは提示しません。</p>
        <p>表示される条件整理点、ラベル、並び順は、将来の値上がり、利益獲得可能性、投資成果を示すものではありません。</p>
        <p>投資判断は利用者ご自身の責任で行ってください。</p>
        <form action="/api/consents/poc" method="POST" className="consent-form">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="version" value={POC_CONSENT_VERSION} />
          <input type="hidden" name="returnPath" value={returnPath} />
          <label className="consent-check"><input type="checkbox" name="agreed" value="yes" required /> 上記内容を確認し、PoC検証用ツールとして利用することに同意します。</label>
          <button className="btn" type="submit">同意して利用する</button>
        </form>
      </section>
    </main>
  );
}

async function getData(userId: string) {
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
  if (!run) return { run: null, rows: [] as ResultRow[], marketEnv: undefined as MarketEnv | undefined };

  const results = await supabase
    .from('analysis_results')
    .select('*')
    .eq('run_id', run.id);

  if (results.error) throw new Error(results.error.message);

  const allRows = ((results.data ?? []) as ResultRow[]);
  const marketRow = allRows.find((r) => r.code === '__MARKET_ENV__' || (r.tags || []).includes('MARKET_ENV'));
  const marketEnv = marketRow?.metrics?.market_environment as MarketEnv | undefined;
  const rows = allRows
    .filter((r) => r.code !== '__MARKET_ENV__' && !(r.tags || []).includes('MARKET_ENV'))
    .sort((a, b) => {
      const as = typeof a.score === 'number' && Number.isFinite(a.score) ? a.score : null;
      const bs = typeof b.score === 'number' && Number.isFinite(b.score) ? b.score : null;
      if (as === null && bs === null) return String(a.code).localeCompare(String(b.code), 'ja');
      if (as === null) return 1;
      if (bs === null) return -1;
      if (bs !== as) return bs - as;
      return String(a.code).localeCompare(String(b.code), 'ja');
    });

  return { run, rows, marketEnv };
}

function fmt(value: any, suffix = '') {
  if (value === null || value === undefined || value === '') return '-';
  return `${value}${suffix}`;
}

function signed(value: any, suffix = '') {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('ja-JP')}${suffix}`;
}

function shortDate(value: any) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  return '';
}

function scoreHistory(row: ResultRow) {
  const h = row.metrics?.score_history_5d;
  return Array.isArray(h) ? h : [];
}

function scoreTrendMark(history: any[]) {
  const vals = history.map((x) => typeof x.score === 'number' ? x.score : null).filter((x) => x !== null) as number[];
  if (vals.length < 2) return '';
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (last > first) return '↗';
  if (last < first) return '↘';
  return '→';
}

function ScoreHistory({ row }: { row: ResultRow }) {
  const history = scoreHistory(row);
  if (!history.length) return null;
  const mark = scoreTrendMark(history);
  return (
    <div className="score-history" aria-label="5営業日のスコア推移">
      <span className="score-history-label">5日条件整理点{mark ? ` ${mark}` : ''}</span>
      <div className="score-history-pills">
        {history.map((h: any, i: number) => (
          <span className={`score-pill ${typeof h.score === 'number' ? 'ok' : 'na'}`} key={`${h.date || i}-${i}`} title={`${h.label || ''} ${h.date || ''} 株価:${h.close ?? '-'} 条件整理点:${h.score ?? '-'}`}>
            <small>{h.label === '当日' ? '今日' : `${h.offset_business_days}日前`}</small>
            <b>{typeof h.score === 'number' ? h.score : '-'}</b>
          </span>
        ))}
      </div>
    </div>
  );
}


function categoryHistory(row: ResultRow) {
  const h = row.metrics?.score_category_history_10d;
  return Array.isArray(h) ? h : [];
}

function groupScore(h: any, key: string) {
  const v = h?.groups?.[key]?.score;
  return typeof v === 'number' ? v : '-';
}

function AdminCategoryScoreHistory({ row, isAdmin }: { row: ResultRow; isAdmin: boolean }) {
  if (!isAdmin) return null;
  const history = categoryHistory(row);
  if (!history.length) return null;
  return (
    <div className="admin-cat-history" aria-label="カテゴリ別スコア推移">
      <div className="admin-cat-history-title">10日カテゴリスコア</div>
      <div className="admin-cat-history-scroll">
        <table>
          <thead>
            <tr><th>日付</th><th>総</th><th>MA</th><th>BB</th><th>MACD</th><th>RSI</th><th>雲</th></tr>
          </thead>
          <tbody>
            {history.map((h: any, i: number) => (
              <tr key={`${h.date || i}-${i}`}>
                <td>{shortDate(h.date) || '-'}</td>
                <td>{typeof h.score === 'number' ? h.score : '-'}</td>
                <td>{groupScore(h, 'ma')}</td>
                <td>{groupScore(h, 'bb')}</td>
                <td>{groupScore(h, 'macd')}</td>
                <td>{groupScore(h, 'rsi')}</td>
                <td>{groupScore(h, 'cloud')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function pctText(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(2)}%`;
}

function yenText(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(n)}円`;
}

function adminTradeSimulations(row: ResultRow) {
  const h = row.metrics?.admin_trade_simulations_50d || row.metrics?.admin_trade_simulations_40d;
  return Array.isArray(h) ? h : [];
}

function simPrice(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: n >= 1000 ? 0 : 1 }).format(n);
}

function simProfit(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: n >= 1000 ? 0 : 1 }).format(n)}`;
}

function signedScore(value: any) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${n > 0 ? '+' : ''}${Math.round(n)}`;
}

function AdminTradeSimulation50d({ row, isAdmin }: { row: ResultRow; isAdmin: boolean }) {
  if (!isAdmin) return null;
  const strategies = adminTradeSimulations(row)
    .map((s: any) => ({ ...s, trades: Array.isArray(s?.trades) ? s.trades : [] }));
  if (!strategies.length) return null;

  const first = strategies[0] || {};
  const scoreMin = first.score_min;
  const scoreMax = first.score_max;
  const tradeRows = strategies.flatMap((s: any) => s.trades.map((t: any, i: number) => ({ strategy: s.label || s.id || '-', rule: s.rule || '', trade: t, key: `${s.id || s.label}-${i}-${t.buy_date || ''}-${t.sell_date || ''}` })));
  return (
    <div className="admin-sim50" aria-label="50営業日機械的過去検証">
      <div className="admin-sim50-title">50営業日 機械的過去検証</div>
      <div className="admin-sim50-note">管理者検証用です。ここでいう24点・5点は「一致項目数」ではなくスコアです。この機械的過去検証では、出来高・ボラ・週足雲による通常の条件判定対象外ゲートを使わず、直近50営業日のスコアを計算した前提で判定します。仮想購入・仮想売却はスコア変化を翌営業日始値に機械適用した過去整理であり、売買判断を示すものではありません。</div>

      <div className="admin-sim50-diagnostics">
        <div className="admin-sim50-diag-main">
          <span>スコア計算日数: <b>{first.score_calculated_days ?? '-'}</b> / <b>{first.score_required_days ?? 50}</b></span>
          <span>最新50日スコア範囲: <b>{scoreMin ?? '-'}</b>〜<b>{scoreMax ?? '-'}</b></span>
          <span>最大前日比上昇: <b>{signedScore(first.max_score_diff_up)}</b></span>
          <span>最大前日比下降: <b>{signedScore(first.max_score_diff_down)}</b></span>
        </div>
        <div className="admin-sim50-diag-grid">
          {strategies.map((s: any, idx: number) => (
            <div key={s.id || idx} className="admin-sim50-diag-card">
              <b>{String(idx + 1)}条件</b>
              <span>買いシグナル数: {s.buy_signal_count ?? 0}</span>
              <span>売りシグナル数: {s.sell_signal_count ?? 0}</span>
            </div>
          ))}
        </div>
        {first.score_complete === false ? (
          <div className="admin-sim50-warning">スコア未計算日があります: {(Array.isArray(first.score_missing_dates) ? first.score_missing_dates : []).join(', ') || '詳細なし'}</div>
        ) : null}
      </div>

      {tradeRows.length ? (
        <div className="admin-sim50-scroll">
          <table>
            <thead>
              <tr><th>条件</th><th>仮想購入日</th><th>仮想購入株価</th><th>仮想売却日</th><th>仮想売却株価</th><th>差額</th><th>状態</th></tr>
            </thead>
            <tbody>
              {tradeRows.map((r: any) => {
                const t = r.trade || {};
                const p = Number(t.profit);
                const cls = Number.isFinite(p) ? (p >= 0 ? 'plus' : 'minus') : '';
                return (
                  <tr key={r.key} title={r.rule}>
                    <td>{r.strategy}</td>
                    <td>{shortDate(t.buy_date) || '-'}</td>
                    <td>{simPrice(t.buy_price)}</td>
                    <td>{shortDate(t.sell_date) || '-'}</td>
                    <td>{simPrice(t.sell_price)}</td>
                    <td className={cls}>{simProfit(t.profit)}</td>
                    <td>{t.status === 'open' ? '未決済' : '完了'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-sim50-empty">直近50営業日では、①②③の条件に基づく仮想売買結果はありません。</div>
      )}
    </div>
  );
}


function DividendLine({ row, isAdmin }: { row: ResultRow; isAdmin: boolean }) {
  const m = row.metrics || {};
  if (!isAdmin && m.dividend_visible !== true) return null;
  if (isAdmin && !(m.dividend_enabled || m.dividend_checked)) return null;

  if (!isAdmin) {
    return (
      <div className="dividend-line public">
        <span>配当: 利回り<b>{pctText(m.dividend_yield_pct)}</b></span>
        {m.dividend_payout_ratio_pct !== null && m.dividend_payout_ratio_pct !== undefined ? <span>性向<b>{pctText(m.dividend_payout_ratio_pct)}</b></span> : null}
      </div>
    );
  }

  const visible = m.dividend_visible === true;
  return (
    <div className={`dividend-line admin ${visible ? 'visible' : 'hidden'}`}>
      <div className="dividend-title">配当情報: {visible ? '表示' : '非表示'}{m.dividend_hide_reason ? `（${m.dividend_hide_reason}）` : ''}</div>
      <div className="dividend-calc-grid">
        <span>今期予想配当:<b>{yenText(m.dividend_forecast_per_share)}</b></span>
        <span>今期予想EPS:<b>{yenText(m.dividend_forecast_eps)}</b></span>
        <span>配当利回り:<b>{pctText(m.dividend_yield_pct)}</b></span>
        <span>配当性向:<b>{pctText(m.dividend_payout_ratio_pct)}</b></span>
        <span>開示日:<b>{m.dividend_disclosure_date || '-'}</b></span>
        <span>鮮度:<b>{m.dividend_data_age_days !== null && m.dividend_data_age_days !== undefined ? `${m.dividend_data_age_days}日` : '-'}</b></span>
      </div>
      <div className="dividend-formula">利回り = {m.dividend_yield_formula || '-'} / 性向 = {m.dividend_payout_formula || '-'}</div>
    </div>
  );
}

function formatJst(value: any) {
  if (!value) return '未実行';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date) + ' JST';
}

function formatMd(value: any) {
  if (!value) return '';
  const raw = String(value);
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${Number(m[2])}月${Number(m[3])}日`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(date).replace('/', '月') + '日';
}

function rangeTag(label: string, kind: string, value: any, date: any) {
  if (value === null || value === undefined || value === '') return '';
  const md = formatMd(date);
  const price = typeof value === 'number'
    ? new Intl.NumberFormat('ja-JP', { maximumFractionDigits: value >= 1000 ? 0 : 1 }).format(value)
    : String(value);
  return md ? `${label}レンジ${kind}:${md} ${price}` : `${label}レンジ${kind}:${price}`;
}

const HIDDEN_TAGS_PUBLIC = new Set([
  'TRADE READY', 'TRADEREADY',
  'ボラOK', 'ボラ不足', 'ボラ判定不可',
  '出来高OK', '出来高強い', '出来高不足', '出来高判定不可',
  '損切り許容内', '損切り遠い', '直近安値接近',
  'BB拡大中',
]);

function isSidewaysRawTag(t: string) {
  return t.includes('レンジ') || t.includes('横ばい');
}

function shouldShowBbBreakout(row: ResultRow) {
  const m = row.metrics || {};
  // 古い分析結果や下方向ブレイクの残存タグを画面で抑止する。
  // 現在値がBB+1σ以上であることをCore側のmetricsで確認できる場合だけ表示する。
  return m.daily_bb_breakout === true && m.daily_bb_breakout_current_positive_touch === true;
}

function displayTag(t: string, isAdmin: boolean) {
  if (isAdmin) return t;
  if (t === '決算直前注意') return 'イベント確認';
  if (t === '決算前除外') return 'イベント前確認';
  return t;
}

function tagClass(t: string) {
  if (t.includes('イベント前確認') || t.includes('決算前除外')) return 'red';
  if (t.includes('イベント確認') || t.includes('決算直前注意') || t.startsWith('決算日:')) return 'orange';
  if (['小型株'].includes(t)) return 'green';
  return 'gray';
}

function visibleTags(row: ResultRow, isAdmin: boolean) {
  let tags = (row.tags || []).filter((t) => t !== 'MARKET_ENV');
  const m = row.metrics || {};
  // 上放れ候補/BBブレイク分類は廃止。既存DBに残ったタグも表示しない。
  tags = tags.filter((t) => !(t === 'BBブレイク' || t === 'BBスクイーズブレイク' || t.includes('BB横ばいレンジ') || t.includes('上放れ候補')));

  if (!isAdmin) {
    tags = tags
      .filter((t) => !HIDDEN_TAGS_PUBLIC.has(t))
      .filter((t) => !isSidewaysRawTag(t));
  }

  // 横ばいレンジ判定は廃止したため、管理者にも表示しない。

  const rawHasEarnings = tags.some((t) => ['決算直前注意', '決算前除外', 'イベント確認', 'イベント前確認'].includes(t));
  const earningsDate = row.metrics?.next_earnings_date || row.metrics?.earnings_date;
  const md = formatMd(earningsDate);
  if (rawHasEarnings && md) tags.push(`決算日:${md}`);

  return Array.from(new Set(tags.map((t) => displayTag(t, isAdmin)).filter(Boolean)));
}

function isScored(row: ResultRow) {
  return typeof row.score === 'number' && Number.isFinite(row.score);
}

function hasAnyTag(row: ResultRow, words: string[], isAdmin: boolean) {
  return visibleTags(row, isAdmin).some((t) => words.some((w) => t.includes(w)));
}

function statusOf(row: ResultRow, isAdmin: boolean): StatusKey {
  const tags = visibleTags(row, isAdmin);
  // ボラ・出来高未達は参考確認へ。ただしイベントタグは同じ行に表示する。
  if (!isScored(row)) return 'OUT_OF_SCOPE';
  if (tags.some((t) => t.includes('イベント前確認') || t.includes('決算前除外'))) return 'EARNINGS_EXCLUDE';
  if (tags.some((t) => t.includes('イベント確認') || t.includes('決算直前注意'))) return 'EARNINGS_CAUTION';
  if (Number(row.score) >= 22) return 'WATCH_PRIORITY';
  return 'WATCH_LIST';
}

function reasonsOf(row: ResultRow, isAdmin: boolean) {
  if (!isAdmin) return [];
  const tags = visibleTags(row, true);
  const reasons: string[] = [];
  if (!isScored(row)) reasons.push('出来高またはボラ条件未達のため条件判定対象外');
  else reasons.push('出来高・ボラティリティ条件をクリア');
  if (Number(row.score) >= 22) reasons.push('条件整理点が相対的に高い水準');
  if (tags.includes('決算直前注意')) reasons.push('決算直前のため注意');
  if (tags.includes('決算前除外')) reasons.push('決算前除外条件に該当');
  return Array.from(new Set(reasons)).slice(0, 3);
}

function fallbackMarketTone(rows: ResultRow[], isAdmin: boolean) {
  const scored = rows.filter(isScored);
  const high = scored.filter((r) => Number(r.score) >= 22).length;
  const risk = rows.filter((r) => visibleTags(r, isAdmin).some((t) => t.includes('イベント前確認') || t.includes('イベント確認') || t.includes('決算'))).length;
  const ratio = scored.length ? high / scored.length : 0;
  const score = ratio * 2 - Math.min(risk, 5) * 0.15;
  if (score >= 1.6) return { label: 'やや強気', stars: '★★★★☆', comment: '確認候補が多く、比較的整理しやすい状況です。' };
  if (score >= 0.9) return { label: '中立', stars: '★★★☆☆', comment: '候補はあります。イベントと株価位置を確認しながら選別します。' };
  if (score >= 0.4) return { label: 'やや慎重', stars: '★★☆☆☆', comment: '確認候補を絞り、イベント前の銘柄に注意します。' };
  return { label: '慎重', stars: '★☆☆☆☆', comment: '無理に対象を広げず、確認候補を絞ります。' };
}

function IndexCard({ item, isAdmin }: { item: MarketIndex; isAdmin: boolean }) {
  const diffClass = Number(item.diff || 0) >= 0 ? 'up' : 'down';
  return (
    <div className="index-card">
      <div className="index-head"><b>{item.label}</b><span>{item.ticker}</span></div>
      {item.close === null || item.close === undefined ? (
        <p className="index-error">取得不可: {item.error || '-'}</p>
      ) : (
        <>
          <div className="index-price">{Number(item.close).toLocaleString('ja-JP')}</div>
          <div className={`index-diff ${diffClass}`}>{signed(item.diff)} / {signed(item.diff_pct, '%')}</div>
          <div className="index-date">取得日: {item.date || '-'}</div>
          <div className="index-tone">環境: {item.tone || '-'}</div>
          {isAdmin ? (
            <div className="index-mini">
              <span>5MA&gt;25MA {item.ma5_gt_ma25 ? '○' : '×'}</span>
              <span>終値&gt;25MA {item.close_gt_ma25 ? '○' : '×'}</span>
              <span>RSI {fmt(item.rsi14)}</span>
              <span>MACD {item.macd_gt_signal ? '良好' : '弱め'}</span>
              <span>％K {fmt(item.slow_k)} / ％D {fmt(item.slow_d)}</span>
              <span>{item.stoch_cross || '-'}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusPill({ status, isAdmin }: { status: StatusKey; isAdmin: boolean }) {
  const label = isAdmin ? STATUS_LABEL_ADMIN[status] : STATUS_LABEL_PUBLIC[status];
  return <span className={`status-pill status-${status}`}>{label}</span>;
}

function kabutanUrl(row: ResultRow) {
  return `https://kabutan.jp/stock/chart?code=${encodeURIComponent(String(row.code))}`;
}

function StockRow({ row, userId, isAdmin }: { row: ResultRow; userId: string; isAdmin: boolean }) {
  const tags = visibleTags(row, isAdmin);
  const status = statusOf(row, isAdmin);
  const reasons = reasonsOf(row, isAdmin);
  const shownTags = tags.slice(0, isAdmin ? 12 : 5);
  return (
    <article className="premium-stock">
      <div className="stock-topline">
        <StatusPill status={status} isAdmin={isAdmin} />
        <div className="stock-title"><b>{row.code}</b><span>{row.name || ''}</span></div>
        <div className="stock-numbers">
          <span>条件整理点<b>{isScored(row) ? fmt(row.score) : '-'}</b></span>
          <span>株価:<b>{fmt(row.close)}</b></span>
        </div>
      </div>
      <ScoreHistory row={row} />
      <AdminCategoryScoreHistory row={row} isAdmin={isAdmin} />
      <AdminTradeSimulation50d row={row} isAdmin={isAdmin} />
      <DividendLine row={row} isAdmin={isAdmin} />
      <div className="stock-tags">
        {shownTags.map((t) => <span className={`badge ${tagClass(t)}`} key={t}>{t}</span>)}
        {tags.length > shownTags.length ? <span className="badge gray">+{tags.length - shownTags.length}</span> : null}
      </div>
      {isAdmin && reasons.length ? <div className="reason-line">理由: {reasons.join(' / ')}</div> : null}
      <div className="stock-actions">
        {isAdmin ? <Link className="mini-btn" href={`/u/${userId}/score/${row.code}`}>詳細</Link> : null}
        <a className="mini-btn kabutan" href={kabutanUrl(row)} target="_blank" rel="noreferrer">株探</a>
      </div>
    </article>
  );
}

function Section({ title, subtitle, rows, userId, isAdmin }: { title: string; subtitle: string; rows: ResultRow[]; userId: string; isAdmin: boolean }) {
  return (
    <section className="section premium-section">
      <div className="section-headline"><div><h2>{title}</h2><p>{subtitle}</p></div><span>{rows.length}件</span></div>
      {rows.length === 0 ? <p className="empty-text">該当銘柄はありません。</p> : <div className="premium-list">{rows.map((r) => <StockRow key={r.id} row={r} userId={userId} isAdmin={isAdmin} />)}</div>}
    </section>
  );
}

export default async function Dashboard({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { userId } = await params;
  const query = searchParams ? await searchParams : {};
  const isAdmin = userId === ADMIN_USER_ID;

  const returnQuery = new URLSearchParams();
  const queryUser = Array.isArray(query.user) ? query.user[0] : query.user;
  const queryKey = Array.isArray(query.key) ? query.key[0] : query.key;
  if (queryUser) returnQuery.set('user', queryUser);
  if (queryKey) returnQuery.set('key', queryKey);
  const returnPath = `/u/${encodeURIComponent(userId)}${returnQuery.toString() ? `?${returnQuery.toString()}` : ''}`;

  if (!isAdmin) {
    const access = await validatePocAccess({ pathUserId: userId, queryUser: query.user, queryKey: query.key, path: `/u/${userId}` });
    if (!access.allowed) {
      return (
        <>
          <header className="hero premium-hero"><div className="eyebrow">PoC / Beta</div><h1>銘柄整理ダッシュボード</h1></header>
          <main className="wrap premium-wrap">
            <section className="section">
              <p>現在、この検証用ページは利用できません。</p>
            </section>
          </main>
        </>
      );
    }
  }

  const consentOk = await hasPocConsent(userId);
  if (!consentOk) {
    return (
      <>
        <header className="hero premium-hero"><div className="eyebrow">PoC / Beta</div><h1>銘柄整理ダッシュボード</h1><p className="hero-lead">PoC検証用ツールとしての利用同意が必要です。</p></header>
        <PocConsentNotice userId={userId} returnPath={returnPath} />
      </>
    );
  }
  let data: { run: any; rows: ResultRow[]; marketEnv?: MarketEnv };
  let errorMessage = '';

  try {
    data = await getData(userId);
  } catch (error) {
    data = { run: null, rows: [], marketEnv: undefined };
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  const rows = data.rows || [];
  const scoredRows = rows.filter(isScored);
  const byStatus = (s: StatusKey) => rows.filter((r) => statusOf(r, isAdmin) === s);
  const lastUpdated = formatJst(data.run?.finished_at || data.run?.started_at);
  const fallbackTone = fallbackMarketTone(rows, isAdmin);
  const marketEnv = data.marketEnv;
  const tone = marketEnv?.label ? { label: marketEnv.label, stars: marketEnv.stars || fallbackTone.stars, comment: marketEnv.comment || fallbackTone.comment } : fallbackTone;
  const outRows = byStatus('OUT_OF_SCOPE');
  const eventCautionCount = rows.filter((r) => visibleTags(r, isAdmin).some((t) => t.includes('イベント確認') || t.includes('決算直前注意'))).length;
  const eventBeforeCount = rows.filter((r) => visibleTags(r, isAdmin).some((t) => t.includes('イベント前確認') || t.includes('決算前除外'))).length;

  return (
    <>
      <header className="hero premium-hero">
        <div className="eyebrow">Premium Swing Screening {isAdmin ? ' / Admin' : ''}</div>
        <h1>銘柄整理ダッシュボード</h1>
        <p className="hero-lead">登録銘柄について、テクニカル条件とイベント情報を機械的に整理します。</p>
        <p className="meta">ユーザ: {userId} / 最終更新: {lastUpdated} / 毎日16:30 JST頃から更新開始</p>
      </header>
      <main className="wrap premium-wrap">
        <section className="section poc-access-notice">
          <p>本ツールは、登録銘柄や市場データをもとに確認対象を整理するための検証用ツールです。</p>
          <p>特定の銘柄の売買を推奨するものではありません。</p>
          <p>最終的な投資判断はご自身で行ってください。</p>
        </section>
        {errorMessage ? <div className="alert">エラー: {errorMessage}</div> : null}

        <section className="market-panel market-panel-v2">
          <div className="market-main">
            <span className="panel-label">市場環境メーター</span>
            <h2>{tone.label} <em>{tone.stars}</em></h2>
            <p>{tone.comment}</p>
            {isAdmin ? <small>{marketEnv?.note || '市況データ未取得時は、登録銘柄全体の分布をもとに暫定判定します。'}</small> : null}
          </div>
          <div className="index-grid">
            {(marketEnv?.indices || []).length ? (marketEnv?.indices || []).map((item) => <IndexCard key={item.key || item.ticker} item={item} isAdmin={isAdmin} />) : (
              <>
                <div className="index-card"><div className="index-head"><b>日経平均</b><span>^N225</span></div><p className="index-error">市況データ未取得</p></div>
                <div className="index-card"><div className="index-head"><b>グロース250参考</b><span>2516.T</span></div><p className="index-error">市況データ未取得</p></div>
              </>
            )}
          </div>
        </section>

        <section className="summary-strip">
          <div><span>登録銘柄数</span><b>{rows.length}</b></div>
          <div><span>{isAdmin ? '確認優先' : '条件一致銘柄'}</span><b>{byStatus('WATCH_PRIORITY').length}</b></div>
          <div><span>イベント確認</span><b>{eventCautionCount}</b></div>
          <div><span>イベント前確認</span><b>{eventBeforeCount}</b></div>
          <div><span>{isAdmin ? '条件判定対象外' : '参考確認'}</span><b>{outRows.length}</b></div>
        </section>

        <Section title={isAdmin ? '確認優先銘柄' : '条件一致銘柄'} subtitle="あらかじめ定めた条件への一致が相対的に多い銘柄です。" rows={byStatus('WATCH_PRIORITY')} userId={userId} isAdmin={isAdmin} />
        <Section title="通常確認" subtitle="登録銘柄のうち、通常確認として整理されている銘柄です。" rows={byStatus('WATCH_LIST')} userId={userId} isAdmin={isAdmin} />
        <Section title="イベント確認・確認" subtitle="決算日や開示情報などのイベント確認が必要な銘柄です。" rows={[...byStatus('EARNINGS_CAUTION'), ...byStatus('EARNINGS_EXCLUDE')]} userId={userId} isAdmin={isAdmin} />
        <Section title={isAdmin ? '条件判定対象外' : '参考確認'} subtitle="条件判定対象外または参考確認として整理されている銘柄です。" rows={outRows} userId={userId} isAdmin={isAdmin} />

        <section className="section guide-section">
          <h2>確認の流れ</h2>
          <ol>
            <li>条件一致が多い銘柄の指標を確認する。</li>
            <li>イベント前後の銘柄は、決算日や開示情報を確認する。</li>
            <li>気になる銘柄は、利用者自身の投資方針に照らして判断する。</li>
            <li>本ツールの表示は売買判断を示すものではありません。</li>
          </ol>
          <p className="disclaimer">本ツールは、株価・出来高等の公開情報をもとに、あらかじめ定めた条件への一致状況を機械的に整理するものです。特定銘柄の取得、売却、保有を推奨するものではありません。表示される条件整理点、ラベル、並び順は、将来の値上がり、利益獲得可能性、投資成果を示すものではありません。投資判断は利用者ご自身の責任で行ってください。</p>
          <p className="disclaimer">表示される銘柄群は、PoC検証用のサンプル銘柄またはユーザー登録銘柄です。売買推奨銘柄ではありません。</p>
          <p className="disclaimer">条件整理点は、あらかじめ定めた確認条件への一致状況を数値化したものであり、売買判断、将来の値上がり可能性、投資成果を示すものではありません。</p>
          <p className="disclaimer">本ツールは外部データソースから取得した情報を利用しています。データの正確性、完全性、即時性、継続提供を保証するものではありません。</p>
          <div className="footer-links"><Link className="btn" href={`/u/${userId}/admin`}>登録銘柄CSV更新ページへ</Link></div>
        </section>
      </main>
    </>
  );
}
