/**
 * Yahoo Finance API utilities.
 * Calls go through Vite dev proxy to avoid CORS issues.
 */

export async function searchTickers(query, maxResults = 6) {
  const url = `/api/search/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${maxResults}&newsCount=0&enableFuzzyQuery=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  const data = await res.json();
  return (data.quotes || []).map((q) => ({
    symbol: q.symbol,
    name: q.shortname || q.longname || q.symbol,
    type: q.quoteType || '',
    exchange: q.exchange || '',
  }));
}

export async function fetchPrices(assetDateRanges) {
  // assetDateRanges: { [ticker]: { startDate, endDate } }
  const results = {};

  await Promise.all(
    Object.entries(assetDateRanges).map(async ([ticker, { startDate, endDate }]) => {
      try {
        const period1 = Math.floor(new Date(startDate).getTime() / 1000);
        const period2 = Math.floor(new Date(endDate).getTime() / 1000);
        const url = `/api/chart/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const result = data.chart?.result?.[0];
        if (!result?.timestamp) return;

        const timestamps = result.timestamp;
        const closes =
          result.indicators?.adjclose?.[0]?.adjclose ||
          result.indicators?.quote?.[0]?.close ||
          [];

        results[ticker] = timestamps
          .map((ts, i) => ({
            date: new Date(ts * 1000).toISOString().split('T')[0],
            price: closes[i],
          }))
          .filter((d) => d.price != null);
      } catch {
        // Skip failed tickers silently
      }
    })
  );

  return results;
}
