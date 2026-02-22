/**
 * Portfolio simulation using real historical prices.
 * Each asset has its own invested amount and may start at different dates.
 */

export function simulate(priceData, assetConfigs) {
  // assetConfigs: { [ticker]: { amount } }
  const tickers = Object.keys(assetConfigs).filter(
    (t) => priceData[t]?.length > 0 && assetConfigs[t].amount > 0
  );
  if (tickers.length === 0) return [];

  // Collect all unique dates across all assets
  const dateSet = new Set();
  tickers.forEach((t) => priceData[t].forEach((p) => dateSet.add(p.date)));
  const dates = [...dateSet].sort();

  // Build price maps and forward-fill gaps
  const priceMap = {};
  tickers.forEach((ticker) => {
    const map = new Map();
    priceData[ticker].forEach((p) => map.set(p.date, p.price));
    let last = null;
    dates.forEach((date) => {
      if (map.has(date)) last = map.get(date);
      else if (last != null) map.set(date, last);
    });
    priceMap[ticker] = map;
  });

  // For each ticker, find its first available date and compute units bought
  const units = {};
  const tickerStartDate = {};
  tickers.forEach((ticker) => {
    const firstDate = dates.find((d) => priceMap[ticker].has(d));
    if (!firstDate) return;
    tickerStartDate[ticker] = firstDate;
    units[ticker] = assetConfigs[ticker].amount / priceMap[ticker].get(firstDate);
  });

  const activeTickers = tickers.filter((t) => units[t] != null);
  if (activeTickers.length === 0) return [];

  // Build chart data — each ticker appears only from its start date
  return dates
    .map((date) => {
      const point = { date };
      let total = 0;
      let anyActive = false;
      activeTickers.forEach((ticker) => {
        if (date < tickerStartDate[ticker]) return;
        const price = priceMap[ticker].get(date);
        if (price != null) {
          const value = price * units[ticker];
          point[ticker] = Math.round(value * 100) / 100;
          total += value;
          anyActive = true;
        }
      });
      if (anyActive) {
        point['Total Portfolio'] = Math.round(total * 100) / 100;
      }
      return point;
    })
    .filter((p) => p['Total Portfolio'] != null);
}

export function computeStats(
  chartData,
  tickers,
  assetConfigs,
  assetNames,
  assetColors
) {
  if (chartData.length === 0) return [];

  const last = chartData[chartData.length - 1];
  const stats = [];
  let totalInvested = 0;

  tickers.forEach((ticker) => {
    const amount = assetConfigs[ticker].amount;
    // Find the first chart point where this ticker has data
    const firstPoint = chartData.find((p) => p[ticker] != null);
    const fv = last[ticker];
    if (!firstPoint || fv == null) return;

    const iv = firstPoint[ticker];
    totalInvested += amount;

    const days =
      (new Date(last.date) - new Date(firstPoint.date)) / (1000 * 60 * 60 * 24);
    const totalReturn = (fv - iv) / iv;
    const annualized = days > 0 ? Math.pow(fv / iv, 365.25 / days) - 1 : 0;

    // Max drawdown
    let peak = -Infinity;
    let maxDD = 0;
    chartData.forEach((p) => {
      const v = p[ticker];
      if (v == null) return;
      if (v > peak) peak = v;
      const dd = (v - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    });

    stats.push({
      name: assetNames[ticker] || ticker,
      ticker,
      finalValue: fv,
      totalReturn,
      annualizedReturn: annualized,
      maxDrawdown: maxDD,
      color: assetColors[ticker] || '#94a3b8',
      amount,
    });
  });

  // Portfolio-level stats
  const firstPortfolio = chartData.find((p) => p['Total Portfolio'] != null);
  const pfv = last['Total Portfolio'];
  if (firstPortfolio && pfv) {
    const piv = firstPortfolio['Total Portfolio'];
    const days =
      (new Date(last.date) - new Date(firstPortfolio.date)) / (1000 * 60 * 60 * 24);

    let peak = -Infinity;
    let maxDD = 0;
    chartData.forEach((p) => {
      const v = p['Total Portfolio'];
      if (v == null) return;
      if (v > peak) peak = v;
      const dd = (v - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    });

    stats.unshift({
      name: 'Total Portfolio',
      ticker: null,
      finalValue: pfv,
      totalReturn: (pfv - piv) / piv,
      annualizedReturn:
        days > 0 ? Math.pow(pfv / piv, 365.25 / days) - 1 : 0,
      maxDrawdown: maxDD,
      color: '#1e293b',
      amount: totalInvested,
      isPortfolio: true,
    });
  }

  return stats;
}
