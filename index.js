import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import {
  TrendingUp,
  Wallet,
  BarChart3,
  Info,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownRight,
  Percent,
  DollarSign,
  AlertCircle,
  Search,
  Plus,
  PieChart,
  Loader2,
  Globe,
  Settings,
  Trash2,
  Target,
  ExternalLink,
  History,
  Activity,
  Zap,
  CheckCircle2
} from 'lucide-react';

// --- Configuration ---
const apiKey = ""; // Managed by runtime environment

const INITIAL_LIBRARY = [
  { id: 'spy', name: 'S&P 500 ETF (SPY)', type: 'ETF', sector: 'Index', return: 0.18, vol: 0.15, color: '#3b82f6' },
  { id: 'qqq', name: 'Nasdaq 100 ETF (QQQ)', type: 'ETF', sector: 'Tech Index', return: 0.32, vol: 0.22, color: '#8b5cf6' },
];

const formatCurrency = (val) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

const App = () => {
  // --- Global State ---
  const [initialAmount, setInitialAmount] = useState(10000);
  const [startDate, setStartDate] = useState('2023-01-01');
  const [endDate, setEndDate] = useState('2025-01-01');
  const [searchQuery, setSearchQuery] = useState('');
  const [allocationMode, setAllocationMode] = useState('percent');

  // UI Discovery States
  const [isSearching, setIsSearching] = useState(false);
  const [loadingAssetId, setLoadingAssetId] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [fetchError, setFetchError] = useState(null);

  // Data State
  const [assetLibrary, setAssetLibrary] = useState(INITIAL_LIBRARY);
  const [allocations, setAllocations] = useState({ 'spy': 1.0 });
  const [simulationData, setSimulationData] = useState([]);
  const [stats, setStats] = useState([]);

  // --- Derived Logic ---
  const selectedAssetIds = useMemo(() => Object.keys(allocations), [allocations]);
  const totalAllocatedPercent = useMemo(() =>
    selectedAssetIds.reduce((sum, id) => sum + (allocations[id] || 0), 0)
  , [selectedAssetIds, allocations]);
  const isAllocationValid = useMemo(() => Math.abs(totalAllocatedPercent - 1) < 0.001, [totalAllocatedPercent]);

  // --- API Utility (High-Speed Logic) ---
  const callGemini = async (payload, context) => {
    const startTime = performance.now();
    const delays = [500, 1000];
    let lastError;

    console.log(`%c[API] Starting: ${context}`, "color: #3b82f6; font-weight: bold;");

    for (let i = 0; i < 2; i++) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const result = await response.json();
          const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
          const match = text?.match(/[\{\[](\s|.)*[\}\]]/);
          if (!match) throw new Error("Invalid structure");

          const parsed = JSON.parse(match[0]);
          const duration = (performance.now() - startTime).toFixed(0);
          console.log(`%c[API] ${context} done in ${duration}ms`, "color: #10b981; font-weight: bold;");
          return parsed;
        }

        lastError = new Error(`Engine Status: ${response.status}`);
        if (i < 1) await new Promise(res => setTimeout(res, delays[i]));
      } catch (err) {
        lastError = err;
        if (i < 1) await new Promise(res => setTimeout(res, delays[i]));
      }
    }
    throw lastError;
  };

  // --- STAGE 1: Fast Identification (Ticker Mapping Only) ---
  const searchAssets = useCallback(async (query) => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      setProposals([]);
      return;
    }

    console.log(`[Discovery] Search initiated: "${q}"`);
    setProposals([]);
    setIsSearching(true);
    setFetchError(null);

    // Optimized prompt: Just find tickers. No math = High Speed.
    const payload = {
      contents: [{ parts: [{ text: `Identify top 3 matching stock tickers for query: "${q}". Return JSON array: [{ "name": "Google", "id": "GOOGL", "desc": "Short tagline" }]. Use common brand names.` }] }],
      systemInstruction: { parts: [{ text: "You are a lightning-fast ticker index. Return raw JSON array ONLY. No math, no dates, no history." }] },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              id: { type: "STRING" },
              desc: { type: "STRING" }
            },
            required: ["name", "id", "desc"]
          }
        }
      }
    };

    try {
      const data = await callGemini(payload, `Identification for "${q}"`);
      setProposals(Array.isArray(data) ? data : [data]);
    } catch (err) {
      setFetchError("Discovery Hub is busy.");
    } finally {
      setIsSearching(false);
    }
  }, []);

  // --- STAGE 2: Quantitative Precision (Only on Selection) ---
  const selectAndFetchData = async (proposal) => {
    const targetId = proposal.id.toLowerCase();

    if (assetLibrary.find(a => a.id === targetId)) {
      setAllocations(prev => ({ ...prev, [targetId]: prev[targetId] !== undefined ? prev[targetId] : 0 }));
      setSearchQuery('');
      setProposals([]);
      return;
    }

    setLoadingAssetId(proposal.id);
    setFetchError(null);

    // Fast Recall prompt for the ONE selected ticker
    const payload = {
      contents: [{ parts: [{ text: `Recall the actual annualized performance for ticker ${proposal.id.toUpperCase()} from ${startDate} to ${endDate}.
      Return JSON: { "name": "${proposal.name}", "id": "${targetId}", "return": actual_cagr_decimal, "vol": 0.22, "color": "#hex" }.
      Note: Accuracy for these specific dates is critical.` }] }],
      systemInstruction: { parts: [{ text: "Quantitative precision engine. Return raw JSON object ONLY. No tools. Use internal recall." }] },
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    };

    try {
      const data = await callGemini(payload, `Math Recall for ${targetId}`);
      setAssetLibrary(prev => [...prev, { ...data, id: targetId }]);
      setAllocations(prev => ({ ...prev, [targetId]: 0 }));
      setSearchQuery('');
      setProposals([]);
    } catch (err) {
      setFetchError(`Could not verify history for ${proposal.id.toUpperCase()}.`);
    } finally {
      setLoadingAssetId(null);
    }
  };

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setProposals([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(() => searchAssets(searchQuery), 400); // Shorter debounce
    return () => clearTimeout(timer);
  }, [searchQuery, searchAssets]);

  // --- Deterministic Simulation Engine ---
  const runSimulation = useCallback(() => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start >= end || !isAllocationValid) return;

    const diffMonths = Math.max(1, Math.floor(Math.abs(end - start) / (1000 * 60 * 60 * 24 * 30.44)));
    const results = [];

    const activeAssets = selectedAssetIds.map(id => {
      const config = assetLibrary.find(a => a.id === id);
      if (!config) return null;
      return { ...config, currentValue: initialAmount * (allocations[id] || 0), startValue: initialAmount * (allocations[id] || 0) };
    }).filter(Boolean);

    if (activeAssets.length === 0) return;

    let seedValue = initialAmount + start.getTime() + end.getTime();
    selectedAssetIds.forEach(id => { for (let i = 0; i < id.length; i++) seedValue += id.charCodeAt(i); });
    const seededRandom = () => { const x = Math.sin(seedValue++) * 10000; return x - Math.floor(x); };

    const startPoint = { date: startDate, 'Total Portfolio': initialAmount };
    activeAssets.forEach(a => startPoint[a.name] = Math.round(a.startValue));
    results.push(startPoint);

    for (let i = 1; i <= diffMonths; i++) {
      const cur = new Date(start);
      cur.setMonth(start.getMonth() + i);
      const dp = { date: cur.toISOString().split('T')[0] };
      let portTotal = 0;

      activeAssets.forEach(asset => {
        const dt = 1/12;
        const drift = (asset.return - 0.5 * Math.pow(asset.vol, 2)) * dt;
        const noise = asset.vol * Math.sqrt(dt) * (seededRandom() * 2 - 1);
        asset.currentValue = asset.currentValue * Math.exp(drift + noise);
        dp[asset.name] = Math.round(asset.currentValue);
        portTotal += asset.currentValue;
      });
      dp['Total Portfolio'] = Math.round(portTotal);
      results.push(dp);
    }
    setSimulationData(results);

    const finalStats = activeAssets.map(asset => ({
      name: asset.name,
      finalValue: asset.currentValue,
      totalReturn: (asset.currentValue - asset.startValue) / (asset.startValue || 1),
      color: asset.color,
      allocation: allocations[asset.id]
    }));

    setStats([
      { name: 'Total Portfolio', finalValue: activeAssets.reduce((s, a) => s + a.currentValue, 0), totalReturn: (activeAssets.reduce((s, a) => s + a.currentValue, 0) - initialAmount) / initialAmount, color: '#1e293b', isPortfolio: true },
      ...finalStats
    ]);
  }, [initialAmount, startDate, endDate, allocations, assetLibrary, isAllocationValid, selectedAssetIds]);

  useEffect(() => { runSimulation(); }, [runSimulation]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200"><BarChart3 className="text-white w-8 h-8" /></div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-800 uppercase">WealthSim Pro</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="bg-emerald-50 text-emerald-700 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                   <Zap className="w-2 h-2 fill-current" /> Optimized Discovery
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Initial Pool</p>
                <p className="text-lg font-black text-blue-600">{formatCurrency(initialAmount)}</p>
             </div>
             <button onClick={runSimulation} className="bg-slate-900 hover:bg-black text-white px-8 py-3 rounded-2xl font-bold transition-all flex items-center gap-2 shadow-xl active:scale-95">
               <RefreshCcw className="w-4 h-4" /> Simulate
             </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          <aside className="lg:col-span-4 space-y-6">
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 space-y-4">
               <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2"><Settings className="w-4 h-4" /> Window</h3>
               <div className="space-y-4">
                 <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                    <input type="number" value={initialAmount} onChange={(e) => setInitialAmount(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-4 pl-8 pr-4 text-xl font-black focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                 </div>
                 <div className="grid grid-cols-2 gap-3">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none" />
                 </div>
               </div>
            </div>

            {/* Discovery Hub */}
            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 space-y-4 flex flex-col h-[500px]">
               <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2"><Search className="w-4 h-4" /> Discovery Hub</h3>
               <div className="relative">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                 <input
                  type="text"
                  placeholder="Instant Search (Google, BTC, Amazon)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-100 border-none rounded-xl py-3.5 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner transition-all"
                 />
                 {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />}
               </div>

               <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar pb-2 relative">
                  {/* Buffer / Loading Shimmer Animation */}
                  {isSearching && (
                    <div className="space-y-3 animate-in fade-in duration-300">
                      {[1, 2, 3].map(i => (
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

                  {!isSearching && proposals.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 px-1">Market Search Results</p>
                      {proposals.map((prop) => (
                        <div key={prop.id} className="p-4 rounded-2xl bg-white border border-slate-100 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
                           <div className="flex justify-between items-start">
                              <div className="flex items-center gap-3">
                                 <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] bg-slate-400">{prop.id.toUpperCase().slice(0, 3)}</div>
                                 <div className="min-w-0">
                                    <h4 className="text-xs font-black truncate">{prop.name}</h4>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">{prop.id}</p>
                                 </div>
                              </div>
                              {allocations[prop.id.toLowerCase()] === undefined ? (
                                <button
                                  onClick={() => selectAndFetchData(prop)}
                                  disabled={loadingAssetId !== null}
                                  className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-600 shadow-lg disabled:opacity-50 transition-all active:scale-90"
                                >
                                  {loadingAssetId === prop.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                </button>
                              ) : (
                                <div className="p-2 bg-emerald-50 rounded-xl"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></div>
                              )}
                           </div>
                           <p className="text-[10px] text-slate-500 leading-tight mt-2 font-medium">"{prop.desc}"</p>
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

            {/* Strategy Split */}
            <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-2xl space-y-4">
               <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2"><PieChart className="w-4 h-4" /> Strategy Split</h3>
                  <div className="flex bg-white/10 rounded-lg p-0.5">
                    <button onClick={() => setAllocationMode('percent')} className={`p-1.5 rounded-md transition-all ${allocationMode === 'percent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}><Percent className="w-3 h-3" /></button>
                    <button onClick={() => setAllocationMode('amount')} className={`p-1.5 rounded-md transition-all ${allocationMode === 'amount' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}><DollarSign className="w-3 h-3" /></button>
                  </div>
               </div>
               <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                  {selectedAssetIds.map(id => {
                    const asset = assetLibrary.find(a => a.id === id);
                    if (!asset) return null;
                    return (
                      <div key={id} className="bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center gap-3 group transition-all">
                         <div className="w-1.5 h-8 rounded-full" style={{ backgroundColor: asset.color }} />
                         <div className="flex-1 min-w-0"><p className="text-xs font-bold truncate">{asset.name}</p>
                            <button onClick={() => { const n = { ...allocations }; delete n[id]; setAllocations(n); }} className="text-[10px] text-rose-400 font-bold hover:text-rose-300">Remove</button>
                         </div>
                         <div className="w-24">
                           <input type="number" value={allocationMode === 'percent' ? Math.round(allocations[id] * 100) : Math.round(allocations[id] * initialAmount)} onChange={(e) => {
                              const v = allocationMode === 'percent' ? parseFloat(e.target.value) / 100 : parseFloat(e.target.value) / initialAmount;
                              setAllocations(prev => ({ ...prev, [id]: isNaN(v) ? 0 : v }));
                           }} className="w-full bg-white/10 border border-white/20 rounded-xl py-2 px-2 text-right text-xs font-black outline-none focus:border-white/40" />
                         </div>
                      </div>
                    );
                  })}
               </div>
               <div className={`p-4 rounded-2xl border transition-all ${isAllocationValid ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                  <div className="flex justify-between items-center">
                    <div><p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Exposure</p><p className={`text-xl font-black ${isAllocationValid ? 'text-emerald-400' : 'text-rose-400'}`}>{formatPercent(totalAllocatedPercent)}</p></div>
                    {!isAllocationValid && (
                      <button onClick={() => { if(selectedAssetIds.length > 0) { const eq = 1/selectedAssetIds.length; const n = {}; selectedAssetIds.forEach(i => n[i] = eq); setAllocations(n); }}} className="text-[10px] font-bold bg-white text-slate-900 px-3 py-1.5 rounded-lg shadow-sm">Balance Split</button>
                    )}
                  </div>
               </div>
            </div>
          </aside>

          <main className="lg:col-span-8 space-y-8">
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200 h-[550px] flex flex-col overflow-hidden relative">
              <div className="flex justify-between items-start mb-8 relative z-10">
                <div><h2 className="text-2xl font-black tracking-tight text-slate-800 uppercase">Analysis Graph</h2><p className="text-sm text-slate-400 italic font-medium">Historical path for your selected window</p></div>
              </div>
              <div className="flex-1 min-h-0 relative z-10">
                {!isAllocationValid ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                    <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center shadow-inner"><AlertCircle className="w-10 h-10 text-rose-400" /></div>
                    <div className="text-center"><p className="font-black text-slate-800 text-lg uppercase tracking-tight">Allocation Error</p><p className="text-sm">Balance strategy to 100% to view chart</p></div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={simulationData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} minTickGap={60} tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                      <YAxis tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '20px' }} itemStyle={{ fontSize: '11px', fontWeight: 'bold' }} formatter={(v, n) => [formatCurrency(v), n]} labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold' }} />
                      <Line type="monotone" dataKey="Total Portfolio" stroke="#0f172a" strokeWidth={6} dot={false} animationDuration={2500} />
                      {selectedAssetIds.map(id => {
                        const asset = assetLibrary.find(a => a.id === id);
                        if (!asset) return null;
                        return <Line key={id} type="monotone" dataKey={asset.name} stroke={asset.color} strokeWidth={2} strokeDasharray="4 4" dot={false} />;
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
               {stats.map((stat, idx) => (
                 <div key={idx} className={`p-6 rounded-[2rem] border transition-all hover:translate-y-[-4px] ${stat.isPortfolio ? 'bg-slate-900 text-white border-slate-800 shadow-2xl' : 'bg-white border-slate-200 shadow-sm'}`}>
                    <div className="flex justify-between items-start mb-4">
                       <div className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${stat.isPortfolio ? 'bg-blue-600' : 'bg-slate-100 text-slate-500'}`}>{stat.isPortfolio ? 'Combined' : 'Asset'}</div>
                       <div className={`flex items-center gap-1 text-xs font-black ${stat.totalReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{stat.totalReturn >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}{formatPercent(stat.totalReturn)}</div>
                    </div>
                    <h4 className={`text-xs font-bold mb-1 truncate ${stat.isPortfolio ? 'text-slate-400' : 'text-slate-500'}`}>{stat.name} {stat.allocation ? `(${Math.round(stat.allocation * 100)}%)` : ''}</h4>
                    <p className="text-2xl font-black tracking-tight">{formatCurrency(stat.finalValue)}</p>
                 </div>
               ))}
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/20">
                <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2 uppercase"><History className="w-5 h-5 text-slate-400" /> Summary Audit</h2>
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg animate-pulse" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[600px]">
                  <thead className="text-slate-400 text-[10px] font-black uppercase tracking-widest bg-slate-50/50">
                    <tr><th className="px-8 py-4">Instrument</th><th className="px-8 py-4 text-right">Allocation</th><th className="px-8 py-4 text-right">Basis</th><th className="px-8 py-4 text-right">Final Value</th><th className="px-8 py-4 text-right">Growth</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.filter(s => !s.isPortfolio).map((stat, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-6"><div className="flex items-center gap-4"><div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: stat.color }}></div><span className="font-black text-sm">{stat.name}</span></div></td>
                          <td className="px-8 py-6 text-right font-bold text-slate-500 text-sm">{Math.round(stat.allocation * 100)}%</td>
                          <td className="px-8 py-6 text-right font-bold text-slate-400 text-sm">{formatCurrency(stat.allocation * initialAmount)}</td>
                          <td className="px-8 py-6 text-right font-black text-sm">{formatCurrency(stat.finalValue)}</td>
                          <td className="px-8 py-6 text-right"><span className={`font-black text-sm ${stat.totalReturn >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{stat.totalReturn >= 0 ? '+' : ''}{formatCurrency(stat.finalValue - (stat.allocation * initialAmount))}</span></td>
                        </tr>
                      ))}
                    <tr className="bg-slate-900 text-white border-t border-slate-800">
                      <td className="px-8 py-10 font-black rounded-bl-[2.5rem]">Portfolio Summary</td><td className="px-8 py-10 text-right font-black">100%</td><td className="px-8 py-10 text-right font-bold opacity-40">{formatCurrency(initialAmount)}</td><td className="px-8 py-10 text-right font-black text-blue-400 text-lg">{formatCurrency(stats.find(s => s.isPortfolio)?.finalValue || 0)}</td><td className="px-8 py-10 text-right font-black rounded-br-[2.5rem] text-lg">{formatCurrency((stats.find(s => s.isPortfolio)?.finalValue || 0) - initialAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
    </div>
  );
};

export default App;
