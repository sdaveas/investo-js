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
  // Returns { prices: { [ticker]: [{date,price}] }, currencies: { [ticker]: string } }
  const prices = {};
  const currencies = {};

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

        // Capture the asset's native currency from Yahoo Finance metadata
        if (result.meta?.currency) {
          currencies[ticker] = result.meta.currency.toUpperCase();
        }

        const timestamps = result.timestamp;
        const closes =
          result.indicators?.adjclose?.[0]?.adjclose ||
          result.indicators?.quote?.[0]?.close ||
          [];

        prices[ticker] = timestamps
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

  return { prices, currencies };
}

export async function fetchExchangeRates(startDate, endDate) {
  // Fetches EUR→USD daily exchange rates using the EURUSD=X ticker
  // Returns [{ date, rate }] where rate is how many USD per 1 EUR
  try {
    const period1 = Math.floor(new Date(startDate).getTime() / 1000);
    const period2 = Math.floor(new Date(endDate).getTime() / 1000);
    const url = `/api/chart/v8/finance/chart/EURUSD%3DX?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result?.timestamp) return [];
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];
    return timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        rate: closes[i],
      }))
      .filter((d) => d.rate != null);
  } catch {
    return [];
  }
}

export async function fetchIntradayPrices(ticker, date) {
  // Fetch hourly prices for a specific trading day
  // Returns { prices: [...], currency: string } or null
  const dayStart = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000);
  const dayEnd = dayStart + 86400; // +1 day
  const url = `/api/chart/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${dayStart}&period2=${dayEnd}&interval=1h&includePrePost=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const timestamps = result.timestamp;
    const quotes = result.indicators?.quote?.[0];
    if (!quotes) return null;
    const currency = result.meta?.currency?.toUpperCase() || null;
    const prices = timestamps
      .map((ts, i) => ({
        time: new Date(ts * 1000),
        hour: new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        price: quotes.close?.[i],
        open: quotes.open?.[i],
        high: quotes.high?.[i],
        low: quotes.low?.[i],
      }))
      .filter((d) => d.price != null);
    return { prices, currency };
  } catch {
    return null;
  }
}

export async function fetchQuote(ticker) {
  const url = `/api/quote/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result?.meta?.regularMarketPrice) return null;
  return {
    price: result.meta.regularMarketPrice,
    date: new Date().toISOString().split('T')[0],
    marketState: result.meta.currentTradingPeriod?.regular ? 'regular' : null,
  };
}
