/**
 * Portfolio simulation using real historical prices.
 * Mirrors the Python version's approach: buy fractional units at first price,
 * then track daily portfolio value.
 */

export function simulate(priceData, allocations, initialAmount) {
  const tickers = Object.keys(allocations).filter(
    (t) => priceData[t]?.length > 0 && allocations[t] > 0
  );
  if (tickers.length === 0) return [];

  // Collect all unique dates
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

  // Find first date where all selected tickers have data
  const startIdx = dates.findIndex((d) =>
    tickers.every((t) => priceMap[t].has(d))
  );
  if (startIdx === -1) return [];
  const activeDates = dates.slice(startIdx);

  // Compute fractional units bought at first available price
  const units = {};
  tickers.forEach((ticker) => {
    const firstPrice = priceMap[ticker].get(activeDates[0]);
    units[ticker] = (initialAmount * allocations[ticker]) / firstPrice;
  });

  // Build chart data: daily portfolio values per ticker + total
  return activeDates.map((date) => {
    const point = { date };
    let total = 0;
    tickers.forEach((ticker) => {
      const price = priceMap[ticker].get(date);
      if (price != null && units[ticker]) {
        const value = price * units[ticker];
        point[ticker] = Math.round(value * 100) / 100;
        total += value;
      }
    });
    point['Total Portfolio'] = Math.round(total * 100) / 100;
    return point;
  });
}

export function computeStats(
  chartData,
  tickers,
  allocations,
  initialAmount,
  assetNames,
  assetColors
) {
  if (chartData.length === 0) return [];

  const first = chartData[0];
  const last = chartData[chartData.length - 1];
  const days =
    (new Date(last.date) - new Date(first.date)) / (1000 * 60 * 60 * 24);

  const stats = [];

  tickers.forEach((ticker) => {
    const iv = first[ticker];
    const fv = last[ticker];
    if (iv == null || fv == null) return;

    const totalReturn = (fv - iv) / iv;
    const annualized =
      days > 0 ? Math.pow(fv / iv, 365.25 / days) - 1 : 0;

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
      allocation: allocations[ticker],
    });
  });

  // Portfolio-level stats
  const piv = first['Total Portfolio'];
  const pfv = last['Total Portfolio'];
  if (piv && pfv) {
    let peak = -Infinity;
    let maxDD = 0;
    chartData.forEach((p) => {
      const v = p['Total Portfolio'];
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
      allocation: null,
      isPortfolio: true,
    });
  }

  return stats;
}
