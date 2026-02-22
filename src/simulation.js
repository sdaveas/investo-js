/**
 * Portfolio simulation using real historical prices.
 * Supports multiple buy/sell transactions per asset.
 * transactions: [{ id, ticker, type: 'buy'|'sell', amount, date }]
 */

export function simulate(priceData, transactions) {
  const txByTicker = {};
  transactions.forEach((tx) => {
    if (!txByTicker[tx.ticker]) txByTicker[tx.ticker] = [];
    txByTicker[tx.ticker].push(tx);
  });

  const tickers = Object.keys(txByTicker).filter((t) => priceData[t]?.length > 0);
  if (tickers.length === 0) return [];

  tickers.forEach((t) => txByTicker[t].sort((a, b) => a.date.localeCompare(b.date)));

  const dateSet = new Set();
  tickers.forEach((t) => priceData[t].forEach((p) => dateSet.add(p.date)));
  // Include transaction dates so forward-fill covers non-trading days
  transactions.forEach((tx) => dateSet.add(tx.date));
  const dates = [...dateSet].sort();

  // Build price maps with forward-fill
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

  // Precompute cumulative units at each transaction date
  const tickerUnitChanges = {};
  tickers.forEach((ticker) => {
    let units = 0;
    const changes = [];
    txByTicker[ticker].forEach((tx) => {
      const price = priceMap[ticker].get(tx.date);
      if (!price) return;
      if (tx.type === 'buy') {
        units += tx.amount / price;
      } else {
        units = Math.max(0, units - tx.amount / price);
      }
      changes.push({ date: tx.date, totalUnits: units });
    });
    tickerUnitChanges[ticker] = changes;
  });

  return dates
    .map((date) => {
      const point = { date };
      let total = 0;
      let anyActive = false;

      tickers.forEach((ticker) => {
        const changes = tickerUnitChanges[ticker];
        if (!changes?.length) return;
        let units = 0;
        for (const ch of changes) {
          if (ch.date <= date) units = ch.totalUnits;
          else break;
        }
        if (units <= 0) return;

        const price = priceMap[ticker].get(date);
        if (price != null) {
          const value = price * units;
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

export function computeStats(chartData, tickers, transactions, assetNames, assetColors) {
  if (chartData.length === 0) return [];

  const last = chartData[chartData.length - 1];
  const stats = [];
  let totalNetInvested = 0;

  tickers.forEach((ticker) => {
    const fv = last[ticker];
    const firstPoint = chartData.find((p) => p[ticker] != null);
    if (!firstPoint || fv == null) return;

    const tickerTxs = transactions.filter((tx) => tx.ticker === ticker);
    const netInvested = tickerTxs.reduce(
      (s, tx) => s + (tx.type === 'buy' ? tx.amount : -tx.amount),
      0,
    );
    totalNetInvested += Math.max(0, netInvested);

    const days =
      (new Date(last.date) - new Date(firstPoint.date)) / (1000 * 60 * 60 * 24);
    const totalReturn = netInvested > 0 ? (fv - netInvested) / netInvested : 0;
    const annualized =
      days > 0 && netInvested > 0 ? Math.pow(fv / netInvested, 365.25 / days) - 1 : 0;

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
      netInvested: Math.max(0, netInvested),
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
      totalReturn: totalNetInvested > 0 ? (pfv - totalNetInvested) / totalNetInvested : 0,
      annualizedReturn:
        days > 0 && totalNetInvested > 0
          ? Math.pow(pfv / totalNetInvested, 365.25 / days) - 1
          : 0,
      maxDrawdown: maxDD,
      color: '#1e293b',
      netInvested: totalNetInvested,
      isPortfolio: true,
    });
  }

  return stats;
}
