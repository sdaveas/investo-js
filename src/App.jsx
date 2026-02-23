import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceDot,
  PieChart, Pie, Cell,
  AreaChart, Area,
  BarChart as RBarChart, Bar, ReferenceLine,
} from 'recharts';
import {
  BarChart3, ArrowUpRight, ArrowDownRight,
  DollarSign, AlertCircle, Search, Loader2,
  History, Zap, CheckCircle2, X,
  PanelLeftClose, PanelLeftOpen,
  ShoppingCart, TrendingDown, Trash2, Pencil, Plus, Minus, Upload, Download, Sparkles, ShieldCheck,
  LogIn, LogOut, Cloud, Github, Heart, Moon, Sun, FileText,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { searchTickers, fetchPrices } from './api';
import { simulate, computeStats } from './simulation';
import { supabase } from './supabase';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

const formatCurrencyFn = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
const formatCurrency = (val) => formatCurrencyFn.format(val);

const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

const formatShortDate = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fiveYearsAgo = new Date();
fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
const DEFAULT_AMOUNT = 1000;
const TODAY = new Date().toISOString().split('T')[0];

const MONTHS_MAP = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

const parseNaturalTx = (text) => {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  // Action
  const type = /\b(sell|sold)\b/.test(lower) ? 'sell' : 'buy';

  // Date — extract and remove from text
  let date = null;
  let cleaned = lower;
  // MM/DD/YYYY
  let m = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    cleaned = cleaned.replace(m[0], ' ');
  }
  // YYYY-MM-DD
  if (!date) {
    m = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); }
  }
  // Month DD, YYYY
  if (!date) {
    m = cleaned.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2}),?\s*(\d{4})/);
    if (m) { date = `${m[3]}-${MONTHS_MAP[m[1].slice(0, 3)]}-${m[2].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); }
  }
  // DD Month YYYY
  if (!date) {
    m = cleaned.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*,?\s*(\d{4})/);
    if (m) { date = `${m[3]}-${MONTHS_MAP[m[2].slice(0, 3)]}-${m[1].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); }
  }

  // Amount — prefer $X,XXX then number+K/M then standalone large number
  let amount = null;
  m = cleaned.match(/\$\s?([\d,]+(?:\.\d+)?)\s*([km])?/i);
  if (m) {
    amount = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]?.toLowerCase() === 'k') amount *= 1000;
    if (m[2]?.toLowerCase() === 'm') amount *= 1000000;
    cleaned = cleaned.replace(m[0], ' ');
  }
  if (!amount) {
    m = cleaned.match(/\b(\d[\d,]*(?:\.\d+)?)\s*([km])\b/i);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      if (m[2].toLowerCase() === 'k') amount *= 1000;
      if (m[2].toLowerCase() === 'm') amount *= 1000000;
      cleaned = cleaned.replace(m[0], ' ');
    }
  }
  if (!amount) {
    m = cleaned.match(/\b(\d[\d,]*(?:\.\d+)?)\b/);
    if (m && parseFloat(m[1].replace(/,/g, '')) >= 100) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      cleaned = cleaned.replace(m[0], ' ');
    }
  }

  // Detect quantity keywords
  const sellAll = /\ball\b/.test(cleaned);
  const sellFraction = /\bhalf\b/.test(cleaned) ? 0.5 : /\bquarter\b/.test(cleaned) ? 0.25 : /\bthird\b/.test(cleaned) ? (1 / 3) : null;

  // Asset — strip action words and prepositions
  const asset = cleaned
    .replace(/\b(buy|bought|sell|sold|purchase[d]?)\b/g, '')
    .replace(/\b(at|on|for|of|in|the|worth|dollars?|usd|with|some|shares?|all|my|their|its|every|entire|total|position|everything|portfolio|half|quarter|third)\b/g, '')
    .replace(/[,$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!asset) return null;
  return { type, amount, date, asset, sellAll, sellFraction };
};

const LS_KEY = 'investo-portfolio';
let savedPortfolio = null;
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) savedPortfolio = JSON.parse(raw);
} catch { /* ignore */ }

let nextTxId = savedPortfolio?.transactions?.length
  ? Math.max(...savedPortfolio.transactions.map((t) => t.id), 0) + 1
  : 1;

const App = () => {
  // --- Search ---
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // --- Portfolio ---
  const [selectedAssets, setSelectedAssets] = useState(() => savedPortfolio?.selectedAssets || {});
  const [transactions, setTransactions] = useState(() => savedPortfolio?.transactions || []);

  // --- Simulation ---
  const [priceCache, setPriceCache] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [stats, setStats] = useState([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hiddenSeries, setHiddenSeries] = useState(new Set());
  const [showMarkers, setShowMarkers] = useState(true);
  const [chartPage, setChartPage] = useState(0); // 0 = performance, 1 = line, 2 = pie, 3 = deposits vs value, 4 = returns by asset
  const CHART_PAGES = 5;
  const [pieMode, setPieMode] = useState(0); // 0 = allocation, 1 = return
  const [perfMode, setPerfMode] = useState(0); // 0 = %, 1 = $
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('investo-dark') === 'true'; } catch { return false; }
  });

  // --- Modal ---
  const [modalMode, setModalMode] = useState(null);           // 'buy' | 'sell' | 'edit' | 'import' | 'insights' | null
  const [stagedAsset, setStagedAsset] = useState(null);       // { symbol, name } — buy step 2
  const [sellTicker, setSellTicker] = useState(null);         // ticker — sell step 2
  const [modalAmount, setModalAmount] = useState(DEFAULT_AMOUNT);
  const [modalDate, setModalDate] = useState(fiveYearsAgo.toISOString().split('T')[0]);
  const [editingTx, setEditingTx] = useState(null);           // tx being edited
  const [importText, setImportText] = useState('');
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddStatus, setQuickAddStatus] = useState(null); // 'processing' | 'error:msg' | null
  const [quickAddPreview, setQuickAddPreview] = useState(null); // { ticker, name, type, amount, date }
  const [quickAddVerify, setQuickAddVerify] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);         // AI generated insights
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // --- Auth & Sync ---
  const [user, setUser] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const isHydratingRef = useRef(false);

  const [colorPickerTicker, setColorPickerTicker] = useState(null);

  const colorIdx = useRef(savedPortfolio?.colorIdx || 0);
  const fetchedRangesRef = useRef({});  // { ticker: startDate } — tracks what we've already fetched

  // ─── Derived ───────────────────────────────────────────────────────────────

  const selectedTickers = useMemo(
    () => [...new Set(transactions.map((tx) => tx.ticker))],
    [transactions],
  );

  const totalDeposits = useMemo(
    () => transactions.reduce((s, tx) => s + (tx.type === 'buy' ? tx.amount : 0), 0),
    [transactions],
  );
  
  const totalWithdrawals = useMemo(
    () => transactions.reduce((s, tx) => s + (tx.type === 'sell' ? tx.amount : 0), 0),
    [transactions],
  );

  // Group transactions by ticker for sidebar
  const txByTicker = useMemo(() => {
    const map = {};
    transactions.forEach((tx) => {
      if (!map[tx.ticker]) map[tx.ticker] = [];
      map[tx.ticker].push(tx);
    });
    // Sort each group by date
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));
    return map;
  }, [transactions]);

  // Tickers that still have a positive balance (market value > 0)
  const ownedTickers = useMemo(() => {
    const lastPoint = chartData[chartData.length - 1];
    return selectedTickers.filter((t) => {
      if (lastPoint && lastPoint[t] != null) return lastPoint[t] > 0;
      // Fallback to net invested if no chart data yet
      const net = (txByTicker[t] || []).reduce(
        (s, tx) => s + (tx.type === 'buy' ? tx.amount : -tx.amount), 0,
      );
      return net > 0;
    });
  }, [selectedTickers, chartData, txByTicker]);

  // ─── Search ────────────────────────────────────────────────────────────────

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

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  const openBuyModal = useCallback(() => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setStagedAsset(null);
    setModalMode('buy');
  }, [transactions]);

  const openSellModal = useCallback((preselectedTicker = null) => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setSellTicker(preselectedTicker);
    setModalMode('sell');
  }, []);

  const openBuyForTicker = useCallback((ticker) => {
    const asset = selectedAssets[ticker];
    if (!asset) return;
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setStagedAsset({ symbol: ticker, name: asset.name });
    setModalMode('buy');
  }, [selectedAssets, transactions]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setSearchQuery('');
    setSearchResults([]);
    setStagedAsset(null);
    setSellTicker(null);
    setEditingTx(null);
  }, []);

  const openEditModal = useCallback((tx) => {
    setEditingTx(tx);
    setModalAmount(tx.amount);
    setModalDate(tx.date);
    setModalMode('edit');
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingTx) return;
    setTransactions((prev) =>
      prev.map((tx) => tx.id === editingTx.id ? { ...tx, amount: modalAmount, date: modalDate } : tx),
    );
    closeModal();
  }, [editingTx, modalAmount, modalDate, closeModal]);

  // ─── Transaction actions ───────────────────────────────────────────────────

  const addBuy = useCallback((symbol, name) => {
    const ticker = symbol.toUpperCase();
    if (!selectedAssets[ticker]) {
      const color = COLORS[colorIdx.current % COLORS.length];
      colorIdx.current++;
      setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    }
    setTransactions((prev) => [
      ...prev,
      { id: nextTxId++, ticker, type: 'buy', amount: modalAmount, date: modalDate },
    ]);
  }, [modalAmount, modalDate, selectedAssets]);

  const addSell = useCallback((ticker) => {
    setTransactions((prev) => [
      ...prev,
      { id: nextTxId++, ticker, type: 'sell', amount: modalAmount, date: modalDate },
    ]);
  }, [modalAmount, modalDate]);

  // ─── Quick Add (AI) ──────────────────────────────────────────────────────

  const handleQuickAdd = useCallback(async () => {
    console.log('handleQuickAdd called, supabase:', supabase, 'user:', user);
    if (!supabase) {
      // Fallback to local parser if Supabase not configured
      const parsed = parseNaturalTx(quickAddText);
      if (!parsed || !parsed.asset) {
        setQuickAddStatus('error:Could not understand. Try: "bought google 1/1/2025 $1000"');
        setTimeout(() => setQuickAddStatus(null), 3000);
        return;
      }
      setQuickAddStatus('processing');
      try {
        const query = parsed.asset.toLowerCase();
        let ticker = null;
        let matchName = null;
        const upperQuery = parsed.asset.toUpperCase();
        if (selectedAssets[upperQuery]) {
          ticker = upperQuery;
          matchName = selectedAssets[upperQuery].name;
        }
        if (!ticker) {
          for (const [t, a] of Object.entries(selectedAssets)) {
            if (a.name.toLowerCase().includes(query) || t.toLowerCase().includes(query)) {
              ticker = t;
              matchName = a.name;
              break;
            }
          }
        }
        if (!ticker) {
          const results = await searchTickers(parsed.asset);
          if (results.length === 0) {
            setQuickAddStatus(`error:No asset found for "${parsed.asset}"`);
            setTimeout(() => setQuickAddStatus(null), 3000);
            return;
          }
          ticker = results[0].symbol.toUpperCase();
          matchName = results[0].name;
        }
        let txAmount = parsed.amount || DEFAULT_AMOUNT;
        if ((parsed.sellAll || parsed.sellFraction) && parsed.type === 'sell') {
          const txDate = parsed.date || TODAY;
          const entry = chartData.findLast((p) => p.date <= txDate);
          const available = entry?.[ticker] ?? 0;
          if (available > 0) txAmount = parsed.sellFraction ? Math.round(available * parsed.sellFraction) : available;
        }
        const resolved = { ticker, name: matchName, type: parsed.type, amount: txAmount, date: parsed.date || TODAY };
        if (quickAddVerify) {
          setQuickAddPreview(resolved);
          setQuickAddStatus(null);
        } else {
          if (!selectedAssets[ticker]) {
            const color = COLORS[colorIdx.current % COLORS.length];
            colorIdx.current++;
            setSelectedAssets((prev) => ({ ...prev, [ticker]: { name: matchName, color } }));
          }
          setTransactions((prev) => [...prev, { id: nextTxId++, ...resolved }]);
          setQuickAddText('');
          setQuickAddStatus(null);
        }
      } catch {
        setQuickAddStatus('error:Search failed. Please try again.');
        setTimeout(() => setQuickAddStatus(null), 3000);
      }
      return;
    }

    // AI-powered parsing via Edge Function
    setQuickAddStatus('processing');
    try {
      // Build portfolio context with current values
      const lastPoint = chartData[chartData.length - 1];
      const portfolio = {};
      for (const [ticker, asset] of Object.entries(selectedAssets)) {
        portfolio[ticker] = {
          name: asset.name,
          currentValue: lastPoint?.[ticker] ?? 0,
        };
      }

      console.log('Invoking parse-transaction with:', { prompt: quickAddText, currentDate: TODAY, portfolio });
      
      const { data, error } = await supabase.functions.invoke('parse-transaction', {
        body: {
          prompt: quickAddText,
          currentDate: TODAY,
          portfolio,
        },
      });

      console.log('Edge Function response:', { data, error });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      const parsed = data;

      // Search for ticker using the asset name from AI
      let ticker = null;
      let matchName = null;
      const query = parsed.asset.toLowerCase();

      // Check if it's already in portfolio
      const upperQuery = parsed.asset.toUpperCase();
      if (selectedAssets[upperQuery]) {
        ticker = upperQuery;
        matchName = selectedAssets[upperQuery].name;
      }

      // Name substring match
      if (!ticker) {
        for (const [t, a] of Object.entries(selectedAssets)) {
          if (a.name.toLowerCase().includes(query) || t.toLowerCase().includes(query)) {
            ticker = t;
            matchName = a.name;
            break;
          }
        }
      }

      // Fall back to Yahoo search
      if (!ticker) {
        const results = await searchTickers(parsed.asset);
        if (results.length === 0) {
          setQuickAddStatus(`error:No asset found for "${parsed.asset}"`);
          setTimeout(() => setQuickAddStatus(null), 3000);
          return;
        }
        ticker = results[0].symbol.toUpperCase();
        matchName = results[0].name;
      }

      // Calculate amount based on AI parsing
      let txAmount = parsed.amount || DEFAULT_AMOUNT;
      if ((parsed.sellAll || parsed.fraction) && parsed.type === 'sell') {
        const txDate = parsed.date || TODAY;
        const entry = chartData.findLast((p) => p.date <= txDate);
        const available = entry?.[ticker] ?? 0;
        if (available <= 0) {
          setQuickAddStatus(`error:You don't have any ${matchName} to sell`);
          setTimeout(() => setQuickAddStatus(null), 3000);
          return;
        }
        txAmount = parsed.fraction ? Math.round(available * parsed.fraction) : available;
      }

      // Validate sell amount if it's a regular sell (not fraction/all)
      if (parsed.type === 'sell' && !parsed.sellAll && !parsed.fraction && parsed.amount) {
        const txDate = parsed.date || TODAY;
        const entry = chartData.findLast((p) => p.date <= txDate);
        const available = entry?.[ticker] ?? 0;
        if (available <= 0) {
          setQuickAddStatus(`error:You don't have any ${matchName} to sell`);
          setTimeout(() => setQuickAddStatus(null), 3000);
          return;
        }
      }

      const resolved = {
        ticker,
        name: matchName,
        type: parsed.type,
        amount: txAmount,
        date: parsed.date || TODAY,
      };

      if (quickAddVerify) {
        setQuickAddPreview(resolved);
        setQuickAddStatus(null);
      } else {
        if (!selectedAssets[ticker]) {
          const color = COLORS[colorIdx.current % COLORS.length];
          colorIdx.current++;
          setSelectedAssets((prev) => ({ ...prev, [ticker]: { name: matchName, color } }));
        }
        setTransactions((prev) => [...prev, { id: nextTxId++, ...resolved }]);
        setQuickAddText('');
        setQuickAddStatus(null);
      }
    } catch (error) {
      console.error('AI parsing error:', error);
      setQuickAddStatus(`error:${error.message || 'Could not understand. Please try again.'}`);
      setTimeout(() => setQuickAddStatus(null), 3000);
    }
  }, [quickAddText, selectedAssets, chartData, quickAddVerify, supabase]);

  const confirmQuickAdd = useCallback(() => {
    if (!quickAddPreview) return;
    const { ticker, name, type, amount, date } = quickAddPreview;
    if (!selectedAssets[ticker]) {
      const color = COLORS[colorIdx.current % COLORS.length];
      colorIdx.current++;
      setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    }
    setTransactions((prev) => [...prev, { id: nextTxId++, ticker, type, amount, date }]);
    setQuickAddText('');
    setQuickAddPreview(null);
  }, [quickAddPreview, selectedAssets]);

  // ─── Import / Export ─────────────────────────────────────────────────────

  const parseImportData = useCallback((text) => {
    const lines = text.trim().split('\n').filter((l) => l.trim());
    if (lines.length === 0) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
    const dateIdx = header.findIndex((h) => h === 'date');
    const tickerIdx = header.findIndex((h) => ['asset', 'ticker', 'symbol'].includes(h));
    const nameIdx = header.findIndex((h) => h === 'name');
    const actionIdx = header.findIndex((h) => ['action', 'type'].includes(h));
    const amountIdx = header.findIndex((h) => h === 'amount');
    const hasHeader = dateIdx >= 0 && tickerIdx >= 0;
    const rows = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim());
      const date = cols[hasHeader ? dateIdx : 0];
      const ticker = (cols[hasHeader ? tickerIdx : 1] || '').toUpperCase();
      const name = hasHeader && nameIdx >= 0 ? cols[nameIdx] : '';
      const action = (cols[hasHeader ? actionIdx : 2] || '').toLowerCase();
      const amount = parseFloat(cols[hasHeader ? amountIdx : 3]);
      if (date && ticker && (action === 'buy' || action === 'sell') && amount > 0) {
        rows.push({ date, ticker, name: name || ticker, type: action, amount });
      }
    }
    return rows;
  }, []);

  const importParsed = useMemo(() => parseImportData(importText), [importText, parseImportData]);

  const confirmImport = useCallback(() => {
    if (importParsed.length === 0) return;
    const newAssets = { ...selectedAssets };
    const newTxs = [];
    importParsed.forEach((row) => {
      if (!newAssets[row.ticker]) {
        newAssets[row.ticker] = { name: row.name, color: COLORS[colorIdx.current % COLORS.length] };
        colorIdx.current++;
      }
      newTxs.push({ id: nextTxId++, ticker: row.ticker, type: row.type, amount: row.amount, date: row.date });
    });
    setSelectedAssets(newAssets);
    setTransactions((prev) => [...prev, ...newTxs]);
    setImportText('');
    setModalMode(null);
  }, [importParsed, selectedAssets]);

  const exportCSV = useCallback(() => {
    const headers = 'Date,Asset,Name,Action,Amount';
    const rows = transactions.map((tx) => {
      const name = (selectedAssets[tx.ticker]?.name || tx.ticker).replace(/,/g, ' ');
      return `${tx.date},${tx.ticker},${name},${tx.type},${tx.amount}`;
    });
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'investo-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [transactions, selectedAssets]);

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImportText(ev.target.result);
    reader.readAsText(file);
  }, []);

  // ─── AI Insights ───────────────────────────────────────────────────────

  const generateAIInsights = useCallback(async () => {
    if (!supabase || stats.length === 0) return;
    
    setIsGeneratingInsights(true);
    setModalMode('insights');
    
    try {
      // Build portfolio summary for AI - filter out "Total Portfolio" entry
      const summary = stats
        .filter(stat => stat.ticker !== null) // Exclude Total Portfolio
        .map(stat => ({
          name: stat.name,
          ticker: stat.ticker,
          currentValue: stat.finalValue,
          totalReturn: stat.finalValue + stat.totalWithdrawals - stat.totalDeposits,
          totalReturnPct: stat.totalDeposits > 0 ? ((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits * 100) : 0,
          annualizedReturn: stat.annualizedReturn * 100, // Convert to percentage
          maxDrawdown: stat.maxDrawdown,
        }));

      const lastPoint = chartData[chartData.length - 1];
      const totalValue = lastPoint?.['Total Portfolio'] ?? 0;

      const requestBody = { 
        summary,
        totalValue,
        totalInvested: totalDeposits,
        totalWithdrawals,
      };

      console.log('Sending request to generate-insights:', requestBody);

      const { data, error } = await supabase.functions.invoke('generate-insights', {
        body: requestBody,
      });

      console.log('Edge Function response:', { data, error });

      if (error) {
        console.error('Edge Function error:', error);
        throw error;
      }
      
      if (data?.insights) {
        setAiInsights(data.insights);
      } else {
        console.warn('No insights in response:', data);
        setAiInsights("Unable to generate insights at this time.");
      }
    } catch (error) {
      console.error('Failed to generate insights:', error);
      setAiInsights("Unable to generate insights at this time. Please try again later.");
    } finally {
      setIsGeneratingInsights(false);
    }
  }, [supabase, stats, chartData, totalDeposits, totalWithdrawals]);

  const removeTx = useCallback((txId) => {
    setTransactions((prev) => {
      const next = prev.filter((tx) => tx.id !== txId);
      // Clean up selectedAssets and fetchedRanges if ticker has no more transactions
      const remaining = new Set(next.map((tx) => tx.ticker));
      setSelectedAssets((sa) => {
        const out = { ...sa };
        Object.keys(out).forEach((t) => {
          if (!remaining.has(t)) {
            delete out[t];
            delete fetchedRangesRef.current[t];
          }
        });
        return out;
      });
      return next;
    });
  }, []);

  // ─── Persistence ───────────────────────────────────────────────────────

  // Save to localStorage on every change
  useEffect(() => {
    if (isHydratingRef.current) return;
    localStorage.setItem(LS_KEY, JSON.stringify({
      transactions, selectedAssets, colorIdx: colorIdx.current,
    }));
  }, [transactions, selectedAssets]);

  // Auth state listener
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const u = session.user;
        setUser({
          id: u.id, email: u.email,
          name: u.user_metadata?.full_name || u.email,
          avatar: u.user_metadata?.avatar_url,
        });
        // Load from cloud
        try {
          const { data } = await supabase.from('portfolios').select('*').eq('user_id', u.id).single();
          if (data?.transactions?.length > 0) {
            isHydratingRef.current = true;
            setTransactions(data.transactions);
            setSelectedAssets(data.selected_assets || {});
            colorIdx.current = data.color_idx || 0;
            nextTxId = Math.max(...data.transactions.map((t) => t.id), 0) + 1;
            localStorage.setItem(LS_KEY, JSON.stringify({
              transactions: data.transactions, selectedAssets: data.selected_assets || {}, colorIdx: data.color_idx || 0,
            }));
            setTimeout(() => { isHydratingRef.current = false; }, 200);
          }
        } catch { /* first sign-in — no data yet */ }
      } else {
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Debounced save to Supabase
  useEffect(() => {
    if (!supabase || !user || isHydratingRef.current) return;
    setIsSyncing(true);
    const t = setTimeout(async () => {
      try {
        await supabase.from('portfolios').upsert({
          user_id: user.id,
          transactions,
          selected_assets: selectedAssets,
          color_idx: colorIdx.current,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch { /* silent */ }
      setIsSyncing(false);
    }, 1500);
    return () => { clearTimeout(t); setIsSyncing(false); };
  }, [transactions, selectedAssets, user]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
    isHydratingRef.current = true;
    setUser(null);
    setTransactions([]);
    setSelectedAssets({});
    setPriceCache(null);
    setChartData([]);
    setStats([]);
    colorIdx.current = 0;
    fetchedRangesRef.current = {};
    localStorage.removeItem(LS_KEY);
    setTimeout(() => { isHydratingRef.current = false; }, 200);
  }, []);

  // ─── Auto-fetch prices ──────────────────────────────────────────

  useEffect(() => {
    if (transactions.length === 0) return;

    // Global start = oldest transaction date across ALL tickers
    const tickers = [...new Set(transactions.map((tx) => tx.ticker))];
    const globalStart = transactions.reduce(
      (min, tx) => (tx.date < min ? tx.date : min), transactions[0].date,
    );
    // Pad start by 30 days so chart shows context before first transaction
    const padded = new Date(globalStart);
    padded.setDate(padded.getDate() - 30);
    const fetchStart = padded.toISOString().split('T')[0];

    const dateRanges = {};
    tickers.forEach((t) => {
      dateRanges[t] = { startDate: fetchStart, endDate: TODAY };
    });

    // Only refetch if a ticker is new or the global start moved earlier
    const fetched = fetchedRangesRef.current;
    const needsFetch = tickers.some((t) => !fetched[t] || fetched[t] > globalStart);
    if (!needsFetch) return;

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setIsSimulating(true);
      setFetchError(null);
      try {
        const prices = await fetchPrices(dateRanges);
        if (!cancelled) {
          tickers.forEach((t) => {
            if (prices[t]?.length > 0) fetched[t] = globalStart;
          });
          setPriceCache((prev) => {
            const next = {};
            tickers.forEach((t) => {
              next[t] = (prices[t]?.length > 0) ? prices[t] : (prev?.[t] || []);
            });
            return next;
          });
        }
      } catch {
        if (!cancelled) setFetchError('Failed to fetch market data.');
      } finally {
        if (!cancelled) setIsSimulating(false);
      }
    }, 500);

    return () => { cancelled = true; clearTimeout(debounce); };
  }, [transactions]);

  // ─── Recompute chart ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!priceCache || transactions.length === 0) {
      setChartData([]);
      setStats([]);
      return;
    }

    const activeTx = transactions.filter((tx) => priceCache[tx.ticker]?.length > 0);
    if (activeTx.length === 0) { setChartData([]); setStats([]); return; }

    const data = simulate(priceCache, activeTx);
    setChartData(data);

    const tickers = [...new Set(activeTx.map((tx) => tx.ticker))];
    const names = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.name]),
    );
    const colors = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.color]),
    );
    setStats(computeStats(data, tickers, activeTx, names, colors));
  }, [priceCache, transactions, selectedAssets]);

  const chartTickers = selectedTickers.filter((t) => priceCache?.[t]);

  // Build two marker sets: per-asset line + Total Portfolio line
  const { assetMarkers, portfolioMarkers } = useMemo(() => {
    if (chartData.length === 0) return { assetMarkers: [], portfolioMarkers: [] };
    const dateIndex = new Map(chartData.map((p, i) => [p.date, i]));
    const asset = [];
    const portfolio = [];
    transactions.forEach((tx) => {
      let idx = dateIndex.get(tx.date);
      if (idx == null) idx = chartData.findIndex((p) => p.date >= tx.date);
      if (idx == null || idx < 0) return;
      const point = chartData[idx];
      const tickerVal = point[tx.ticker];
      if (tickerVal != null) {
        asset.push({ ...tx, chartDate: point.date, value: tickerVal });
      }
      const totalVal = point['Total Portfolio'];
      if (totalVal != null) {
        portfolio.push({ ...tx, chartDate: point.date, value: totalVal });
      }
    });
    return { assetMarkers: asset, portfolioMarkers: portfolio };
  }, [chartData, transactions]);

  const handleLegendClick = useCallback((e) => {
    const key = e.dataKey;
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const toggleDark = useCallback(() => {
    setDark((v) => { const next = !v; localStorage.setItem('investo-dark', next); return next; });
  }, []);


  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans p-4 md:p-8${dark ? ' dark' : ''}`}>
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 transition-all"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              {sidebarOpen ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
            </button>
            <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200 dark:shadow-blue-900">
              <BarChart3 className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase">Investo</h1>
              <span className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider w-fit mt-0.5">
                <Zap className="w-2 h-2 fill-current" /> Real Market Data
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isSimulating && <Loader2 className="w-5 h-5 animate-spin text-blue-500" />}
            {totalDeposits > 0 && (() => {
              const lastPoint = chartData[chartData.length - 1];
              const currentBalance = lastPoint?.['Total Portfolio'] ?? selectedTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
              const pnl = currentBalance + totalWithdrawals - totalDeposits;
              const pnlPct = totalDeposits > 0 ? (pnl / totalDeposits) * 100 : 0;
              const isPositive = pnl >= 0;
              return (
              <div className="hidden sm:flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deposits</p>
                  <p className="text-lg font-black text-blue-600">{formatCurrency(totalDeposits)}</p>
                </div>
                {totalWithdrawals > 0 && (
                <>
                  <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Withdrawals</p>
                    <p className="text-lg font-black text-blue-600">{formatCurrency(totalWithdrawals)}</p>
                  </div>
                </>
                )}
                {currentBalance > 0 && (
                <>
                  <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Balance</p>
                    <p className={`text-lg font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>{formatCurrency(currentBalance)}</p>
                  </div>
                </>
                )}
                <div className="w-px h-8 bg-slate-200 dark:bg-slate-700" />
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Return</p>
                  <p className={`text-lg font-black ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>{isPositive ? '+' : ''}{formatCurrency(pnl)}</p>
                </div>
                <span className={`text-xs font-black px-2 py-1 rounded-lg ${isPositive ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600' : 'bg-rose-50 dark:bg-rose-950 text-rose-600'}`}>{isPositive ? '+' : ''}{pnlPct.toFixed(1)}%</span>
              </div>
              );
            })()}
          </div>
          {/* Auth + Theme */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                {isSyncing && <Cloud className="w-4 h-4 text-blue-400 animate-pulse" />}
                {user.avatar ? (
                  <img src={user.avatar} className="w-8 h-8 rounded-full" alt="" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-black">
                    {user.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <button onClick={signOut} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 transition-all" title="Sign out">
                  <LogOut className="w-4 h-4" />
                </button>
                <button onClick={toggleDark} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 transition-all" title={dark ? 'Light mode' : 'Dark mode'}>
                  {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              </>
            ) : supabase ? (
              <div className="flex items-center gap-2">
                <button onClick={toggleDark} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 transition-all" title={dark ? 'Light mode' : 'Dark mode'}>
                  {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
                <button onClick={signInWithGoogle} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all">
                  <LogIn className="w-4 h-4" /> Sign in
                </button>
              </div>
            ) : (
              <button onClick={toggleDark} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 transition-all" title={dark ? 'Light mode' : 'Dark mode'}>
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          {sidebarOpen && (
          <aside className="lg:col-span-4 space-y-6">

            {/* AI Quick Add */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 pl-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Describe transactions naturally</span>
              </div>
              <div className="relative">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
                <input
                  type="text"
                  value={quickAddText}
                  onChange={(e) => setQuickAddText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && quickAddText.trim() && handleQuickAdd()}
                  placeholder='sold half my apple last week'
                  disabled={quickAddStatus === 'processing'}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3 pl-10 pr-12 text-sm font-medium focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none shadow-sm transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600 disabled:opacity-60"
                />
                <button
                  onClick={() => setQuickAddVerify((v) => !v)}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors ${quickAddVerify ? 'text-violet-500 hover:text-violet-600' : 'text-slate-300 hover:text-slate-400'}`}
                  title="Verify transactions before adding"
                >
                  {quickAddStatus === 'processing'
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <ShieldCheck className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {quickAddPreview && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold ${quickAddPreview.type === 'buy' ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 text-emerald-700' : 'bg-rose-50 dark:bg-rose-950 border-rose-200 text-rose-700'}`}>
                <span className="uppercase text-[10px] font-black w-8">{quickAddPreview.type}</span>
                <span className="flex-1 truncate">{quickAddPreview.name} ({quickAddPreview.ticker})</span>
                <span>{formatCurrency(quickAddPreview.amount)}</span>
                <span className="text-slate-400 text-[10px]">{formatShortDate(quickAddPreview.date)}</span>
                <button onClick={confirmQuickAdd} className="p-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors" title="Confirm">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setQuickAddPreview(null)} className="p-1 rounded-lg bg-slate-200 text-slate-500 hover:bg-slate-300 transition-colors" title="Cancel">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {quickAddStatus && quickAddStatus.startsWith('error') && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-950 text-rose-700">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {quickAddStatus.split(':').slice(1).join(':')}
              </div>
            )}

            {/* Record Buy / Record Sell buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={openBuyModal}
                className="bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
              >
                <ShoppingCart className="w-4 h-4" /> Record Buy
              </button>
              <button
                onClick={() => openSellModal()}
                disabled={ownedTickers.length === 0}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white py-3 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg active:scale-95"
              >
                <TrendingDown className="w-4 h-4" /> Record Sell
              </button>
            </div>
            {/* Transaction ledger */}
            {selectedTickers.length > 0 && (
            <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-2xl space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <History className="w-4 h-4" /> Transactions
              </h3>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {selectedTickers.map((ticker) => {
                  const asset = selectedAssets[ticker];
                  const txs = txByTicker[ticker] || [];
                  if (!asset || txs.length === 0) return null;
                  return (
                    <div key={ticker} className="space-y-1.5">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="relative">
                          <button
                            onClick={() => setColorPickerTicker((prev) => prev === ticker ? null : ticker)}
                            className="w-1.5 h-4 rounded-full cursor-pointer hover:scale-150 transition-transform"
                            style={{ backgroundColor: asset.color }}
                            title="Change color"
                          />
                          {colorPickerTicker === ticker && (
                            <div className="absolute left-4 top-0 z-50 flex gap-1.5 p-2 rounded-xl bg-slate-800 border border-slate-700 shadow-xl">
                              {COLORS.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => {
                                    setSelectedAssets((prev) => ({ ...prev, [ticker]: { ...prev[ticker], color: c } }));
                                    setColorPickerTicker(null);
                                  }}
                                  className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${asset.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-800' : ''}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex-1 truncate">{asset.name} ({ticker})</p>
                        <button onClick={() => openBuyForTicker(ticker)} className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors" title="Record buy">
                          <Plus className="w-3 h-3" />
                        </button>
                        {ownedTickers.includes(ticker) && (
                          <button onClick={() => openSellModal(ticker)} className="p-1 rounded-lg bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors" title="Record sell">
                            <Minus className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {txs.map((tx) => (
                        <div key={tx.id} onClick={() => openEditModal(tx)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all hover:brightness-125 ${tx.type === 'buy' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                          <span className="uppercase text-[10px] font-black w-8">{tx.type}</span>
                          <span className="flex-1 text-white/80">{formatCurrency(tx.amount)}</span>
                          <span className="text-white/40 text-[10px]">{formatShortDate(tx.date)}</span>
                          <button onClick={(e) => { e.stopPropagation(); removeTx(tx.id); }} className="text-white/20 hover:text-rose-400 p-0.5 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {(() => {
                const lastPoint = chartData[chartData.length - 1];
                const currentBalance = lastPoint?.['Total Portfolio'] ?? selectedTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
                const pnl = currentBalance + totalWithdrawals - totalDeposits;
                const pnlPct = totalDeposits > 0 ? (pnl / totalDeposits) * 100 : 0;
                const isPositive = pnl >= 0;
                return (
                <div className="p-4 rounded-2xl border bg-emerald-500/10 border-emerald-500/20 space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Total Deposits</p>
                      <p className="text-xl font-black text-emerald-400">{formatCurrency(totalDeposits)}</p>
                    </div>
                    <p className="text-[10px] font-bold text-white/30">{transactions.length} tx · {selectedTickers.length} asset{selectedTickers.length !== 1 ? 's' : ''}</p>
                  </div>
                  {totalWithdrawals > 0 && (
                  <>
                    <div className="border-t border-white/10" />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Total Withdrawals</p>
                        <p className="text-xl font-black text-emerald-400">{formatCurrency(totalWithdrawals)}</p>
                      </div>
                    </div>
                  </>
                  )}
                  {currentBalance > 0 && (
                  <>
                    <div className="border-t border-white/10" />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Current Balance</p>
                        <p className={`text-xl font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(currentBalance)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{pnlPct.toFixed(1)}%</p>
                        <p className={`text-[10px] font-bold ${isPositive ? 'text-emerald-500/60' : 'text-rose-500/60'}`}>{isPositive ? '+' : ''}{formatCurrency(pnl)}</p>
                      </div>
                    </div>
                  </>
                  )}
                  <div className="border-t border-white/10" />
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Total Return</p>
                      <p className={`text-xl font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{isPositive ? '+' : ''}{formatCurrency(pnl)}</p>
                    </div>
                    <span className={`text-xs font-black px-2 py-1 rounded-lg ${isPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{isPositive ? '+' : ''}{pnlPct.toFixed(1)}%</span>
                  </div>
                </div>
                );
              })()}
            </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { setImportText(''); setModalMode('import'); }}
                className="py-2 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 active:scale-95">
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
              <button onClick={exportCSV} disabled={transactions.length === 0}
                className="py-2 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40 active:scale-95">
                <Download className="w-3.5 h-3.5" /> Export
              </button>
            </div>
            {supabase && stats.length > 0 && (
              <button
                onClick={generateAIInsights}
                disabled={isGeneratingInsights}
                className="w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-700 hover:to-blue-700 text-white shadow-lg disabled:opacity-60 active:scale-95"
              >
                {isGeneratingInsights ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> AI Insights</>
                )}
              </button>
            )}
          </aside>
          )}

          {/* ── Main ─────────────────────────────────────────────────────── */}
          <main className={`${sidebarOpen ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-8`}>

            {/* Chart */}
            <div className="bg-white dark:bg-slate-800 p-6 md:p-8 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 h-[550px] flex flex-col overflow-hidden relative">
              <div className="flex justify-between items-start mb-8 relative z-10">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase">
                    {['Performance', 'Transaction History', 'Allocation', 'Deposits vs Value', 'Returns by Asset'][chartPage]}
                  </h2>
                  <p className="text-sm text-slate-400 italic font-medium">
                    {chartPage === 2
                      ? (pieMode === 0 ? 'Current portfolio breakdown' : 'Return contribution per asset')
                      : ['Return over time', 'Historical data from Yahoo Finance', '', 'Invested capital vs portfolio value', 'Profit & loss per asset'][chartPage]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {chartPage === 0 && chartData.length > 0 && (
                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                      {['%', '$'].map((label, i) => (
                        <button
                          key={label}
                          onClick={() => setPerfMode(i)}
                          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${
                            perfMode === i
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {chartPage === 1 && chartData.length > 0 && transactions.length > 0 && (
                    <button
                      onClick={() => setShowMarkers((v) => !v)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${showMarkers ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}
                    >
                      {showMarkers ? '● Markers On' : '○ Markers Off'}
                    </button>
                  )}
                  {chartPage === 2 && chartData.length > 0 && (
                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                      {['Allocation', 'Return'].map((label, i) => (
                        <button
                          key={label}
                          onClick={() => setPieMode(i)}
                          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${
                            pieMode === i
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {chartData.length > 0 && chartTickers.length > 0 && (
                    <div className="flex items-center gap-1">
                      <button
                      onClick={() => setChartPage((p) => (p - 1 + CHART_PAGES) % CHART_PAGES)}
                        className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-[10px] font-bold text-slate-400 w-8 text-center">{chartPage + 1}/{CHART_PAGES}</span>
                      <button
                        onClick={() => setChartPage((p) => (p + 1) % CHART_PAGES)}
                        className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
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
                    <div className="w-20 h-20 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center shadow-inner">
                      <BarChart3 className="w-10 h-10 text-slate-300" />
                    </div>
                    <div className="text-center">
                      <p className="font-black text-slate-800 dark:text-slate-100 text-lg uppercase tracking-tight">No Data Yet</p>
                      <p className="text-sm">Record purchases to start simulating</p>
                    </div>
                  </div>
                ) : chartPage === 0 ? (() => {
                  // Performance — return over time
                  const sortedTx = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
                  const depositMap = new Map();
                  let cumDeposits = 0;
                  let cumWithdrawals = 0;
                  sortedTx.forEach((tx) => {
                    if (tx.type === 'buy') cumDeposits += tx.amount;
                    else cumWithdrawals += tx.amount;
                    depositMap.set(tx.date, { deposits: cumDeposits, withdrawals: cumWithdrawals });
                  });
                  let lastDep = 0;
                  let lastWith = 0;
                  const perfData = chartData.map((p) => {
                    const d = depositMap.get(p.date);
                    if (d) { lastDep = d.deposits; lastWith = d.withdrawals; }
                    const pv = p['Total Portfolio'] ?? 0;
                    const pnl = pv + lastWith - lastDep;
                    const pct = lastDep > 0 ? (pnl / lastDep) * 100 : 0;
                    return { date: p.date, 'Return %': Math.round(pct * 100) / 100, 'Return $': Math.round(pnl) };
                  }).filter((d) => d['Return %'] !== 0 || d['Return $'] !== 0);
                  const isPct = perfMode === 0;
                  const dataKey = isPct ? 'Return %' : 'Return $';
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={perfData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={isPct ? (v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : (v) => `${v >= 0 ? '+' : ''}${formatCurrency(v)}`} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => isPct ? [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`] : [`${v >= 0 ? '+' : ''}${formatCurrency(v)}`]}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                        <ReferenceLine y={0} stroke={dark ? '#475569' : '#cbd5e1'} strokeWidth={1} />
                        <Area type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={2} dot={false} fill="none" />
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()
                : chartPage === 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                        axisLine={false} tickLine={false} minTickGap={60}
                        tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
                        axisLine={false} tickLine={false}
tickerFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                        itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                        formatter={(v, n) => [formatCurrency(v), n]}
                        labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', color: dark ? '#94a3b8' : undefined }} onClick={handleLegendClick} />
                      {chartTickers.length > 1 && (
<Line type="monotone" dataKey="Total Portfolio" stroke={dark ? '#e2e8f0' : '#0f172a'} strokeWidth={3} dot={false} hide={hiddenSeries.has('Total Portfolio')} />
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
                            hide={hiddenSeries.has(ticker)}
                          />
                        );
                      })}
                      {showMarkers && assetMarkers.map((m) => (
                        !hiddenSeries.has(m.ticker) && (
                          <ReferenceDot
                            key={`a-${m.id}`}
                            x={m.chartDate}
                            y={m.value}
                            r={5}
                            fill={m.type === 'buy' ? '#10b981' : '#ef4444'}
                            stroke="#fff"
                            strokeWidth={2}
                            isFront
                          />
                        )
                      ))}
                      {showMarkers && chartTickers.length > 1 && !hiddenSeries.has('Total Portfolio') && portfolioMarkers.map((m) => (
                        <ReferenceDot
                          key={`p-${m.id}`}
                          x={m.chartDate}
                          y={m.value}
                          r={4}
                          fill={m.type === 'buy' ? '#10b981' : '#ef4444'}
                          stroke={dark ? '#e2e8f0' : '#0f172a'}
                          strokeWidth={2}
                          isFront
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : chartPage === 2 ? (() => {
                  const lastPoint = chartData[chartData.length - 1];
                  let pieData, total, isReturnMode = pieMode === 1;
                  if (!isReturnMode) {
                    pieData = chartTickers
                      .map((ticker) => ({
                        name: `${selectedAssets[ticker]?.name || ticker} (${ticker})`,
                        value: lastPoint?.[ticker] ?? 0,
                        color: selectedAssets[ticker]?.color || '#94a3b8',
                      }))
                      .filter((d) => d.value > 0)
                      .sort((a, b) => b.value - a.value);
                    total = pieData.reduce((s, d) => s + d.value, 0);
                  } else {
                    pieData = chartTickers
                      .map((ticker) => {
                        const txs = transactions.filter((tx) => tx.ticker === ticker);
                        const deps = txs.reduce((s, tx) => s + (tx.type === 'buy' ? tx.amount : 0), 0);
                        const withs = txs.reduce((s, tx) => s + (tx.type === 'sell' ? tx.amount : 0), 0);
                        const fv = lastPoint?.[ticker] ?? 0;
                        const pnl = fv + withs - deps;
                        return {
                          name: `${selectedAssets[ticker]?.name || ticker} (${ticker})`,
                          value: Math.abs(pnl),
                          rawPnl: pnl,
                          color: pnl >= 0 ? '#10b981' : '#ef4444',
                          assetColor: selectedAssets[ticker]?.color || '#94a3b8',
                        };
                      })
                      .filter((d) => d.value > 0)
                      .sort((a, b) => b.value - a.value);
                    total = pieData.reduce((s, d) => s + d.value, 0);
                  }
                  return pieData.length > 0 ? (
                    <div className="h-full flex items-center">
                      <div className="flex-1 h-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius="55%"
                              outerRadius="85%"
                              paddingAngle={2}
                              dataKey="value"
                              stroke="none"
                              activeIndex={-1}
                              isAnimationActive={false}
                            >
                              {pieData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ borderRadius: '16px', border: dark ? '1px solid #e2e8f0' : '1px solid #1e293b', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '12px 16px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                              itemStyle={{ fontSize: '12px', fontWeight: 'bold', color: dark ? '#e2e8f0' : '#1e293b' }}
                              formatter={(v, _name, entry) => {
                                if (isReturnMode) {
                                  const raw = entry.payload.rawPnl;
                                  return [`${raw >= 0 ? '+' : ''}${formatCurrency(raw)}`];
                                }
                                return [formatCurrency(v)];
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="w-48 space-y-2 pr-2">
                        {pieData.map((d, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: isReturnMode ? d.assetColor : d.color }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold truncate text-slate-500 dark:text-slate-400">{d.name}</p>
                              {isReturnMode ? (
                                <p className={`text-xs font-black ${d.rawPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                  {d.rawPnl >= 0 ? '+' : ''}{formatCurrency(d.rawPnl)} <span className="text-slate-400 font-bold">({(d.value / total * 100).toFixed(1)}%)</span>
                                </p>
                              ) : (
                                <p className="text-xs font-black">{formatCurrency(d.value)} <span className="text-slate-400 font-bold">({(d.value / total * 100).toFixed(1)}%)</span></p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <p className="font-bold text-sm">{isReturnMode ? 'No returns to display' : 'No active holdings to display'}</p>
                    </div>
                  );
                })()

                : chartPage === 3 ? (() => {
                  // Deposits vs Value — area chart
                  const sortedTx = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
                  const depositMap = new Map();
                  let cumDeposits = 0;
                  let cumWithdrawals = 0;
                  sortedTx.forEach((tx) => {
                    if (tx.type === 'buy') cumDeposits += tx.amount;
                    else cumWithdrawals += tx.amount;
                    depositMap.set(tx.date, { deposits: cumDeposits, withdrawals: cumWithdrawals });
                  });
                  let lastDep = 0;
                  let lastWith = 0;
                  const areaData = chartData.map((p) => {
                    const d = depositMap.get(p.date);
                    if (d) { lastDep = d.deposits; lastWith = d.withdrawals; }
                    return {
                      date: p.date,
                      'Portfolio Value': p['Total Portfolio'] ?? 0,
                      'Net Invested': Math.max(0, lastDep - lastWith),
                    };
                  });
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={areaData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [formatCurrency(v)]}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', color: dark ? '#94a3b8' : undefined }} />
                        <Area type="monotone" dataKey="Portfolio Value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} dot={false} />
                        <Area type="stepAfter" dataKey="Net Invested" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.08} strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()

                : (() => {
                  // Returns by Asset — bar chart (page 4)
                  const lastPoint = chartData[chartData.length - 1];
                  const barData = chartTickers
                    .map((ticker) => {
                      const txs = transactions.filter((tx) => tx.ticker === ticker);
                      const deposits = txs.reduce((s, tx) => s + (tx.type === 'buy' ? tx.amount : 0), 0);
                      const withdrawals = txs.reduce((s, tx) => s + (tx.type === 'sell' ? tx.amount : 0), 0);
                      const fv = lastPoint?.[ticker] ?? 0;
                      const pnl = fv + withdrawals - deposits;
                      return {
                        name: selectedAssets[ticker]?.name || ticker,
                        ticker,
                        pnl: Math.round(pnl),
                        color: selectedAssets[ticker]?.color || '#94a3b8',
                      };
                    })
                    .sort((a, b) => b.pnl - a.pnl);
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <RBarChart data={barData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: dark ? '#e2e8f0' : '#334155', fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => `${v >= 0 ? '+' : ''}${formatCurrency(v)}`} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [`${v >= 0 ? '+' : ''}${formatCurrency(v)}`, 'P&L']}
                          cursor={{ fill: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }} />
                        <ReferenceLine y={0} stroke={dark ? '#475569' : '#cbd5e1'} strokeWidth={1} />
                        <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
                          {barData.map((entry, i) => (
                            <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                          ))}
                        </Bar>
                      </RBarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            </div>

            {/* Stats Cards */}
            {stats.length > 0 && (() => {
              const portfolio = stats.find((s) => s.isPortfolio);
              const assets = stats.filter((s) => !s.isPortfolio);
              return (
                <div className="space-y-6">
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
                            <p className={`text-xl font-black ${(portfolio.finalValue + portfolio.totalWithdrawals - portfolio.totalDeposits) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {(portfolio.finalValue + portfolio.totalWithdrawals - portfolio.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(portfolio.finalValue + portfolio.totalWithdrawals - portfolio.totalDeposits)}
                            </p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Return</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xl font-black text-slate-300">{formatPercent(portfolio.annualizedReturn)}</p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">Ann.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {assets.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {assets.map((stat, idx) => (
                        <div key={idx} className="p-6 rounded-[2rem] border bg-white dark:bg-slate-800 border-slate-200 shadow-sm transition-all hover:translate-y-[-4px]">
                          <div className="flex justify-between items-start mb-4">
                            <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                              {stat.ticker}
                            </div>
                            <div className={`flex items-center gap-1 text-xs font-black ${(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                              {stat.totalDeposits > 0 ? formatPercent((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits) : '—'}
                            </div>
                          </div>
                          <h4 className="text-xs font-bold mb-1 truncate text-slate-500 dark:text-slate-400">
                            {stat.name} · {formatCurrency(stat.totalDeposits)}
                          </h4>
                          <p className="text-2xl font-black tracking-tight">{formatCurrency(stat.finalValue)}</p>
                          <div className="mt-2 flex gap-3 text-[10px] font-bold">
                            <span className="text-slate-400">Ann. {formatPercent(stat.annualizedReturn)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

          </main>
        </div>

        {/* Summary Table — full width */}
        {stats.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/20 dark:bg-slate-800/20">
              <h2 className="text-xl font-black tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-2 uppercase">
                <History className="w-5 h-5 text-slate-400" /> Summary
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead className="text-slate-400 text-[10px] font-black uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-8 py-4">Asset</th>
                    <th className="px-8 py-4 text-right">Deposits</th>
                    <th className="px-8 py-4 text-right">Withdrawals</th>
                    <th className="px-8 py-4 text-right">Balance</th>
                    <th className="px-8 py-4 text-right">Return</th>
                    <th className="px-8 py-4 text-right">Ann. Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stats.filter((s) => !s.isPortfolio).map((stat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: stat.color }} />
                          <span className="font-black text-sm">{stat.name} ({stat.ticker})</span>
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right font-bold text-sm">{formatCurrency(stat.totalDeposits)}</td>
                      <td className="px-8 py-6 text-right font-bold text-sm">{formatCurrency(stat.totalWithdrawals)}</td>
                      <td className="px-8 py-6 text-right font-black text-sm text-blue-600 dark:text-blue-400">{formatCurrency(stat.finalValue)}</td>
                      <td className="px-8 py-6 text-right">
                        <span className={`font-black text-sm ${(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits)}
                          {stat.totalDeposits > 0 ? (
                            <span className="text-xs font-normal text-slate-400 ml-1">({(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatPercent((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits)})</span>
                          ) : (
                            <span className="text-xs font-normal text-slate-400 ml-1">(—)</span>
                          )}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right font-bold text-sm text-slate-500 dark:text-slate-400">{formatPercent(stat.annualizedReturn)}</td>
                    </tr>
                  ))}
                  {stats.find((s) => s.isPortfolio) && (() => {
                    const p = stats.find((s) => s.isPortfolio);
                    return (
                      <tr className="bg-slate-900 text-white border-t border-slate-800">
                        <td className="px-8 py-10 font-black rounded-bl-[2.5rem]">Portfolio Total</td>
                        <td className="px-8 py-10 text-right font-bold">{formatCurrency(p.totalDeposits)}</td>
                        <td className="px-8 py-10 text-right font-bold">{formatCurrency(p.totalWithdrawals)}</td>
                        <td className="px-8 py-10 text-right font-black text-blue-400 text-lg">{formatCurrency(p.finalValue)}</td>
                        <td className={`px-8 py-10 text-right font-black text-lg ${(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(p.finalValue + p.totalWithdrawals - p.totalDeposits)}
                          <span className="text-xs font-normal text-slate-400 ml-1">({(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatPercent((p.finalValue + p.totalWithdrawals - p.totalDeposits) / p.totalDeposits)})</span>
                        </td>
                        <td className="px-8 py-10 text-right font-bold rounded-br-[2.5rem]">{formatPercent(p.annualizedReturn)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Buy Modal ────────────────────────────────────────────────────── */}
      {modalMode === 'buy' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-md mx-4 p-6 space-y-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-600 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" /> Record Purchase
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {stagedAsset ? (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] bg-emerald-500">
                      {stagedAsset.symbol.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-black truncate">{stagedAsset.name}</h4>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase">{stagedAsset.symbol}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                      <input type="number" value={modalAmount} onChange={(e) => setModalAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Purchase Date</label>
                    <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setStagedAsset(null)} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Back</button>
                  <button onClick={() => { addBuy(stagedAsset.symbol, stagedAsset.name); closeModal(); }}
                    className="flex-1 py-3 rounded-2xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg transition-all active:scale-95">
                    Record
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="text" placeholder="Search (Google, BTC, Amazon)..." value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)} autoFocus
                    className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3.5 pl-10 pr-4 text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none shadow-inner transition-all" />
                  {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500 animate-spin" />}
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar pb-2">
                  {isSearching && (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-700 border border-slate-100 dark:border-slate-800 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-600 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-3 w-2/3 bg-slate-200 dark:bg-slate-600 rounded animate-pulse" />
                            <div className="h-2 w-1/2 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!isSearching && searchResults.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 px-1">Results</p>
                      {searchResults.map((r) => (
                        <div key={r.symbol} className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md">
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
                            <button
                              onClick={() => setStagedAsset({ symbol: r.symbol, name: r.name })}
                              className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-lg transition-all active:scale-90"
                            >
                              <ShoppingCart className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {fetchError && !isSearching && (
                    <div className="p-4 bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 rounded-2xl text-rose-600 text-[10px] font-bold flex items-center gap-2">
                      <AlertCircle className="w-3 h-3 shrink-0" /> {fetchError}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Sell Modal ───────────────────────────────────────────────────── */}
      {modalMode === 'sell' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-md mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-rose-600 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" /> Record Sale
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {sellTicker ? (() => {
              const entry = chartData.findLast((p) => p.date <= modalDate);
              const availableBalance = entry?.[sellTicker] ?? 0;
              return (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] bg-rose-500">
                      {sellTicker.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-black truncate">{selectedAssets[sellTicker]?.name}</h4>
                      <p className="text-[10px] font-bold text-rose-500 uppercase">{sellTicker} · Available: {formatCurrency(Math.max(0, availableBalance))}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Sale Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                      <input type="number" value={modalAmount} onChange={(e) => setModalAmount(Math.max(0, Number(e.target.value)))}
                        className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-rose-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Sale Date</label>
                    <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                      min={(() => {
                        const buys = (txByTicker[sellTicker] || []).filter((tx) => tx.type === 'buy');
                        return buys.length > 0 ? buys[0].date : undefined;
                      })()}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-rose-500 outline-none" />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setSellTicker(null)} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Back</button>
                  <button onClick={() => { addSell(sellTicker); closeModal(); }}
                    disabled={modalAmount <= 0 || modalAmount > availableBalance}
                    className="flex-1 py-3 rounded-2xl font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 shadow-lg transition-all active:scale-95">
                    Record
                  </button>
                </div>
              </div>
              );
            })() : (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-500 px-1">Select asset to record sale</p>
                {ownedTickers.map((ticker) => {
                  const asset = selectedAssets[ticker];
                  if (!asset) return null;
                  return (
                    <button key={ticker} onClick={() => { setSellTicker(ticker); setModalDate(TODAY); }}
                      className="w-full p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:border-rose-200 hover:shadow-md flex items-center gap-3 text-left">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px]" style={{ backgroundColor: asset.color }}>
                        {ticker.slice(0, 3)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-black truncate">{asset.name}</h4>
                        <p className="text-[10px] font-bold text-slate-400 uppercase">{ticker}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Modal ──────────────────────────────────────────────────── */}
      {modalMode === 'edit' && editingTx && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-md mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Edit Transaction
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] ${editingTx.type === 'buy' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                  {editingTx.ticker.slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-black truncate">{selectedAssets[editingTx.ticker]?.name}</h4>
                  <p className={`text-[10px] font-bold uppercase ${editingTx.type === 'buy' ? 'text-emerald-600' : 'text-rose-600'}`}>{editingTx.type} · {editingTx.ticker}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                  <input type="number" value={modalAmount} onChange={(e) => setModalAmount(Math.max(0, Number(e.target.value)))}
                    className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button onClick={saveEdit} disabled={modalAmount <= 0}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 shadow-lg transition-all active:scale-95">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import Modal ────────────────────────────────────────────────── */}
      {modalMode === 'import' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 flex items-center gap-2">
                <Upload className="w-4 h-4" /> Import Transactions
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Upload CSV or paste from Google Sheets</p>
              <label className="flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-600 hover:border-blue-300 cursor-pointer transition-colors">
                <Upload className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Choose CSV file</span>
                <input type="file" accept=".csv,.tsv,.txt" onChange={handleImportFile} className="hidden" />
              </label>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`Date,Asset,Name,Action,Amount\n2020-01-01,GOOGL,Alphabet Inc,buy,10000\n2023-06-15,AAPL,Apple Inc,buy,5000`}
                rows={6}
                className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 px-4 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              />
            </div>

            {importParsed.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{importParsed.length} transaction{importParsed.length !== 1 ? 's' : ''} found</p>
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {importParsed.map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${row.type === 'buy' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700' : 'bg-rose-50 dark:bg-rose-950 text-rose-700'}`}>
                      <span className="uppercase text-[10px] font-black w-8">{row.type}</span>
                      <span className="flex-1 truncate">{row.name} ({row.ticker})</span>
                      <span>{formatCurrency(row.amount)}</span>
                      <span className="text-slate-400 text-[10px]">{row.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importText.trim() && importParsed.length === 0 && (
              <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> No valid transactions found. Expected: Date, Asset, Action, Amount
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button onClick={confirmImport} disabled={importParsed.length === 0}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 shadow-lg transition-all active:scale-95">
                Import {importParsed.length > 0 ? `(${importParsed.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Insights Modal ───────────────────────────────────────────── */}
      {modalMode === 'insights' && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> AI Portfolio Insights
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border border-blue-100 dark:border-blue-900">
              {isGeneratingInsights ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  <p className="text-sm font-bold text-slate-500">Analyzing your portfolio...</p>
                </div>
              ) : (
                <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 space-y-4">
                  {aiInsights.split('\n\n').map((paragraph, i) => (
                    <p key={i} className="whitespace-pre-line">{paragraph}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition-all active:scale-95">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-200 dark:border-slate-700 mt-8" />
      <footer className="flex items-center justify-center gap-4 pt-4 pb-8 text-xs font-bold text-slate-400">
        <a href="https://github.com/sdaveas/investo-js" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-300 dark:text-slate-300 transition-colors">
          <Github className="w-3.5 h-3.5" /> GitHub
        </a>
        <span className="text-slate-200">·</span>
        <a href="https://buymeacoffee.com/br3gan" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-rose-500 transition-colors">
          <Heart className="w-3.5 h-3.5" /> Buy me a coffee
        </a>
      </footer>

      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
    </div>
  );
};

export default App;
