export function shikihoStockUrl(code: unknown) {
  const normalized = String(code ?? '').trim().toUpperCase().replace(/\.T$/i, '');
  return `https://shikiho.toyokeizai.net/stocks/${encodeURIComponent(normalized)}`;
}

