import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  BarChart3, ArrowUpRight, ArrowDownRight, Percent,
  DollarSign, AlertCircle, Search, Plus, PieChart, Loader2,
  Settings, History, Zap, CheckCircle2, X, Lock, Unlock,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { searchTickers, fetchPrices } from './api';
import { simulate, computeStats } from './simulation';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

const formatCurrency = (val) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(val);

const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

const fiveYearsAgo = new Date();
fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

const App = () => {
  // --- Parameters ---
  const [initialAmount, setInitialAmount] = useState(10000);
  const [startDate, setStartDate] = useState(fiveYearsAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);

  // --- Search ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // --- Portfolio ---
  const [selectedAssets, setSelectedAssets] = useState({});
  const [allocations, setAllocations] = useState({});
  const [lockedTickers, setLockedTickers] = useState(new Set());
  const [allocationMode, setAllocationMode] = useState('percent');

  // --- Simulation ---
  const [priceCache, setPriceCache] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [stats, setStats] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const colorIdx = useRef(0);

  // --- Derived ---
  const selectedTickers = useMemo(() => Object.keys(allocations), [allocations]);
  const totalAllocated = useMemo(
    () => selectedTickers.reduce((s, id) => s + (allocations[id] || 0), 0),
    [selectedTickers, allocations],
  );
  const isAllocationValid = useMemo(
    () => Math.abs(totalAllocated - 1) < 0.001,
    [totalAllocated],
  );

  // --- Search via Yahoo Finance ---
  const handleSearch = useCallback(async (query) => {
    const q = query.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    setIsSearching(true);
    setFetchError(null);
    try {
      const results = await searchTickers(q);
      setSearchResults(results);
    } catch {
      setFetchError('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setIsSearching(false); return; }
    const t = setTimeout(() => handleSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, handleSearch]);

  // --- Add / Remove with auto-redistribution ---
  const addAsset = useCallback((symbol, name) => {
    const ticker = symbol.toUpperCase();
    if (allocations[ticker] !== undefined) return;
    const color = COLORS[colorIdx.current % COLORS.length];
    colorIdx.current++;
    setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    // Redistribute unlocked assets equally, respecting locks
    setAllocations((prev) => {
      const next = { ...prev };
      const lockedTotal = [...lockedTickers].reduce((s, t) => s + (next[t] || 0), 0);
      const unlocked = Object.keys(next).filter((t) => !lockedTickers.has(t));
      const allUnlocked = [...unlocked, ticker];
      const available = Math.max(0, 1 - lockedTotal);
      const eq = available / allUnlocked.length;
      allUnlocked.forEach((t) => (next[t] = eq));
      return next;
    });
    setSearchQuery('');
    setSearchResults([]);
  }, [allocations, lockedTickers]);

  const removeAsset = useCallback((ticker) => {
    setSelectedAssets((prev) => { const n = { ...prev }; delete n[ticker]; return n; });
    setLockedTickers((prev) => { const n = new Set(prev); n.delete(ticker); return n; });
    // Redistribute remaining unlocked assets to fill the gap
    setAllocations((prev) => {
      const n = { ...prev };
      delete n[ticker];
      const remaining = Object.keys(n);
      if (remaining.length === 0) return n;
      const unlocked = remaining.filter((t) => !lockedTickers.has(t));
      const lockedTotal = remaining.filter((t) => lockedTickers.has(t)).reduce((s, t) => s + n[t], 0);
      const available = Math.max(0, 1 - lockedTotal);
      if (unlocked.length > 0) {
        const unlTotal = unlocked.reduce((s, t) => s + n[t], 0);
        if (unlTotal > 0) {
          unlocked.forEach((t) => (n[t] = (n[t] / unlTotal) * available));
        } else {
          unlocked.forEach((t) => (n[t] = available / unlocked.length));
        }
      }
      return n;
    });
  }, [lockedTickers]);

  const toggleLock = useCallback((ticker) => {
    setLockedTickers((prev) => {
      const n = new Set(prev);
      if (n.has(ticker)) n.delete(ticker); else n.add(ticker);
      return n;
    });
  }, []);

  // --- Slider change: redistribute remaining among unlocked assets ---
  const handleSliderChange = useCallback((changedTicker, newPct) => {
    setAllocations((prev) => {
      const others = Object.keys(prev).filter((t) => t !== changedTicker && !lockedTickers.has(t));
      const lockedOthers = Object.keys(prev).filter((t) => t !== changedTicker && lockedTickers.has(t));
      const lockedTotal = lockedOthers.reduce((s, t) => s + prev[t], 0);
      // Cap newPct so locked assets aren't violated
      const maxPct = Math.max(0, 1 - lockedTotal);
      const capped = Math.min(newPct, maxPct);
      const remaining = Math.max(0, 1 - capped - lockedTotal);
      const next = { ...prev, [changedTicker]: capped };
      if (others.length === 0) return next;
      const oldOthersTotal = others.reduce((s, t) => s + prev[t], 0);
      if (oldOthersTotal > 0) {
        others.forEach((t) => { next[t] = (prev[t] / oldOthersTotal) * remaining; });
      } else {
        others.forEach((t) => { next[t] = remaining / others.length; });
      }
      return next;
    });
  }, [lockedTickers]);

  // --- Auto-fetch prices whenever tickers or date range change ---
  useEffect(() => {
    const active = selectedTickers.filter((t) => allocations[t] > 0);
    if (active.length === 0) return;

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setIsSimulating(true);
      setFetchError(null);
      try {
        const prices = await fetchPrices(active, startDate, endDate);
        if (!cancelled) setPriceCache(prices);
      } catch {
        if (!cancelled) setFetchError('Failed to fetch market data.');
      } finally {
        if (!cancelled) setIsSimulating(false);
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(debounce); };
  }, [selectedTickers, allocations, startDate, endDate]);

  // --- Recompute chart when prices or allocations change ---
  useEffect(() => {
    if (!priceCache || !isAllocationValid) return;
    const active = selectedTickers.filter(
      (t) => allocations[t] > 0 && priceCache[t]?.length > 0,
    );
    if (active.length === 0) { setChartData([]); setStats([]); return; }

    const filteredAlloc = Object.fromEntries(active.map((t) => [t, allocations[t]]));
    const data = simulate(priceCache, filteredAlloc, initialAmount);
    setChartData(data);

    const names = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.name]),
    );
    const colors = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.color]),
    );
    setStats(computeStats(data, active, filteredAlloc, initialAmount, names, colors));
  }, [priceCache, allocations, initialAmount, isAllocationValid, selectedTickers, selectedAssets]);

  // --- Active tickers for chart rendering ---
  const chartTickers = selectedTickers.filter(
    (t) => allocations[t] > 0 && priceCache?.[t],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-all"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200">
              <BarChart3 className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-800 uppercase">Investo</h1>
              <span className="bg-emerald-50 text-emerald-700 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider w-fit mt-0.5">
                <Zap className="w-2 h-2 fill-current" /> Real Market Data
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Initial Investment</p>
              <p className="text-lg font-black text-blue-600">{formatCurrency(initialAmount)}</p>
            </div>
            {isSimulating && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          {sidebarOpen && (
          <aside className="lg:col-span-4 space-y-6">

            {/* Window */}
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Window
              </h3>
              <div className="space-y-4">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                  <input
                    type="number" value={initialAmount}
                    onChange={(e) => setInitialAmount(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-8 pr-4 text-xl font-black focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
            </div>

            {/* Add Assets button */}
            <button
              onClick={() => setShowSearch(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
            >
              <Plus className="w-4 h-4" /> Add Assets
            </button>

            {/* Allocation */}
            {selectedTickers.length > 0 && (
            <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <PieChart className="w-4 h-4" /> Allocation
                </h3>
                <div className="flex items-center gap-2">
                  <div className="flex bg-white/10 rounded-lg p-0.5">
                    <button onClick={() => setAllocationMode('percent')} className={`p-1.5 rounded-md transition-all ${allocationMode === 'percent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>
                      <Percent className="w-3 h-3" />
                    </button>
                    <button onClick={() => setAllocationMode('amount')} className={`p-1.5 rounded-md transition-all ${allocationMode === 'amount' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>
                      <DollarSign className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      const unlocked = selectedTickers.filter((t) => !lockedTickers.has(t));
                      if (unlocked.length === 0) return;
                      const lockedTotal = selectedTickers.filter((t) => lockedTickers.has(t)).reduce((s, t) => s + (allocations[t] || 0), 0);
                      const eq = (1 - lockedTotal) / unlocked.length;
                      const n = { ...allocations };
                      unlocked.forEach((t) => (n[t] = Math.max(0, eq)));
                      setAllocations(n);
                    }}
                    className="text-[10px] font-bold bg-white/10 text-white/60 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-all"
                  >
                    Equal Split
                  </button>
                </div>
              </div>

              <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                {selectedTickers.map((ticker) => {
                  const asset = selectedAssets[ticker];
                  if (!asset) return null;
                  const pct = allocations[ticker] || 0;
                  const isLocked = lockedTickers.has(ticker);
                  const amt = Math.round(pct * initialAmount);
                  return (
                    <div key={ticker} className={`border rounded-2xl p-3 space-y-2 transition-all ${isLocked ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: asset.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{asset.name} ({ticker})</p>
                        </div>
                        <span className="text-sm font-black tabular-nums text-right" style={{ color: asset.color }}>
                          {allocationMode === 'percent' ? `${Math.round(pct * 100)}%` : formatCurrency(amt)}
                        </span>
                        <button onClick={() => toggleLock(ticker)} className={`p-1 rounded-lg transition-all ${isLocked ? 'text-amber-400 bg-amber-400/10' : 'text-white/20 hover:text-white/40'}`} title={isLocked ? 'Unlock' : 'Lock'}>
                          {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        </button>
                        <button onClick={() => removeAsset(ticker)} className="text-rose-400 hover:text-rose-300 p-0.5">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {allocationMode === 'percent' ? (
                        <input
                          type="range"
                          min={0} max={100} step={1}
                          value={Math.round(pct * 100)}
                          onChange={(e) => handleSliderChange(ticker, parseInt(e.target.value) / 100)}
                          disabled={isLocked}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-50"
                          style={{
                            background: `linear-gradient(to right, ${asset.color} ${pct * 100}%, rgba(255,255,255,0.1) ${pct * 100}%)`,
                          }}
                        />
                      ) : (
                        <input
                          type="range"
                          min={0} max={initialAmount} step={Math.max(1, Math.round(initialAmount / 100))}
                          value={amt}
                          onChange={(e) => handleSliderChange(ticker, parseInt(e.target.value) / initialAmount)}
                          disabled={isLocked}
                          className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-50"
                          style={{
                            background: `linear-gradient(to right, ${asset.color} ${pct * 100}%, rgba(255,255,255,0.1) ${pct * 100}%)`,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="p-4 rounded-2xl border bg-emerald-500/10 border-emerald-500/20">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Total</p>
                    <p className="text-xl font-black text-emerald-400">{formatPercent(totalAllocated)}</p>
                  </div>
                  <p className="text-[10px] font-bold text-white/30">{formatCurrency(Math.round(totalAllocated * initialAmount))}</p>
                </div>
              </div>
            </div>
            )}
          </aside>
          )}

          {/* ── Main ─────────────────────────────────────────────────────── */}
          <main className={`${sidebarOpen ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-8`}>

            {/* Chart */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200 h-[550px] flex flex-col overflow-hidden relative">
              <div className="flex justify-between items-start mb-8 relative z-10">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">Portfolio Performance</h2>
                  <p className="text-sm text-slate-400 italic font-medium">Historical data from Yahoo Finance</p>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative z-10">
                {isSimulating ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
                    <p className="font-bold text-sm">Fetching market data…</p>
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center shadow-inner">
                      <BarChart3 className="w-10 h-10 text-slate-300" />
                    </div>
                    <div className="text-center">
                      <p className="font-black text-slate-800 text-lg uppercase tracking-tight">No Data Yet</p>
                      <p className="text-sm">Add assets, set allocations to 100%, and click Simulate</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                        axisLine={false} tickLine={false} minTickGap={60}
                        tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                        axisLine={false} tickLine={false}
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '20px' }}
                        itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                        formatter={(v, n) => [formatCurrency(v), n]}
                        labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold' }} />
                      {chartTickers.length > 1 && (
                        <Line type="monotone" dataKey="Total Portfolio" stroke="#0f172a" strokeWidth={6} dot={false} />
                      )}
                      {chartTickers.map((ticker) => {
                        const asset = selectedAssets[ticker];
                        if (!asset) return null;
                        return (
                          <Line
                            key={ticker}
                            type="monotone"
                            dataKey={ticker}
                            name={`${asset.name} (${ticker})`}
                            stroke={asset.color}
                            strokeWidth={chartTickers.length > 1 ? 2 : 3}
                            strokeDasharray={chartTickers.length > 1 ? '4 4' : undefined}
                            dot={false}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Stats Cards */}
            {stats.length > 0 && (() => {
              const portfolio = stats.find((s) => s.isPortfolio);
              const assets = stats.filter((s) => !s.isPortfolio);
              return (
                <div className="space-y-6">
                  {/* Combined card – full width */}
                  {portfolio && (
                    <div className="p-6 rounded-[2rem] border bg-slate-900 text-white border-slate-800 shadow-2xl transition-all hover:translate-y-[-4px]">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-blue-600 w-fit mb-2">Combined</div>
                          <p className="text-3xl font-black tracking-tight">{formatCurrency(portfolio.finalValue)}</p>
                          <p className="text-xs font-bold text-slate-400 mt-1">Total Portfolio</p>
                        </div>
                        <div className="flex gap-6">
                          <div className="text-center">
                            <p className={`text-xl font-black ${portfolio.totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {portfolio.totalReturn >= 0 ? '+' : ''}{formatPercent(portfolio.totalReturn)}
                            </p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Return</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-black text-slate-300">{formatPercent(portfolio.annualizedReturn)}</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Ann.</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-black text-rose-400">{formatPercent(portfolio.maxDrawdown)}</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Max DD</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Individual asset cards – 3 per row */}
                  {assets.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {assets.map((stat, idx) => (
                        <div key={idx} className="p-6 rounded-[2rem] border bg-white border-slate-200 shadow-sm transition-all hover:translate-y-[-4px]">
                          <div className="flex justify-between items-start mb-4">
                            <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-500">
                              {stat.ticker}
                            </div>
                            <div className={`flex items-center gap-1 text-xs font-black ${stat.totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {stat.totalReturn >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                              {formatPercent(stat.totalReturn)}
                            </div>
                          </div>
                          <h4 className="text-xs font-bold mb-1 truncate text-slate-500">
                            {stat.name} ({Math.round(stat.allocation * 100)}%)
                          </h4>
                          <p className="text-2xl font-black tracking-tight">{formatCurrency(stat.finalValue)}</p>
                          <div className="mt-2 flex gap-3 text-[10px] font-bold">
                            <span className="text-slate-400">Ann. {formatPercent(stat.annualizedReturn)}</span>
                            <span className="text-rose-400">DD {formatPercent(stat.maxDrawdown)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Summary Table */}
            {stats.length > 0 && (
              <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/20">
                  <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2 uppercase">
                    <History className="w-5 h-5 text-slate-400" /> Summary
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left min-w-[700px]">
                    <thead className="text-slate-400 text-[10px] font-black uppercase tracking-widest bg-slate-50/50">
                      <tr>
                        <th className="px-8 py-4">Asset</th>
                        <th className="px-8 py-4 text-right">Allocation</th>
                        <th className="px-8 py-4 text-right">Invested</th>
                        <th className="px-8 py-4 text-right">Final Value</th>
                        <th className="px-8 py-4 text-right">Return</th>
                        <th className="px-8 py-4 text-right">Ann. Return</th>
                        <th className="px-8 py-4 text-right">Max DD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.filter((s) => !s.isPortfolio).map((stat, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-4">
                              <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: stat.color }} />
                              <span className="font-black text-sm">{stat.name} ({stat.ticker})</span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-right font-bold text-slate-500 text-sm">{Math.round(stat.allocation * 100)}%</td>
                          <td className="px-8 py-6 text-right font-bold text-slate-400 text-sm">{formatCurrency(stat.allocation * initialAmount)}</td>
                          <td className="px-8 py-6 text-right font-black text-sm">{formatCurrency(stat.finalValue)}</td>
                          <td className="px-8 py-6 text-right">
                            <span className={`font-black text-sm ${stat.totalReturn >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {stat.totalReturn >= 0 ? '+' : ''}{formatPercent(stat.totalReturn)}
                            </span>
                          </td>
                          <td className="px-8 py-6 text-right font-bold text-sm text-slate-500">{formatPercent(stat.annualizedReturn)}</td>
                          <td className="px-8 py-6 text-right font-bold text-sm text-rose-500">{formatPercent(stat.maxDrawdown)}</td>
                        </tr>
                      ))}
                      {stats.find((s) => s.isPortfolio) && (() => {
                        const p = stats.find((s) => s.isPortfolio);
                        return (
                          <tr className="bg-slate-900 text-white border-t border-slate-800">
                            <td className="px-8 py-10 font-black rounded-bl-[2.5rem]">Portfolio Total</td>
                            <td className="px-8 py-10 text-right font-black">100%</td>
                            <td className="px-8 py-10 text-right font-bold opacity-40">{formatCurrency(initialAmount)}</td>
                            <td className="px-8 py-10 text-right font-black text-blue-400 text-lg">{formatCurrency(p.finalValue)}</td>
                            <td className="px-8 py-10 text-right font-black text-lg">
                              {p.totalReturn >= 0 ? '+' : ''}{formatPercent(p.totalReturn)}
                            </td>
                            <td className="px-8 py-10 text-right font-bold">{formatPercent(p.annualizedReturn)}</td>
                            <td className="px-8 py-10 text-right font-bold text-rose-400 rounded-br-[2.5rem]">{formatPercent(p.maxDrawdown)}</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Search Modal */}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}>
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md mx-4 p-6 space-y-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Search className="w-4 h-4" /> Add Assets
              </h3>
              <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search (Google, BTC, Amazon)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-slate-100 border-none rounded-xl py-3.5 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner transition-all"
              />
              {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />}
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar pb-2">
              {isSearching && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-200 animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-2/3 bg-slate-200 rounded animate-pulse" />
                        <div className="h-2 w-1/2 bg-slate-100 rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!isSearching && searchResults.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 px-1">Results</p>
                  {searchResults.map((r) => (
                    <div key={r.symbol} className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] bg-slate-400">
                            {r.symbol.slice(0, 3)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-black truncate">{r.name}</h4>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">{r.symbol} · {r.type || 'N/A'}</p>
                          </div>
                        </div>
                        {allocations[r.symbol.toUpperCase()] !== undefined ? (
                          <div className="p-2 bg-emerald-50 rounded-xl">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          </div>
                        ) : (
                          <button
                            onClick={() => addAsset(r.symbol, r.name)}
                            className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg transition-all active:scale-90"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {fetchError && !isSearching && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-[10px] font-bold flex items-center gap-2">
                  <AlertCircle className="w-3 h-3 shrink-0" /> {fetchError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
    </div>
  );
};

export default App;
