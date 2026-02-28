/**
 * Portfolio simulation using real historical prices.
 * Supports multiple buy/sell transactions per asset.
 * transactions: [{ id, ticker, type: 'buy'|'sell'|'deposit'|'withdraw', amount, date, price? }]
 * When tx.price is provided, it is used instead of the day's closing price for unit calculation.
 * 'deposit' is treated as 'buy', 'withdraw' is treated as 'sell'.
 */

const isBuyType = (type) => type === 'buy' || type === 'deposit';
const isSellType = (type) => type === 'sell' || type === 'withdraw';

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
      const price = tx.price || priceMap[ticker].get(tx.date);
      if (!price) return;
      if (isBuyType(tx.type)) {
        units += tx.amount / price;
      } else {
        units = Math.max(0, units - tx.amount / price);
      }
      changes.push({ date: tx.date, totalUnits: units });
    });
    tickerUnitChanges[ticker] = changes;
  });

  // Track whether any ticker has ever had a transaction by this date
  let everActive = false;

  return dates
    .map((date) => {
      const point = { date };
      let total = 0;
      let anyHasHistory = false;

      tickers.forEach((ticker) => {
        const changes = tickerUnitChanges[ticker];
        if (!changes?.length) return;
        // Check if any transaction has occurred for this ticker by this date
        const hasStarted = changes[0].date <= date;
        if (!hasStarted) return;
        anyHasHistory = true;

        let units = 0;
        for (const ch of changes) {
          if (ch.date <= date) units = ch.totalUnits;
          else break;
        }

        const price = priceMap[ticker].get(date);
        if (price != null) {
          const value = units > 0 ? price * units : 0;
          point[ticker] = Math.round(value * 100) / 100;
          total += value;
        }
      });

      if (anyHasHistory) {
        everActive = true;
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
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  tickers.forEach((ticker) => {
    const fv = last[ticker];
    const firstPoint = chartData.find((p) => p[ticker] != null);
    if (!firstPoint || fv == null) return;

    const tickerTxs = transactions.filter((tx) => tx.ticker === ticker);
    
    // Calculate deposits (buys) and withdrawals (sells)
    let deposits = 0;
    let withdrawals = 0;
    
    tickerTxs.forEach((tx) => {
      if (isBuyType(tx.type)) {
        deposits += tx.amount;
      } else {
        withdrawals += tx.amount;
      }
    });
    
    totalDeposits += deposits;
    totalWithdrawals += withdrawals;
    
    // For return calculation, use deposits
    const netInvested = deposits;

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
      totalDeposits: deposits,
      totalWithdrawals: withdrawals,
    });
  });

  // Portfolio-level stats
  const firstPortfolio = chartData.find((p) => p['Total Portfolio'] != null);
  const pfv = last['Total Portfolio'];
  if (firstPortfolio && pfv != null) {
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
      totalReturn: totalDeposits > 0 ? (pfv + totalWithdrawals - totalDeposits) / totalDeposits : 0,
      annualizedReturn:
        days > 0 && totalDeposits > 0
          ? Math.pow((pfv + totalWithdrawals) / totalDeposits, 365.25 / days) - 1
          : 0,
      maxDrawdown: maxDD,
      color: '#1e293b',
      totalDeposits,
      totalWithdrawals,
      isPortfolio: true,
    });
  }

  return stats;
}
