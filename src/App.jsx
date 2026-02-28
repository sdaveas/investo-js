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
  ShoppingCart, HandCoins, Trash2, Pencil, Plus, Minus, Upload, Download, Sparkles, ShieldCheck,
  LogIn, LogOut, Cloud, Github, Heart, Moon, Sun, FileText, Menu, Coffee,
  ChevronLeft, ChevronRight, Share2, Camera, Check, Link, ExternalLink, Maximize2, Minimize2,
  Landmark, Eye, EyeOff,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { searchTickers, fetchPrices, fetchQuote, fetchIntradayPrices } from './api';
import { simulate, computeStats } from './simulation';
import { supabase } from './supabase';
import { Analytics } from '@vercel/analytics/react';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

const formatCurrencyFn = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});
const formatCurrency = (val) => formatCurrencyFn.format(val);

const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

const formatShort = (val) => {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

const formatShortDate = (d) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const fiveYearsAgo = new Date();
fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
const DEFAULT_AMOUNT = 1000;
const TODAY = new Date().toISOString().split('T')[0];

const CASH_TICKER = '_CASH';
const isCashTx = (tx) => tx.ticker === CASH_TICKER;
const displayTicker = (t) => t === CASH_TICKER ? 'CASH' : t;

const MONTHS_MAP = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

const parseNaturalTx = (text) => {
  const lower = text.toLowerCase().trim();
  if (!lower) return null;

  // Action — check for bank keywords first
  const isDeposit = /\b(deposit(ed)?|bank\s*deposit)\b/.test(lower);
  const isWithdraw = /\b(withdraw(n|al)?|bank\s*withdraw(al)?)\b/.test(lower);
  if (isDeposit || isWithdraw) {
    // Bank transaction — only need amount and date
    let date = null;
    let cleaned = lower;
    let m = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); }
    if (!date) { m = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) { date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); } }
    if (!date) { m = cleaned.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2}),?\s*(\d{4})/); if (m) { date = `${m[3]}-${MONTHS_MAP[m[1].slice(0, 3)]}-${m[2].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); } }
    if (!date) { m = cleaned.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*,?\s*(\d{4})/); if (m) { date = `${m[3]}-${MONTHS_MAP[m[2].slice(0, 3)]}-${m[1].padStart(2, '0')}`; cleaned = cleaned.replace(m[0], ' '); } }
    let amount = null;
    m = cleaned.match(/\$\s?([\d,]+(?:\.\d+)?)\s*([km])?/i);
    if (m) { amount = parseFloat(m[1].replace(/,/g, '')); if (m[2]?.toLowerCase() === 'k') amount *= 1000; if (m[2]?.toLowerCase() === 'm') amount *= 1000000; }
    if (!amount) { m = cleaned.match(/\b(\d[\d,]*(?:\.\d+)?)\s*([km])\b/i); if (m) { amount = parseFloat(m[1].replace(/,/g, '')); if (m[2].toLowerCase() === 'k') amount *= 1000; if (m[2].toLowerCase() === 'm') amount *= 1000000; } }
    if (!amount) { m = cleaned.match(/\b(\d[\d,]*(?:\.\d+)?)\b/); if (m && parseFloat(m[1].replace(/,/g, '')) >= 1) amount = parseFloat(m[1].replace(/,/g, '')); }
    return { type: isDeposit ? 'deposit' : 'withdraw', amount, date, asset: '_BANK', sellAll: false, sellFraction: null };
  }
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

// Compose a polished share image with premium styling
const composeShareImage = (rawBlob, isDark) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const pad = 80;
      const radius = 32;
      const brandH = 56;
      const w = img.width + pad * 2;
      const h = img.height + pad * 2 + brandH;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');

      // Rich gradient background
      const bgGrad = ctx.createLinearGradient(0, 0, w, h);
      if (isDark) {
        bgGrad.addColorStop(0, '#0c1222');
        bgGrad.addColorStop(0.3, '#141e33');
        bgGrad.addColorStop(0.7, '#111827');
        bgGrad.addColorStop(1, '#0c1222');
      } else {
        bgGrad.addColorStop(0, '#c7d2fe');
        bgGrad.addColorStop(0.3, '#e0e7ff');
        bgGrad.addColorStop(0.7, '#ddd6fe');
        bgGrad.addColorStop(1, '#c7d2fe');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle radial glow behind the card
      const glow = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, w * 0.6);
      if (isDark) {
        glow.addColorStop(0, 'rgba(59,130,246,0.08)');
        glow.addColorStop(0.5, 'rgba(139,92,246,0.04)');
        glow.addColorStop(1, 'transparent');
      } else {
        glow.addColorStop(0, 'rgba(99,102,241,0.12)');
        glow.addColorStop(0.5, 'rgba(139,92,246,0.06)');
        glow.addColorStop(1, 'transparent');
      }
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Card shadow (double layer for depth)
      ctx.save();
      ctx.shadowColor = isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 60;
      ctx.shadowOffsetY = 20;
      ctx.beginPath();
      ctx.roundRect(pad, pad, img.width, img.height, radius);
      ctx.fillStyle = isDark ? '#1e293b' : '#ffffff';
      ctx.fill();
      ctx.restore();

      // Draw screenshot with rounded clip
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad, pad, img.width, img.height, radius);
      ctx.clip();
      ctx.drawImage(img, pad, pad);
      ctx.restore();

      // Subtle border on card
      ctx.beginPath();
      ctx.roundRect(pad, pad, img.width, img.height, radius);
      ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(99,102,241,0.15)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Branding bar
      const brandY = h - brandH + 8;
      ctx.textAlign = 'center';
      // App name
      const fontSize = Math.round(w * 0.022);
      ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.3)';
      ctx.fillText('WHAT I HAVE', w / 2, brandY + fontSize * 0.4);
      // Accent dot
      ctx.beginPath();
      ctx.arc(w / 2 - fontSize * 2.8, brandY + fontSize * 0.12, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();

      c.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.src = URL.createObjectURL(rawBlob);
  });

// ─── Intraday Price Picker ──────────────────────────────────────────────────

const IntradayPricePicker = ({ ticker, date, price, onPriceChange, accentColor = 'emerald' }) => {
  const [expanded, setExpanded] = useState(false);
  const [intradayData, setIntradayData] = useState(null); // null = not fetched, [] = no data
  const [loading, setLoading] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const chartRef = useRef(null);

  const ringClass = `focus:ring-${accentColor}-500`;

  // Fetch intraday data when expanded and ticker+date are available
  useEffect(() => {
    if (!expanded || !ticker || !date) return;
    setLoading(true);
    fetchIntradayPrices(ticker, date).then((data) => {
      setIntradayData(data || []);
      setLoading(false);
    }).catch(() => {
      setIntradayData([]);
      setLoading(false);
    });
  }, [expanded, ticker, date]);

  if (price == null && !expanded) {
    return (
      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Price per Unit</label>
        <button onClick={() => { setExpanded(true); setIntradayData(null); }} className="w-full bg-slate-100 dark:bg-slate-700 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-400 text-left hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
          Closing Price (default) — tap to override
        </button>
      </div>
    );
  }

  if (price != null && !expanded) {
    return (
      <div>
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Price per Unit</label>
        <div className="flex items-center gap-2">
          <button onClick={() => { setExpanded(true); setIntradayData(null); }} className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 text-left hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            <DollarSign className="w-3 h-3 inline -mt-0.5 mr-0.5 text-slate-400" />{Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </button>
          <button onClick={() => { onPriceChange(null); setExpanded(false); }} className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors" title="Use closing price">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Expanded state — show chart or input
  const hasData = intradayData && intradayData.length > 0;
  const minPrice = hasData ? Math.min(...intradayData.map((d) => d.price)) : 0;
  const maxPrice = hasData ? Math.max(...intradayData.map((d) => d.price)) : 0;
  const priceRange = maxPrice - minPrice || 1;

  const handleChartClick = (e) => {
    if (!hasData || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.min(intradayData.length - 1, Math.max(0, Math.round((x / rect.width) * (intradayData.length - 1))));
    onPriceChange(Math.round(intradayData[idx].price * 100) / 100);
    setExpanded(false);
  };

  const handleChartHover = (e) => {
    if (!hasData || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.min(intradayData.length - 1, Math.max(0, Math.round((x / rect.width) * (intradayData.length - 1))));
    setHoveredIdx(idx);
  };

  return (
    <div>
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Price per Unit</label>
      <div className="bg-slate-100 dark:bg-slate-700 rounded-xl p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-4 gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-bold">Loading intraday prices…</span>
          </div>
        ) : hasData ? (
          <>
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400">
              <span>{intradayData[0].hour}</span>
              {hoveredIdx != null && (
                <span className="text-slate-600 dark:text-slate-200 font-black">
                  {intradayData[hoveredIdx].hour} — ${intradayData[hoveredIdx].price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              <span>{intradayData[intradayData.length - 1].hour}</span>
            </div>
            <div
              ref={chartRef}
              className="relative h-16 cursor-crosshair"
              onClick={handleChartClick}
              onMouseMove={handleChartHover}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <svg viewBox={`0 0 ${intradayData.length - 1} 100`} className="w-full h-full" preserveAspectRatio="none">
                <polyline
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                  points={intradayData.map((d, i) => `${i},${100 - ((d.price - minPrice) / priceRange) * 90 - 5}`).join(' ')}
                />
              </svg>
              {hoveredIdx != null && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-blue-400 pointer-events-none"
                  style={{ left: `${(hoveredIdx / (intradayData.length - 1)) * 100}%` }}
                />
              )}
            </div>
            <p className="text-[10px] font-bold text-slate-400 text-center">Click on the chart to pick a price</p>
          </>
        ) : (
          <>
            <p className="text-[10px] font-bold text-slate-400 text-center py-1">No intraday data available for this date</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
              <input type="number" value={price ?? ''} onChange={(e) => onPriceChange(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
                placeholder="Enter price manually" autoFocus
                className={`w-full bg-white dark:bg-slate-800 border-none rounded-xl py-2.5 pl-8 pr-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 ${ringClass} outline-none`} />
            </div>
          </>
        )}
        <div className="flex gap-2">
          <button onClick={() => { onPriceChange(null); setExpanded(false); }} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors">
            Use Closing Price
          </button>
        </div>
      </div>
    </div>
  );
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
  const [hiddenAssets, setHiddenAssets] = useState(() => {
    try { return new Set(savedPortfolio?.hiddenAssets || []); } catch { return new Set(); }
  });
  const [chartPage, setChartPage] = useState(0); // 0 = net worth, 1 = performance, 2 = line, 3 = pie, 4 = deposits vs value, 5 = returns by asset, 6 = asset price
  const CHART_PAGES = 8;
  const CHART_CATEGORIES = { all: [0, 3, 4], stocks: [1, 2, 5, 6], bank: [7] };
  const [chartCategory, setChartCategory] = useState('all');
  const categoryPages = CHART_CATEGORIES[chartCategory];
  const CHART_RANGES = ['24H', '1W', '1M', '6M', '12M', 'YTD', '5Y', 'ALL'];
  const [chartRange, setChartRange] = useState('ALL');
  const [priceAssetIdx, setPriceAssetIdx] = useState(0);
  const [liveQuotes, setLiveQuotes] = useState({});  // { ticker: { price, date } }
  const [pieMode, setPieMode] = useState(0); // 0 = allocation, 1 = return
  const [perfMode, setPerfMode] = useState(0); // 0 = %, 1 = $
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('investo-dark') === 'true'; } catch { return false; }
  });

  // --- Modal ---
  const [modalMode, setModalMode] = useState(null);           // 'buy' | 'sell' | 'deposit' | 'withdraw' | 'edit' | 'import' | 'insights' | null
  const [stagedAsset, setStagedAsset] = useState(null);       // { symbol, name } — buy step 2
  const [sellTicker, setSellTicker] = useState(null);         // ticker — sell step 2
  const [modalAmount, setModalAmount] = useState(DEFAULT_AMOUNT);
  const [modalDate, setModalDate] = useState(fiveYearsAgo.toISOString().split('T')[0]);
  const [modalPrice, setModalPrice] = useState(null);          // null = closing price, number = custom
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [addTxOpen, setAddTxOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState(null); // 'capturing' | 'done' | 'error' | null
  const [shareResult, setShareResult] = useState(null); // { url, blob }
  const [deletedTx, setDeletedTx] = useState(null); // For undo functionality
  const [undoTimer, setUndoTimer] = useState(null);

  const chartRef = useRef(null);
  const statsRef = useRef(null);
  const tableRef = useRef(null);

  const colorIdx = useRef(savedPortfolio?.colorIdx || 0);
  const fetchedRangesRef = useRef({});  // { ticker: startDate } — tracks what we've already fetched

  // ─── Derived ───────────────────────────────────────────────────────────────

  const selectedTickers = useMemo(
    () => [...new Set(transactions.filter((tx) => tx.ticker !== CASH_TICKER).map((tx) => tx.ticker))],
    [transactions],
  );

  const hasCashTx = useMemo(
    () => transactions.some((tx) => tx.ticker === CASH_TICKER),
    [transactions],
  );

  const totalDeposits = useMemo(
    () => transactions.reduce((s, tx) => s + (tx.type === 'buy' || tx.type === 'deposit' ? tx.amount : 0), 0),
    [transactions],
  );
  
  const totalWithdrawals = useMemo(
    () => transactions.reduce((s, tx) => s + (tx.type === 'sell' || tx.type === 'withdraw' ? tx.amount : 0), 0),
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
        (s, tx) => s + (tx.type === 'buy' || tx.type === 'deposit' ? tx.amount : -tx.amount), 0,
      );
      return net > 0;
    });
  }, [selectedTickers, chartData, txByTicker]);

  const visibleTransactions = useMemo(
    () => transactions.filter((tx) => !hiddenAssets.has(tx.ticker)),
    [transactions, hiddenAssets],
  );

  // ─── Search

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
    setModalPrice(null);
    setStagedAsset(null);
    setModalMode('buy');
  }, [transactions]);

  const openSellModal = useCallback((preselectedTicker = null) => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPrice(null);
    setSellTicker(preselectedTicker);
    setModalMode('sell');
  }, []);

  const openDepositModal = useCallback(() => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalMode('deposit');
  }, []);

  const openWithdrawModal = useCallback(() => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalMode('withdraw');
  }, []);

  const openBuyForTicker = useCallback((ticker) => {
    const asset = selectedAssets[ticker];
    if (!asset) return;
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPrice(null);
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
    // Ensure amount is always a number
    const amount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount) || 0;
    setModalAmount(amount);
    // Ensure date is always a string
    const date = typeof tx.date === 'string' ? tx.date : String(tx.date || TODAY);
    setModalDate(date);
    setModalPrice(tx.price || null);
    setModalMode('edit');
  }, []);

  const saveEdit = useCallback((overrideAmount = null, overrideDate = null, overridePrice = null) => {
    if (!editingTx) return;
    const rawAmount = overrideAmount !== null ? overrideAmount : modalAmount;
    // Convert to number if it's a string
    const numAmount = typeof rawAmount === 'string' ? Number(rawAmount) : rawAmount;
    // Ensure amount is a valid number
    const amountToSave = (!isNaN(numAmount) && isFinite(numAmount) && numAmount > 0) 
      ? numAmount 
      : (editingTx.amount || DEFAULT_AMOUNT);
    const dateToSave = overrideDate !== null ? overrideDate : modalDate;
    const priceToSave = overridePrice !== null ? overridePrice : modalPrice;
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== editingTx.id) return tx;
        const updated = { ...tx, amount: amountToSave, date: dateToSave };
        if (priceToSave) updated.price = priceToSave;
        else delete updated.price;
        return updated;
      }),
    );
    closeModal();
  }, [editingTx, modalAmount, modalDate, modalPrice, closeModal]);

  // ─── Transaction actions ───────────────────────────────────────────────────

  const addBuy = useCallback((symbol, name) => {
    const ticker = symbol.toUpperCase();
    if (!selectedAssets[ticker]) {
      const color = COLORS[colorIdx.current % COLORS.length];
      colorIdx.current++;
      setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    }
    // Ensure amount is a valid number
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0) 
      ? modalAmount 
      : DEFAULT_AMOUNT;
    const tx = { id: nextTxId++, ticker, type: 'buy', amount: validAmount, date: modalDate };
    if (modalPrice) tx.price = modalPrice;
    setTransactions((prev) => [...prev, tx]);
  }, [modalAmount, modalDate, modalPrice, selectedAssets]);

  const addSell = useCallback((ticker) => {
    // Ensure amount is a valid number
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0) 
      ? modalAmount 
      : DEFAULT_AMOUNT;
    const tx = { id: nextTxId++, ticker, type: 'sell', amount: validAmount, date: modalDate };
    if (modalPrice) tx.price = modalPrice;
    setTransactions((prev) => [...prev, tx]);
  }, [modalAmount, modalDate, modalPrice]);

  const addCashTx = useCallback((type) => {
    if (!selectedAssets[CASH_TICKER]) {
      setSelectedAssets((prev) => ({ ...prev, [CASH_TICKER]: { name: 'Bank Account', color: '#6366f1' } }));
    }
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0)
      ? modalAmount
      : DEFAULT_AMOUNT;
    const tx = { id: nextTxId++, ticker: CASH_TICKER, type, amount: validAmount, date: modalDate };
    setTransactions((prev) => [...prev, tx]);
  }, [modalAmount, modalDate, selectedAssets]);

  // ─── Quick Add (AI)

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
        // Handle bank transactions directly
        if (parsed.asset === '_BANK') {
          const resolved = { ticker: CASH_TICKER, name: 'Bank Account', type: parsed.type, amount: parsed.amount || DEFAULT_AMOUNT, date: parsed.date || TODAY };
          if (quickAddVerify) {
            setQuickAddPreview(resolved);
            setQuickAddStatus(null);
          } else {
            if (!selectedAssets[CASH_TICKER]) {
              const color = COLORS[colorIdx.current % COLORS.length];
              colorIdx.current++;
              setSelectedAssets((prev) => ({ ...prev, [CASH_TICKER]: { name: 'Bank Account', color } }));
            }
            setTransactions((prev) => [...prev, { id: nextTxId++, ...resolved }]);
            setQuickAddText('');
            setQuickAddStatus(null);
          }
          return;
        }
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
    const priceIdx = header.findIndex((h) => h === 'price');
    const hasHeader = dateIdx >= 0 && tickerIdx >= 0;
    const rows = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim());
      const date = cols[hasHeader ? dateIdx : 0];
      const ticker = (cols[hasHeader ? tickerIdx : 1] || '').toUpperCase();
      const name = hasHeader && nameIdx >= 0 ? cols[nameIdx] : '';
      const action = (cols[hasHeader ? actionIdx : 2] || '').toLowerCase();
      const amount = parseFloat(cols[hasHeader ? amountIdx : 3]);
      const price = hasHeader && priceIdx >= 0 ? parseFloat(cols[priceIdx]) : NaN;
      const isCashAction = action === 'deposit' || action === 'withdraw';
      if (date && (isCashAction || (ticker && (action === 'buy' || action === 'sell'))) && amount > 0) {
        const row = {
          date,
          ticker: isCashAction ? CASH_TICKER : ticker,
          name: isCashAction ? 'Bank Account' : (name || ticker),
          type: action,
          amount,
        };
        if (!isNaN(price) && price > 0) row.price = price;
        rows.push(row);
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
        const color = row.ticker === CASH_TICKER ? '#6366f1' : COLORS[colorIdx.current % COLORS.length];
        newAssets[row.ticker] = { name: row.name, color };
        if (row.ticker !== CASH_TICKER) colorIdx.current++;
      }
      const importedTx = { id: nextTxId++, ticker: row.ticker, type: row.type, amount: row.amount, date: row.date };
      if (row.price) importedTx.price = row.price;
      newTxs.push(importedTx);
    });
    setSelectedAssets(newAssets);
    setTransactions((prev) => [...prev, ...newTxs]);
    setImportText('');
    setModalMode(null);
  }, [importParsed, selectedAssets]);

  const exportCSV = useCallback(() => {
    const headers = 'Date,Asset,Name,Action,Amount,Price';
    const rows = transactions.map((tx) => {
      const isCash = tx.ticker === CASH_TICKER;
      const name = isCash ? 'Bank Account' : (selectedAssets[tx.ticker]?.name || tx.ticker).replace(/,/g, ' ');
      const ticker = isCash ? 'CASH' : tx.ticker;
      return `${tx.date},${ticker},${name},${tx.type},${tx.amount},${tx.price || ''}`;
    });
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'what-i-have-transactions.csv';
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
      // Build portfolio summary for AI - exclude Total Portfolio and hidden assets
      const summary = stats
        .filter(stat => stat.ticker !== null && !hiddenAssets.has(stat.ticker) && stat.ticker !== CASH_TICKER)
        .map(stat => ({
          name: stat.name,
          ticker: stat.ticker,
          currentValue: stat.finalValue,
          totalReturn: stat.finalValue + stat.totalWithdrawals - stat.totalDeposits,
          totalReturnPct: stat.totalDeposits > 0 ? ((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits * 100) : 0,
          annualizedReturn: stat.annualizedReturn * 100, // Convert to percentage
          maxDrawdown: stat.maxDrawdown,
        }));

      // Compute visible-only totals matching the Overview panel
      const visTxs = transactions.filter(tx => !hiddenAssets.has(tx.ticker));
      const lastPoint = chartData[chartData.length - 1];
      const visibleStockTickers = [...new Set(visTxs.filter(tx => tx.ticker !== CASH_TICKER).map(tx => tx.ticker))];
      const stockBuys = visTxs.reduce((s, tx) => s + (tx.type === 'buy' ? tx.amount : 0), 0);
      const stockSells = visTxs.reduce((s, tx) => s + (tx.type === 'sell' ? tx.amount : 0), 0);
      const stockValue = visibleStockTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
      const stockReturn = stockValue + stockSells - stockBuys;
      const bankDeposited = visTxs.reduce((s, tx) => s + (tx.type === 'deposit' ? tx.amount : 0), 0);
      const bankWithdrawn = visTxs.reduce((s, tx) => s + (tx.type === 'withdraw' ? tx.amount : 0), 0);
      const bankBalance = bankDeposited - bankWithdrawn;
      const netWorth = stockValue + bankBalance;

      const requestBody = { 
        summary,
        netWorth,
        stockValue,
        stockInvested: stockBuys,
        stockSold: stockSells,
        stockReturn,
        bankBalance,
        bankDeposited,
        bankWithdrawn,
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
  }, [supabase, stats, chartData, transactions, hiddenAssets]);

  const removeTx = useCallback((txId) => {
    // Clear any existing timer first
    setUndoTimer((prev) => {
      if (prev) clearTimeout(prev);
      return null;
    });
    
    setTransactions((prev) => {
      const txToDelete = prev.find((tx) => tx.id === txId);
      if (!txToDelete) return prev;
      
      const next = prev.filter((tx) => tx.id !== txId);
      // Check if this ticker will be completely removed
      const remaining = new Set(next.map((tx) => tx.ticker));
      const tickerWillBeRemoved = !remaining.has(txToDelete.ticker);
      
      // Store the deleted transaction for undo, including asset info if it will be removed
      const deletedAsset = tickerWillBeRemoved && selectedAssets[txToDelete.ticker]
        ? { [txToDelete.ticker]: selectedAssets[txToDelete.ticker] }
        : null;
      
      setDeletedTx({ tx: txToDelete, asset: deletedAsset });
      
      // Set new timer to permanently delete after 5 seconds
      const timer = setTimeout(() => {
        setDeletedTx(null);
        setUndoTimer(null);
      }, 5000);
      setUndoTimer(timer);
      
      // Clean up selectedAssets and fetchedRanges if ticker has no more transactions
      if (tickerWillBeRemoved) {
        setSelectedAssets((sa) => {
          const out = { ...sa };
          delete out[txToDelete.ticker];
          delete fetchedRangesRef.current[txToDelete.ticker];
          return out;
        });
      }
      
      return next;
    });
  }, [selectedAssets]);
  
  const undoDelete = useCallback(() => {
    const currentDeleted = deletedTx;
    if (!currentDeleted) return;
    
    // Clear the timer immediately
    setUndoTimer((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
      return null;
    });
    
    // Clear undo state immediately (removes the toast)
    setDeletedTx(null);
    
    // Restore the transaction
    setTransactions((txs) => [...txs, currentDeleted.tx]);
    
    // Restore asset if it was removed
    if (currentDeleted.asset) {
      setSelectedAssets((assets) => ({ ...assets, ...currentDeleted.asset }));
    }
  }, [deletedTx]);

  const toggleHideAsset = useCallback((ticker) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  // ─── Persistence ───────────────────────────────────────────────────────────────

  // Save to localStorage on every change
  useEffect(() => {
    if (isHydratingRef.current) return;
    try {
      // Create clean copies to avoid any circular references
      const cleanTransactions = transactions.map((tx) => {
        // Only include primitive values, ensure types are correct
        const clean = {
          id: typeof tx.id === 'number' ? tx.id : Number(tx.id),
          ticker: String(tx.ticker || ''),
          type: String(tx.type || 'buy'),
          amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount) || 0,
          date: String(tx.date || TODAY)
        };
        if (tx.price != null && typeof tx.price === 'number') {
          clean.price = tx.price;
        }
        return clean;
      });
      
      // Safely extract selectedAssets properties
      const cleanSelectedAssets = {};
      for (const [key, value] of Object.entries(selectedAssets)) {
        if (value && typeof value === 'object') {
          cleanSelectedAssets[String(key)] = {
            name: String(value.name || ''),
            color: String(value.color || COLORS[0])
          };
        }
      }
      
      const dataToSave = {
        transactions: cleanTransactions,
        selectedAssets: cleanSelectedAssets,
        colorIdx: typeof colorIdx.current === 'number' ? colorIdx.current : 0,
        hiddenAssets: [...hiddenAssets],
      };
      
      localStorage.setItem(LS_KEY, JSON.stringify(dataToSave));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      // Try to save with minimal data as fallback
      try {
        const minimalData = {
          transactions: transactions.map(({ id, ticker, type, amount, date, price }) => ({
            id: Number(id),
            ticker: String(ticker),
            type: String(type),
            amount: Number(amount),
            date: String(date),
            ...(price != null && { price: Number(price) })
          })),
          selectedAssets: {},
          colorIdx: 0,
          hiddenAssets: [...hiddenAssets],
        };
        localStorage.setItem(LS_KEY, JSON.stringify(minimalData));
      } catch (fallbackError) {
        console.error('Fallback save also failed:', fallbackError);
      }
    }
  }, [transactions, selectedAssets, hiddenAssets]);

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
            setHiddenAssets(new Set(data.hidden_assets || []));
            colorIdx.current = data.color_idx || 0;
            nextTxId = Math.max(...data.transactions.map((t) => t.id), 0) + 1;
            localStorage.setItem(LS_KEY, JSON.stringify({
              transactions: data.transactions, selectedAssets: data.selected_assets || {}, colorIdx: data.color_idx || 0,
              hiddenAssets: data.hidden_assets || [],
            }));
            setTimeout(() => { isHydratingRef.current = false; }, 200);
          }
          if (data) {
            if (data.dark_mode != null) {
              setDark(data.dark_mode);
              localStorage.setItem('investo-dark', String(data.dark_mode));
            } else {
              // First sign-in after adding column — persist current local preference
              const currentDark = localStorage.getItem('investo-dark') === 'true';
              supabase.from('portfolios').update({ dark_mode: currentDark }).eq('user_id', u.id);
            }
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
          hidden_assets: [...hiddenAssets],
          color_idx: colorIdx.current,
          dark_mode: dark,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch { /* silent */ }
      setIsSyncing(false);
    }, 1500);
    return () => { clearTimeout(t); setIsSyncing(false); };
  }, [transactions, selectedAssets, hiddenAssets, user, dark]);

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
    setHiddenAssets(new Set());
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
    const allTickers = [...new Set(transactions.map((tx) => tx.ticker))];
    const tickers = allTickers.filter((t) => t !== CASH_TICKER);
    const hasCash = allTickers.includes(CASH_TICKER);
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
    // Also need to update if cash was added but no market tickers exist
    if (!needsFetch && !(hasCash && tickers.length === 0 && !fetched[CASH_TICKER])) return;

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setIsSimulating(true);
      setFetchError(null);
      try {
        const prices = tickers.length > 0 ? await fetchPrices(dateRanges) : {};
        if (!cancelled) {
          tickers.forEach((t) => {
            if (prices[t]?.length > 0) fetched[t] = globalStart;
          });
          // Generate synthetic _CASH price data at $1 for every day so the time axis stays linear
          if (hasCash) {
            const cashEntries = [];
            const startD = new Date(fetchStart);
            const endD = new Date(TODAY);
            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
              cashEntries.push({ date: d.toISOString().split('T')[0], price: 1 });
            }
            prices[CASH_TICKER] = cashEntries;
            fetched[CASH_TICKER] = globalStart;
          }
          setPriceCache((prev) => {
            const next = {};
            allTickers.forEach((t) => {
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

  // ─── Merge live quotes into price cache ─────────────────────────────────────

  const livePriceCache = useMemo(() => {
    if (!priceCache) return null;
    const merged = {};
    for (const [ticker, prices] of Object.entries(priceCache)) {
      const liveQ = liveQuotes[ticker];
      if (!liveQ || !prices?.length) {
        merged[ticker] = prices;
        continue;
      }
      const last = prices[prices.length - 1];
      if (last.date < liveQ.date) {
        merged[ticker] = [...prices, { date: liveQ.date, price: liveQ.price }];
      } else if (last.date === liveQ.date) {
        merged[ticker] = [...prices.slice(0, -1), { date: liveQ.date, price: liveQ.price }];
      } else {
        merged[ticker] = prices;
      }
    }
    return merged;
  }, [priceCache, liveQuotes]);

  // ─── Recompute chart ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!livePriceCache || visibleTransactions.length === 0) {
      setChartData([]);
      setStats([]);
      return;
    }

    const activeTx = visibleTransactions.filter((tx) => livePriceCache[tx.ticker]?.length > 0);
    if (activeTx.length === 0) { setChartData([]); setStats([]); return; }

    const data = simulate(livePriceCache, activeTx);
    setChartData(data);

    const tickers = [...new Set(activeTx.map((tx) => tx.ticker))];
    const names = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.name]),
    );
    const colors = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.color]),
    );
    setStats(computeStats(data, tickers, activeTx, names, colors));
  }, [livePriceCache, visibleTransactions, selectedAssets]);

  const chartTickers = selectedTickers.filter((t) => !hiddenAssets.has(t) && livePriceCache?.[t]);

  const chartRangeCutoff = useMemo(() => {
    if (chartRange === 'ALL') return null;
    const now = new Date();
    switch (chartRange) {
      case '24H': now.setDate(now.getDate() - 1); break;
      case '1W': now.setDate(now.getDate() - 7); break;
      case '1M': now.setMonth(now.getMonth() - 1); break;
      case '6M': now.setMonth(now.getMonth() - 6); break;
      case '12M': now.setFullYear(now.getFullYear() - 1); break;
      case 'YTD': return `${now.getFullYear()}-01-01`;
      case '5Y': now.setFullYear(now.getFullYear() - 5); break;
      default: return null;
    }
    return now.toISOString().split('T')[0];
  }, [chartRange]);

  const filteredChartData = useMemo(() => {
    if (!chartRangeCutoff || chartData.length === 0) return chartData;
    return chartData.filter(p => p.date >= chartRangeCutoff);
  }, [chartData, chartRangeCutoff]);

  const oldestStockTxDate = useMemo(() => {
    const stockTxs = visibleTransactions.filter(tx => tx.ticker !== CASH_TICKER);
    if (stockTxs.length === 0) return null;
    return stockTxs.reduce((min, tx) => tx.date < min ? tx.date : min, stockTxs[0].date);
  }, [visibleTransactions]);

  const filteredStockChartData = useMemo(() => {
    if (!oldestStockTxDate) return filteredChartData;
    // Pad 30 days before first stock tx, same as the global fetch padding
    const padded = new Date(oldestStockTxDate);
    padded.setDate(padded.getDate() - 30);
    const stockStart = padded.toISOString().split('T')[0];
    const cutoff = chartRangeCutoff && chartRangeCutoff > stockStart ? chartRangeCutoff : stockStart;
    return chartData.filter(p => p.date >= cutoff);
  }, [chartData, chartRangeCutoff, oldestStockTxDate, filteredChartData]);

  // ─── Live quotes for all tickers

  useEffect(() => {
    if (!priceCache) return;
    const tickers = Object.keys(priceCache).filter((t) => t !== CASH_TICKER && priceCache[t]?.length > 0);
    if (tickers.length === 0) return;
    // Only fetch tickers we don't already have a quote for today
    const needed = tickers.filter((t) => liveQuotes[t]?.date !== TODAY);
    if (needed.length === 0) return;
    let cancelled = false;
    Promise.all(needed.map((t) => fetchQuote(t).then((q) => [t, q]).catch(() => [t, null])))
      .then((results) => {
        if (cancelled) return;
        const updates = {};
        results.forEach(([t, q]) => { if (q) updates[t] = q; });
        if (Object.keys(updates).length > 0) {
          setLiveQuotes((prev) => ({ ...prev, ...updates }));
        }
      });
    return () => { cancelled = true; };
  }, [priceCache]);

  // Build two marker sets: per-asset line + Total Portfolio line
  const { assetMarkers, portfolioMarkers } = useMemo(() => {
    if (chartData.length === 0) return { assetMarkers: [], portfolioMarkers: [] };
    const dateIndex = new Map(chartData.map((p, i) => [p.date, i]));
    const asset = [];
    const portfolio = [];
    visibleTransactions.forEach((tx) => {
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
  }, [chartData, visibleTransactions]);

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
    const next = !dark;
    setDark(next);
    localStorage.setItem('investo-dark', next);
    if (supabase && user) {
      supabase.from('portfolios').update({ dark_mode: next }).eq('user_id', user.id);
    }
  }, [dark, user]);


  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans p-4 md:p-8${dark ? ' dark' : ''}`}>
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Menu */}
        <div className="flex items-center">
          <button
            onClick={() => setAddTxOpen(true)}
            className="px-4 py-2 rounded-2xl font-bold transition-all flex items-center gap-2 shadow-lg active:scale-95 bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            New Transaction
          </button>
          <div className="ml-auto">
          <div className="relative flex">
            <button
              onClick={() => setAboutOpen((v) => !v)}
              className="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 transition-all flex items-center"
              title="Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            {aboutOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAboutOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-5 z-50 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2.5 rounded-xl shadow-lg shadow-blue-200 dark:shadow-blue-900">
                      <BarChart3 className="text-white w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase">What I Have</h3>
                      <span className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 text-[9px] font-black px-1.5 py-1 rounded-full inline-flex items-center gap-1 uppercase tracking-wider leading-none">
                        <Zap className="w-2.5 h-2.5 fill-current flex-shrink-0" /> Real Market Data
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
Record your wealth. Stocks use real market data from Yahoo Finance.
                  </p>
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    {user ? (
                      <button
                        onClick={() => { signOut(); setAboutOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                        {user.avatar ? (
                          <img src={user.avatar} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                        ) : (
                          <LogOut className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        )}
                        <div>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">Sign out</p>
                          <p className="text-[10px] text-slate-400 text-left">{user.name || user.email}</p>
                        </div>
                      </button>
                    ) : supabase ? (
                      <button
                        onClick={() => { signInWithGoogle(); setAboutOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                      >
                        <LogIn className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                        <div>
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">Sign in</p>
                          <p className="text-[10px] text-slate-400 text-left">Sync your portfolio</p>
                        </div>
                      </button>
                    ) : null}
                    <button
                      onClick={() => { toggleDark(); setAboutOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                      {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600 dark:text-slate-300" />}
                      <div>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">{dark ? 'Light mode' : 'Dark mode'}</p>
                        <p className="text-[10px] text-slate-400 text-left">Switch appearance</p>
                      </div>
                    </button>
                  </div>
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={() => { setImportText(''); setModalMode('import'); setAboutOpen(false); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <div>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">Import</p>
                        <p className="text-[10px] text-slate-400 text-left">CSV or Google Sheets</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportCSV(); setAboutOpen(false); }}
                      disabled={transactions.length === 0}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors disabled:opacity-40"
                    >
                      <Download className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <div>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">Export</p>
                        <p className="text-[10px] text-slate-400 text-left">Download as CSV</p>
                      </div>
                    </button>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <a
                      href="https://github.com/sdaveas/investo-js"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                      <Github className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">GitHub</p>
                    </a>
                    <a
                      href="https://buymeacoffee.com/br3gan"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                      <Coffee className="w-4 h-4 text-amber-500" />
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Buy me a coffee</p>
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          {sidebarOpen && (
          <aside className="lg:col-span-4 space-y-4">

            {/* Overview */}
            {(selectedTickers.length > 0 || hasCashTx) && (
            <div className="bg-slate-900 text-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] shadow-2xl space-y-4">
              <button onClick={() => setOverviewOpen(v => !v)} className="w-full flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Overview
                  </h3>
                  {supabase && stats.length > 0 && (
                    <span
                      onClick={(e) => { e.stopPropagation(); generateAIInsights(); }}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors text-[10px] font-bold ${isGeneratingInsights ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {isGeneratingInsights ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Insights
                    </span>
                  )}
                </div>
                <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${overviewOpen ? 'rotate-90' : ''}`} />
              </button>

              {overviewOpen && (() => {
                const lastPoint = chartData[chartData.length - 1];
                const visTxs = transactions.filter(tx => !hiddenAssets.has(tx.ticker));
                // Stock calculations
                const visibleStockTickers = selectedTickers.filter(t => !hiddenAssets.has(t));
                const stockBuys = visTxs.reduce((s, tx) => s + (tx.type === 'buy' ? tx.amount : 0), 0);
                const stockSells = visTxs.reduce((s, tx) => s + (tx.type === 'sell' ? tx.amount : 0), 0);
                const stockValue = visibleStockTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
                const stockReturn = stockValue + stockSells - stockBuys;
                const stockReturnPct = stockBuys > 0 ? (stockReturn / stockBuys) * 100 : 0;
                const stockPositive = stockReturn >= 0;
                // Bank calculations
                const bankDeposited = visTxs.reduce((s, tx) => s + (tx.type === 'deposit' ? tx.amount : 0), 0);
                const bankWithdrawn = visTxs.reduce((s, tx) => s + (tx.type === 'withdraw' ? tx.amount : 0), 0);
                const bankBalance = bankDeposited - bankWithdrawn;
                // Net worth
                const netWorth = stockValue + bankBalance;
                return (
                <div className="space-y-3">
                  {/* Stocks */}
                  {stockBuys > 0 && (
                  <div className="p-4 rounded-2xl border bg-emerald-500/10 border-emerald-500/20 space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Stocks Invested</p>
                        <p className="text-xl font-black text-white">{formatCurrency(stockBuys)}</p>
                      </div>
                      <p className="text-[10px] font-bold text-white/30">{visibleStockTickers.length} asset{visibleStockTickers.length !== 1 ? 's' : ''}</p>
                    </div>
                    {stockSells > 0 && (
                    <>
                      <div className="border-t border-white/10" />
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Stocks Sold</p>
                        <p className="text-xl font-black text-emerald-400">{formatCurrency(stockSells)}</p>
                      </div>
                    </>
                    )}
                    <div className="border-t border-white/10" />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Return</p>
                        <p className={`text-xl font-black ${stockPositive ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(stockReturn)}</p>
                      </div>
                      <span className={`text-xs font-black px-2 py-1 rounded-lg ${stockPositive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>{stockPositive ? '+' : ''}{stockReturnPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  )}
                  {/* Bank */}
                  {hasCashTx && !hiddenAssets.has(CASH_TICKER) && (
                  <div className="p-4 rounded-2xl border bg-indigo-500/10 border-indigo-500/20 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Bank Deposits</p>
                      <p className="text-xl font-black text-indigo-400">{formatCurrency(bankDeposited)}</p>
                    </div>
                    {bankWithdrawn > 0 && (
                    <>
                      <div className="border-t border-white/10" />
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Withdrawals</p>
                        <p className="text-xl font-black text-amber-400">{formatCurrency(bankWithdrawn)}</p>
                      </div>
                      <div className="border-t border-white/10" />
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Bank Balance</p>
                        <p className="text-xl font-black text-indigo-400">{formatCurrency(bankBalance)}</p>
                      </div>
                    </>
                    )}
                  </div>
                  )}
                  {/* Net Worth */}
                  <div className="p-4 rounded-2xl border bg-white/5 border-white/10">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Net Worth</p>
                        <p className="text-2xl font-black text-white">{formatCurrency(netWorth)}</p>
                      </div>
                      <p className="text-[10px] font-bold text-white/30">{transactions.length} tx</p>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
            )}

            {/* History */}
            {(selectedTickers.length > 0 || hasCashTx) && (
            <div className="bg-slate-900 text-white p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] shadow-2xl space-y-4">
              <button onClick={() => setHistoryOpen(v => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <History className="w-4 h-4" /> History
                </h3>
                <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
              </button>
              {historyOpen && <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
                {selectedTickers.map((ticker) => {
                  const asset = selectedAssets[ticker];
                  const txs = txByTicker[ticker] || [];
                  if (!asset || txs.length === 0) return null;
                  return (
                    <div key={ticker} className={`space-y-1.5 transition-opacity ${hiddenAssets.has(ticker) ? 'opacity-50' : ''}`}>
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
                        <button onClick={() => toggleHideAsset(ticker)} className={`p-1 rounded-lg transition-colors ${hiddenAssets.has(ticker) ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-slate-600/20 text-slate-500 hover:bg-slate-600/30'}`} title={hiddenAssets.has(ticker) ? 'Show in net worth' : 'Hide from net worth'}>
                          {hiddenAssets.has(ticker) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                      {txs.map((tx) => (
                        <div key={tx.id} onClick={() => openEditModal(tx)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all hover:brightness-125 ${tx.type === 'buy' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                          <span className="uppercase text-[10px] font-black w-8">{tx.type}</span>
                          <span className="flex-1 text-white/80">{formatCurrency(tx.amount)}{tx.price ? <span className="text-white/30 ml-1">@${tx.price}</span> : ''}</span>
                          <span className="text-white/40 text-[10px]">{formatShortDate(tx.date)}</span>
                          <button onClick={(e) => { e.stopPropagation(); removeTx(tx.id); }} className="text-white/20 hover:text-rose-400 p-0.5 transition-colors">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              {/* Bank Account transactions */}
              {hasCashTx && (() => {
                const cashTxs = txByTicker[CASH_TICKER] || [];
                const cashBalance = cashTxs.reduce((s, tx) => s + (tx.type === 'deposit' ? tx.amount : -tx.amount), 0);
                return (
                  <div className={`space-y-1.5 transition-opacity ${hiddenAssets.has(CASH_TICKER) ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Landmark className="w-3.5 h-3.5 text-indigo-400" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex-1 truncate">Bank Account</p>
                      <button onClick={openDepositModal} className="p-1 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors" title="Deposit">
                        <Plus className="w-3 h-3" />
                      </button>
                      {cashBalance > 0 && (
                        <button onClick={openWithdrawModal} className="p-1 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors" title="Withdraw">
                          <Minus className="w-3 h-3" />
                        </button>
                      )}
                      <button onClick={() => toggleHideAsset(CASH_TICKER)} className={`p-1 rounded-lg transition-colors ${hiddenAssets.has(CASH_TICKER) ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-slate-600/20 text-slate-500 hover:bg-slate-600/30'}`} title={hiddenAssets.has(CASH_TICKER) ? 'Show in net worth' : 'Hide from net worth'}>
                        {hiddenAssets.has(CASH_TICKER) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    {cashTxs.map((tx) => (
                      <div key={tx.id} onClick={() => openEditModal(tx)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all hover:brightness-125 ${tx.type === 'deposit' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                        <span className="uppercase text-[10px] font-black w-14">{tx.type === 'deposit' ? 'deposit' : 'withdraw'}</span>
                        <span className="flex-1 text-white/80">{formatCurrency(tx.amount)}</span>
                        <span className="text-white/40 text-[10px]">{formatShortDate(tx.date)}</span>
                        <button onClick={(e) => { e.stopPropagation(); removeTx(tx.id); }} className="text-white/20 hover:text-rose-400 p-0.5 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              </div>}
            </div>
            )}

          </aside>
          )}

          {/* ── Main ─────────────────────────────────────────────────────── */}
          <main className={`${sidebarOpen ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>

            {/* Chart */}
            {transactions.length > 0 && <div ref={chartRef} className={`bg-white dark:bg-slate-800 p-4 sm:p-6 ${chartsOpen ? 'md:p-8' : ''} rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 ${chartsOpen ? 'h-[380px] sm:h-[450px] md:h-[550px]' : ''} flex flex-col overflow-hidden relative`}>
              <button onClick={() => setChartsOpen(v => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> Graphs
                </h3>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${chartsOpen ? 'rotate-90' : ''}`} />
              </button>
              {chartsOpen && <>
              <div className="flex flex-wrap justify-between items-start mb-4 sm:mb-8 gap-y-3 relative z-10 mt-4">
                <div>
                  <h2 className="text-base sm:text-2xl font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase">
                    {['Net Worth', 'Performance', 'Transaction History', 'Allocation', 'Deposits vs Value', 'Returns by Asset', 'Asset Price', 'Bank Balance'][chartPage]}
                  </h2>
                  <p className="text-sm text-slate-400 italic font-medium">
                    {chartPage === 3
                      ? (pieMode === 0 ? 'Current portfolio breakdown' : 'Return contribution per asset')
                      : chartPage === 6
                        ? (chartTickers.length > 0 ? `${selectedAssets[chartTickers[priceAssetIdx % chartTickers.length]]?.name || chartTickers[priceAssetIdx % chartTickers.length]} — ${liveQuotes[chartTickers[priceAssetIdx % chartTickers.length]] ? 'live price' : 'historical closing price'}` : 'No assets')
                        : ['Total portfolio value over time', 'Stock returns over time', 'Historical data from Yahoo Finance', '', 'Invested capital vs portfolio value', 'Profit & loss per asset', '', 'Bank account balance over time'][chartPage]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2" data-share-hide>
                  {chartPage === 1 && chartData.length > 0 && chartTickers.length > 0 && (
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
                  {chartPage === 2 && chartData.length > 0 && chartTickers.length > 0 && (
                    <button
                      onClick={() => setShowMarkers((v) => !v)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${showMarkers ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}
                    >
                      {showMarkers ? '● Markers On' : '○ Markers Off'}
                    </button>
                  )}
                  {chartPage === 3 && chartData.length > 0 && (
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
                  {chartPage === 6 && chartData.length > 0 && chartTickers.length > 0 && (
                    <button
                      onClick={() => setShowMarkers((v) => !v)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${showMarkers ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}
                    >
                      {showMarkers ? '● Markers On' : '○ Markers Off'}
                    </button>
                  )}
                  {chartData.length > 0 && stats.length > 0 && (
                    <button
                      onClick={() => {
                        setShareOpen(true);
                      }}
                      className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                      title="Share"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const el = chartRef.current;
                      if (!el) return;
                      if (document.fullscreenElement) {
                        document.exitFullscreen();
                      } else {
                        el.requestFullscreen();
                      }
                    }}
                    className="hidden sm:inline-flex p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                    title="Fullscreen"
                  >
                    {document.fullscreenElement ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                  {chartData.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                        {Object.keys(CHART_CATEGORIES).map((cat) => (
                          <button
                            key={cat}
                            onClick={() => { setChartCategory(cat); setChartPage(CHART_CATEGORIES[cat][0]); }}
                            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${
                              chartCategory === cat
                                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { const i = categoryPages.indexOf(chartPage); setChartPage(categoryPages[(i - 1 + categoryPages.length) % categoryPages.length]); }}
                          className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-[10px] font-bold text-slate-400 w-8 text-center">{categoryPages.indexOf(chartPage) + 1}/{categoryPages.length}</span>
                        <button
                          onClick={() => { const i = categoryPages.indexOf(chartPage); setChartPage(categoryPages[(i + 1) % categoryPages.length]); }}
                          className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {[0, 1, 2, 4, 6, 7].includes(chartPage) && chartData.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2 -mt-2 sm:-mt-4" data-share-hide>
                  {CHART_RANGES.map(r => (
                    <button key={r} onClick={() => setChartRange(r)}
                      className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${
                        chartRange === r
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                          : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                      }`}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {chartPage === 6 && chartTickers.length > 1 && (
              <div className="absolute right-4 sm:right-6 md:right-8 top-[3.5rem] sm:top-[4.25rem] flex items-center gap-1 z-10" data-share-hide>
                  <button
                    onClick={() => setPriceAssetIdx((i) => (i - 1 + chartTickers.length) % chartTickers.length)}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-bold text-slate-400 w-8 text-center truncate">
                    {chartTickers[priceAssetIdx % chartTickers.length]}
                  </span>
                  <button
                    onClick={() => setPriceAssetIdx((i) => (i + 1) % chartTickers.length)}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-400 transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
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
                  // Net Worth — total portfolio value over time
                  const nwTickers = [...new Set(visibleTransactions.map(tx => tx.ticker).filter(t => livePriceCache?.[t]))];
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={filteredChartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => formatShort(v)} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v, n) => [formatCurrency(v), n]}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', color: dark ? '#94a3b8' : undefined }} onClick={handleLegendClick} />
                        {nwTickers.length > 1 && (
                          <Line type="monotone" dataKey="Total Portfolio" stroke={dark ? '#e2e8f0' : '#0f172a'} strokeWidth={3} dot={false} hide={hiddenSeries.has('Total Portfolio')} />
                        )}
                        {nwTickers.map((ticker) => {
                          const isCash = ticker === CASH_TICKER;
                          const asset = selectedAssets[ticker];
                          if (!asset) return null;
                          return (
                            <Line
                              key={ticker}
                              type={isCash ? 'stepAfter' : 'monotone'}
                              dataKey={ticker}
                              name={isCash ? 'Bank Account' : `${asset.name} (${ticker})`}
                              stroke={asset.color}
                              strokeWidth={nwTickers.length > 1 ? 2 : 3}
                              strokeDasharray={nwTickers.length > 1 ? '4 4' : undefined}
                              dot={false}
                              hide={hiddenSeries.has(ticker)}
                            />
                          );
                        })}
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()
                : chartPage === 1 ? (() => {
                  // Performance — stock return over time (stocks only)
                  const stockTxs = [...visibleTransactions].filter(tx => tx.type === 'buy' || tx.type === 'sell').sort((a, b) => a.date.localeCompare(b.date));
                  if (stockTxs.length === 0) return (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <p className="font-bold text-sm">No stock transactions yet</p>
                    </div>
                  );
                  const depositMap = new Map();
                  let cumDeposits = 0;
                  let cumWithdrawals = 0;
                  stockTxs.forEach((tx) => {
                    if (tx.type === 'buy') cumDeposits += tx.amount;
                    else cumWithdrawals += tx.amount;
                    depositMap.set(tx.date, { deposits: cumDeposits, withdrawals: cumWithdrawals });
                  });
                  let lastDep = 0;
                  let lastWith = 0;
                  const perfData = filteredStockChartData.map((p) => {
                    const d = depositMap.get(p.date);
                    if (d) { lastDep = d.deposits; lastWith = d.withdrawals; }
                    const pv = selectedTickers.filter(t => !hiddenAssets.has(t)).reduce((s, t) => s + (p[t] ?? 0), 0);
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
                : chartPage === 2 ? (() => {
                  // Transaction History — stocks only
                  if (chartTickers.length === 0) return (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <p className="font-bold text-sm">No stock transactions yet</p>
                    </div>
                  );
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={filteredStockChartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => formatShort(v)} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v, n) => [formatCurrency(v), n]}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', color: dark ? '#94a3b8' : undefined }} onClick={handleLegendClick} />
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
                              strokeWidth={2}
                              dot={false}
                              hide={hiddenSeries.has(ticker)}
                            />
                          );
                        })}
                        {showMarkers && assetMarkers.filter(m => !isCashTx(m) && (!chartRangeCutoff || m.chartDate >= chartRangeCutoff)).map((m) => (
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
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()
                : chartPage === 3 ? (() => {
                  const lastPoint = chartData[chartData.length - 1];
                  let pieData, total, isReturnMode = pieMode === 1;
                  if (!isReturnMode) {
                    const allocTickers = hasCashTx && (lastPoint?.[CASH_TICKER] ?? 0) > 0 ? [...chartTickers, CASH_TICKER] : chartTickers;
                    pieData = allocTickers
                      .map((ticker) => ({
                        name: ticker === CASH_TICKER ? 'Bank Account' : `${selectedAssets[ticker]?.name || ticker} (${ticker})`,
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

                : chartPage === 4 ? (() => {
                  // Deposits vs Value — area chart
                  const sortedTx = [...visibleTransactions].sort((a, b) => a.date.localeCompare(b.date));
                  const depositMap = new Map();
                  let cumDeposits = 0;
                  let cumWithdrawals = 0;
                  sortedTx.forEach((tx) => {
                    if (tx.type === 'buy' || tx.type === 'deposit') cumDeposits += tx.amount;
                    else if (tx.type === 'sell' || tx.type === 'withdraw') cumWithdrawals += tx.amount;
                    depositMap.set(tx.date, { deposits: cumDeposits, withdrawals: cumWithdrawals });
                  });
                  let lastDep = 0;
                  let lastWith = 0;
                  const areaData = filteredChartData.map((p) => {
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

                : chartPage === 5 ? (() => {
                  // Returns by Asset — bar chart (page 5)
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
                })()

                : chartPage === 7 ? (() => {
                  // Bank Balance — step line chart
                  if (!hasCashTx || hiddenAssets.has(CASH_TICKER)) return (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <p className="font-bold text-sm">{hiddenAssets.has(CASH_TICKER) ? 'Bank account hidden from net worth' : 'No bank transactions yet'}</p>
                    </div>
                  );
                  const bankColor = selectedAssets[CASH_TICKER]?.color || '#6366f1';
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={filteredChartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => formatShort(v)} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [formatCurrency(v), 'Bank Balance']}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} />
                        <Area type="stepAfter" dataKey={CASH_TICKER} name="Bank Balance" stroke={bankColor} fill={bankColor} fillOpacity={0.12} strokeWidth={2.5} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()
                : (() => {
                  // Asset Price — line chart (page 6)
                  const ticker = chartTickers[priceAssetIdx % chartTickers.length];
                  if (!ticker || !livePriceCache?.[ticker]) return (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      <p className="font-bold text-sm">No price data available</p>
                    </div>
                  );
                  const asset = selectedAssets[ticker];
                  const allPriceData = livePriceCache[ticker];
                  // Scope the time window to this asset's transactions (earliest tx − 30 days)
                  const tickerTxs = transactions.filter((tx) => tx.ticker === ticker);
                  const earliestTx = tickerTxs.reduce((min, tx) => tx.date < min ? tx.date : min, tickerTxs[0]?.date || '');
                  const windowStart = new Date(earliestTx);
                  windowStart.setDate(windowStart.getDate() - 30);
                  const windowStartStr = windowStart.toISOString().split('T')[0];
                  const minDate = chartRangeCutoff && chartRangeCutoff > windowStartStr ? chartRangeCutoff : windowStartStr;
                  const priceData = allPriceData.filter((p) => p.date >= minDate);
                  const dateIdx = new Map(priceData.map((p, i) => [p.date, i]));
                  const tickerTxMarkers = tickerTxs
                    .map((tx) => {
                      let idx = dateIdx.get(tx.date);
                      if (idx == null) idx = priceData.findIndex((p) => p.date >= tx.date);
                      if (idx == null || idx < 0) return null;
                      return { ...tx, chartDate: priceData[idx].date, price: priceData[idx].price };
                    })
                    .filter(Boolean);
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={priceData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="5 5" vertical={false} stroke={dark ? '#334155' : '#f1f5f9'} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} minTickGap={60}
                          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false}
                          tickFormatter={(v) => `$${v.toLocaleString()}`}
                          domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [`$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Price']}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <Area type="monotone" dataKey="price" stroke={asset?.color || '#3b82f6'} strokeWidth={2} fill={asset?.color || '#3b82f6'} fillOpacity={0.1} dot={false} />
                        {showMarkers && tickerTxMarkers.map((m) => (
                          <ReferenceDot
                            key={`price-${m.id}`}
                            x={m.chartDate}
                            y={m.price}
                            r={5}
                            fill={m.type === 'buy' ? '#10b981' : '#ef4444'}
                            stroke="#fff"
                            strokeWidth={2}
                            isFront
                          />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
              </>}
            </div>}

            {/* Stats Cards */}
            {stats.length > 0 && (() => {
              const portfolio = stats.find((s) => s.isPortfolio);
              const assets = stats.filter((s) => !s.isPortfolio);
              return (
                <div ref={statsRef} className={`bg-white dark:bg-slate-800 p-4 sm:p-6 ${statsOpen ? 'md:p-8' : ''} rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700`}>
                  <button onClick={() => setStatsOpen(v => !v)} className="w-full flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <DollarSign className="w-4 h-4" /> Stats
                    </h3>
                    <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${statsOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {statsOpen && <div className="space-y-6 mt-4">
                  {portfolio && (
                    <div className="p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border bg-slate-900 text-white border-slate-800 shadow-2xl transition-all hover:translate-y-[-4px]">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-blue-600 w-fit mb-2">Combined</div>
                          <p className="text-2xl sm:text-3xl font-black tracking-tight">{formatCurrency(portfolio.finalValue)}</p>
                          <p className="text-xs font-bold text-slate-400 mt-1">Total Portfolio</p>
                        </div>
                        <div className="flex gap-4 sm:gap-6">
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
                        <div key={idx} className="p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border bg-white dark:bg-slate-800 border-slate-200 shadow-sm transition-all hover:translate-y-[-4px]">
                          <div className="flex justify-between items-start mb-4">
                            <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
                            {displayTicker(stat.ticker)}
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
                </div>}
                </div>
              );
            })()}

          </main>
        </div>

        {/* Summary Table — full width */}
        {stats.length > 0 && (
          <div ref={tableRef} className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-4 sm:p-6">
              <button onClick={() => setSummaryOpen(v => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <History className="w-4 h-4" /> Summary
                </h3>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${summaryOpen ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {summaryOpen && <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead className="text-slate-400 text-[10px] font-black uppercase tracking-widest bg-slate-50/50 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-4 sm:px-8 py-3 sm:py-4">Asset</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Deposits</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Withdrawals</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Balance</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Return</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Ann. Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stats.filter((s) => !s.isPortfolio).map((stat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-4 sm:px-8 py-4 sm:py-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: stat.color }} />
                          <span className="font-black text-sm">{stat.name} ({displayTicker(stat.ticker)})</span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm">{formatCurrency(stat.totalDeposits)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm">{formatCurrency(stat.totalWithdrawals)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-black text-sm text-blue-600 dark:text-blue-400">{formatCurrency(stat.finalValue)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right">
                        <span className={`font-black text-sm ${(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits)}
                          {stat.totalDeposits > 0 ? (
                            <span className="text-xs font-normal text-slate-400 ml-1">({(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatPercent((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits)})</span>
                          ) : (
                            <span className="text-xs font-normal text-slate-400 ml-1">(—)</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm text-slate-500 dark:text-slate-400">{formatPercent(stat.annualizedReturn)}</td>
                    </tr>
                  ))}
                  {stats.find((s) => s.isPortfolio) && (() => {
                    const p = stats.find((s) => s.isPortfolio);
                    return (
                      <tr className="bg-slate-900 text-white border-t border-slate-800">
                        <td className="px-4 sm:px-8 py-6 sm:py-10 font-black rounded-bl-2xl sm:rounded-bl-[2.5rem]">Portfolio Total</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold">{formatCurrency(p.totalDeposits)}</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold">{formatCurrency(p.totalWithdrawals)}</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-black text-blue-400 text-lg">{formatCurrency(p.finalValue)}</td>
                        <td className={`px-4 sm:px-8 py-6 sm:py-10 text-right font-black text-lg ${(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(p.finalValue + p.totalWithdrawals - p.totalDeposits)}
                          <span className="text-xs font-normal text-slate-400 ml-1">({(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatPercent((p.finalValue + p.totalWithdrawals - p.totalDeposits) / p.totalDeposits)})</span>
                        </td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold rounded-br-2xl sm:rounded-br-[2.5rem]">{formatPercent(p.annualizedReturn)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>}
          </div>
        )}
      </div>

      {/* ── New Transaction Modal ─────────────────────────────────────────── */}
      {addTxOpen && !modalMode && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={() => setAddTxOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-sm mx-4 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 flex items-center gap-2">
                New Transaction
              </h3>
              <button onClick={() => setAddTxOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Quick Add */}
            <div className="space-y-1.5">
<p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Describe your transaction</p>
            <div className="relative">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <input
                type="text"
                value={quickAddText}
                onChange={(e) => setQuickAddText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && quickAddText.trim() && handleQuickAdd()}
                placeholder='e.g. bought google 1/1/2025 $1000'
                disabled={quickAddStatus === 'processing'}
                className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-10 pr-12 text-sm font-medium focus:ring-2 focus:ring-violet-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 disabled:opacity-60"
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
              <div className={`flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold ${
                quickAddPreview.type === 'buy' ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 text-emerald-700'
                : quickAddPreview.type === 'deposit' ? 'bg-indigo-50 dark:bg-indigo-950 border-indigo-200 text-indigo-700'
                : quickAddPreview.type === 'withdraw' ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 text-amber-700'
                : 'bg-rose-50 dark:bg-rose-950 border-rose-200 text-rose-700'
              }`}>
                <span className="uppercase text-[10px] font-black">{quickAddPreview.type}</span>
                <span className="flex-1 truncate min-w-[60px]">{quickAddPreview.ticker === CASH_TICKER ? 'Bank Account' : `${quickAddPreview.name} (${quickAddPreview.ticker})`}</span>
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
            <div className="border-t border-slate-100 dark:border-slate-700" />
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Stocks</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setAddTxOpen(false); openBuyModal(); }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-all active:scale-95"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center shadow">
                      <ShoppingCart className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Buy</span>
                  </button>
                  <button
                    onClick={() => { setAddTxOpen(false); openSellModal(); }}
                    disabled={ownedTickers.length === 0}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900 hover:bg-rose-100 dark:hover:bg-rose-900 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center shadow">
                      <HandCoins className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold text-rose-700 dark:text-rose-400">Sell</span>
                  </button>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Bank</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setAddTxOpen(false); openDepositModal(); }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all active:scale-95"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow">
                      <Landmark className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-400">Deposit</span>
                  </button>
                  <button
                    onClick={() => { setAddTxOpen(false); openWithdrawModal(); }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950 border border-amber-100 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-900 transition-all active:scale-95"
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center shadow">
                      <Landmark className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400">Withdraw</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                      <h4 className="text-base font-black truncate">{stagedAsset.name}</h4>
                      <p className="text-[10px] font-bold text-emerald-600 uppercase">{stagedAsset.symbol}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                      <input type="number" value={modalAmount} onChange={(e) => {
                        const value = e.target.value;
                        const numValue = Number(value);
                        if (value !== '' && !isNaN(numValue) && isFinite(numValue) && numValue >= 0) {
                          setModalAmount(numValue);
                        } else if (value === '') {
                          setModalAmount(0);
                        }
                      }}
                        className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Purchase Date</label>
                    <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  <IntradayPricePicker ticker={stagedAsset.symbol} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="emerald" />
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
                <HandCoins className="w-4 h-4" /> Record Sale
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
                      <h4 className="text-base font-black truncate">{selectedAssets[sellTicker]?.name}</h4>
                      <p className="text-[10px] font-bold text-rose-500 uppercase">{sellTicker} · Available: {formatCurrency(Math.max(0, availableBalance))}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Sale Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                      <input type="number" value={modalAmount} onChange={(e) => {
                        const value = e.target.value;
                        const numValue = Number(value);
                        if (value !== '' && !isNaN(numValue) && isFinite(numValue) && numValue >= 0) {
                          setModalAmount(numValue);
                        } else if (value === '') {
                          setModalAmount(0);
                        }
                      }}
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
                  <IntradayPricePicker ticker={sellTicker} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="rose" />
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

      {/* ── Bank Deposit / Withdraw Modal ─────────────────────────────── */}
      {(modalMode === 'deposit' || modalMode === 'withdraw') && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${modalMode === 'deposit' ? 'text-indigo-600' : 'text-amber-600'}`}>
                <Landmark className="w-4 h-4" /> {modalMode === 'deposit' ? 'Bank Deposit' : 'Bank Withdrawal'}
              </h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                  <input type="number" value={modalAmount} onChange={(e) => {
                    const value = e.target.value;
                    const numValue = Number(value);
                    if (value !== '' && !isNaN(numValue) && isFinite(numValue) && numValue >= 0) {
                      setModalAmount(numValue);
                    } else if (value === '') {
                      setModalAmount(0);
                    }
                  }}
                    autoFocus
                    className={`w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 outline-none ${modalMode === 'deposit' ? 'focus:ring-indigo-500' : 'focus:ring-amber-500'}`} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                  className={`w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 outline-none ${modalMode === 'deposit' ? 'focus:ring-indigo-500' : 'focus:ring-amber-500'}`} />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button onClick={() => { addCashTx(modalMode); closeModal(); }} disabled={modalAmount <= 0}
                className={`flex-1 py-3 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-95 disabled:opacity-40 ${modalMode === 'deposit' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                Record
              </button>
            </div>
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
                  {displayTicker(editingTx.ticker).slice(0, 3)}
                </div>
                <div className="min-w-0">
                  <h4 className="text-base font-black truncate">{selectedAssets[editingTx.ticker]?.name}</h4>
                  <p className={`text-[10px] font-bold uppercase ${editingTx.type === 'buy' ? 'text-emerald-600' : 'text-rose-600'}`}>{editingTx.type} · {displayTicker(editingTx.ticker)}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><DollarSign className="w-3.5 h-3.5" /></span>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    value={modalAmount === '' ? '' : modalAmount} 
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow empty
                      if (value === '') {
                        setModalAmount('');
                        return;
                      }
                      // Allow partial number entry (e.g., "10.", "100")
                      if (/^\d*\.?\d*$/.test(value)) {
                        // If it's a valid number or partial number, store as is
                        const numValue = parseFloat(value);
                        if (!isNaN(numValue)) {
                          setModalAmount(numValue);
                        } else {
                          // Allow typing partial numbers like "10."
                          setModalAmount(value);
                        }
                      }
                    }}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <IntradayPricePicker ticker={editingTx.ticker} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="blue" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button onClick={() => saveEdit()} disabled={!modalAmount || modalAmount <= 0}
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
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${
                      row.type === 'buy' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700'
                      : row.type === 'deposit' ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
                      : row.type === 'withdraw' ? 'bg-amber-50 dark:bg-amber-950 text-amber-700'
                      : 'bg-rose-50 dark:bg-rose-950 text-rose-700'
                    }`}>
                      <span className="uppercase text-[10px] font-black w-8">{row.type}</span>
                      <span className="flex-1 truncate">{row.name} ({displayTicker(row.ticker)})</span>
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

      {/* ── Share Modal ────────────────────────────────────────────────────────── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm" onClick={() => { setShareOpen(false); setShareStatus(null); setShareResult(null); }}>
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest text-blue-600 flex items-center gap-2">
                <Camera className="w-4 h-4" /> Share Your Portfolio
              </h3>
              <button onClick={() => { setShareOpen(false); setShareStatus(null); setShareResult(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            {shareResult ? (
              <div className="space-y-3">
                {shareResult.url && (
                  <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-700 px-3 py-2.5 border border-slate-200 dark:border-slate-600">
                    <Link className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <input
                      readOnly
                      value={shareResult.url}
                      className="flex-1 bg-transparent text-xs font-mono text-slate-600 dark:text-slate-300 outline-none select-all truncate"
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  {shareResult.url && (
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(shareResult.url);
                        setShareStatus('done');
                        setTimeout(() => setShareStatus(null), 2000);
                      }}
                      className="flex-1 py-2.5 rounded-2xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      {shareStatus === 'done' ? <><Check className="w-4 h-4" /> Copied!</> : <><Link className="w-4 h-4" /> Copy Link</>}
                    </button>
                  )}
                  {navigator.share && (
                    <button
                      onClick={async () => {
                        const file = new File([shareResult.blob], 'portfolio.png', { type: 'image/png' });
                        try {
                          if (navigator.canShare?.({ files: [file] })) {
                            await navigator.share({ files: [file], title: 'My Portfolio' });
                          } else if (shareResult.url) {
                            await navigator.share({ url: shareResult.url, title: 'My Portfolio' });
                          }
                        } catch { /* user cancelled */ }
                      }}
                      className={`${shareResult.url ? '' : 'flex-1 '}py-2.5 px-4 rounded-2xl font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-700 shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2`}
                    >
                      <Share2 className="w-4 h-4" /> Share
                    </button>
                  )}
                  {shareResult.url && (
                    <a
                      href={shareResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2.5 px-3 rounded-2xl font-bold text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all active:scale-95 flex items-center"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'Current Chart', ref: chartRef, icon: BarChart3, desc: 'Performance & chart view' },
                  { label: 'Stats Cards', ref: statsRef, icon: DollarSign, desc: 'Portfolio value & returns' },
                  { label: 'Summary Table', ref: tableRef, icon: FileText, desc: 'Asset breakdown table' },
                ].map(({ label, ref, icon: Icon, desc }) => (
                  <button
                    key={label}
                    disabled={shareStatus === 'capturing' || !ref.current}
                    onClick={async () => {
                      setShareStatus('capturing');
                      try {
                        // Hide controls during capture
                        const hideEls = ref.current.querySelectorAll('[data-share-hide]');
                        hideEls.forEach((el) => { el.style.display = 'none'; });
                        const dataUrl = await toPng(ref.current, {
                          backgroundColor: dark ? '#0f172a' : '#ffffff',
                          pixelRatio: 2,
                        });
                        hideEls.forEach((el) => { el.style.display = ''; });
                        const res = await fetch(dataUrl);
                        const rawBlob = await res.blob();
                        const blob = await composeShareImage(rawBlob, dark);
                        let publicUrl = null;
                        // Upload to Supabase Storage for shareable link
                        if (supabase) {
                          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
                          const { error } = await supabase.storage.from('screenshots').upload(fileName, blob, {
                            contentType: 'image/png',
                            cacheControl: '31536000',
                          });
                          if (!error) {
                            publicUrl = `${window.location.origin}/s/${fileName}`;
                          }
                        }
                        setShareResult({ url: publicUrl, blob });
                        setShareStatus(null);
                      } catch (err) {
                        console.error('Share capture error:', err);
                        setShareStatus('error');
                        setTimeout(() => setShareStatus(null), 2000);
                      }
                    }}
                    className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-all text-left disabled:opacity-50 border border-slate-200 dark:border-slate-600"
                  >
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold block">{label}</span>
                      <span className="text-[11px] text-slate-400 font-medium">{desc}</span>
                    </div>
                    {shareStatus === 'capturing' && <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
            {shareStatus === 'error' && (
              <div className="flex items-center gap-2 text-rose-500 text-xs font-bold">
                <AlertCircle className="w-4 h-4" /> Failed to capture. Try again.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Undo Toast ────────────────────────────────────────────────────────────── */}
      {deletedTx && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-slate-900 dark:bg-slate-800 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 border border-slate-700">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="text-sm font-bold">Transaction deleted</span>
            <button
              onClick={undoDelete}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all active:scale-95"
            >
              Undo
            </button>
          </div>
        </div>
      )}


      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }`}</style>
      <Analytics />
    </div>
  );
};

export default App;
