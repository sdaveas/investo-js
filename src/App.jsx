import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
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
  LogIn, LogOut, Cloud, Github, Heart, Moon, Sun, FileText, Menu, Coffee, RefreshCw,
  ChevronLeft, ChevronRight, Share2, Camera, Check, Link, ExternalLink, Maximize2, Minimize2,
  Landmark, Eye, EyeOff, FolderOpen, ChevronDown, Key, Copy, Clock,
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { searchTickers, fetchPrices, fetchQuote, fetchIntradayPrices, fetchExchangeRates } from './api';
import { simulate, computeStats } from './simulation';
import { supabase } from './supabase';
import { ensureProfile, loadPortfolioData, upsertAsset, deleteAsset, insertTransaction, updateTransaction, moveTransaction, deleteTransaction, bulkInsertTransactions, updateProfile, createPortfolio, renamePortfolio, deletePortfolio as deletePortfolioDb, createApiKey, listApiKeys, deleteApiKey } from './db';
import { Analytics } from '@vercel/analytics/react';

const COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
];

const currencyFormatters = {
  USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }),
  EUR: new Intl.NumberFormat('en-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }),
};
const getCurrencySymbol = (c) => c === 'EUR' ? '€' : '$';
let _displayCurrency = 'EUR';
const formatCurrency = (val) => (currencyFormatters[_displayCurrency] || currencyFormatters.USD).format(val);

const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;

const formatShort = (val) => {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  const sym = getCurrencySymbol(_displayCurrency);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${sym}${abs.toFixed(0)}`;
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
  const [priceCurrency, setPriceCurrency] = useState(null); // native currency of the asset's price
  const chartRef = useRef(null);

  const ringClass = `focus:ring-${accentColor}-500`;
  const priceSymbol = getCurrencySymbol(priceCurrency || _displayCurrency);

  // Fetch intraday data when expanded and ticker+date are available
  useEffect(() => {
    if (!expanded || !ticker || !date) return;
    setLoading(true);
    fetchIntradayPrices(ticker, date).then((result) => {
      if (result) {
        setIntradayData(result.prices || []);
        if (result.currency) setPriceCurrency(result.currency);
      } else {
        setIntradayData([]);
      }
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
            <span className="text-slate-400">{priceSymbol}</span>{Number(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                  {intradayData[hoveredIdx].hour} — {priceSymbol}{intradayData[hoveredIdx].price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{priceSymbol}</span>
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
const lsKeyFor = (pid) => pid ? `investo-portfolio-${pid}` : LS_KEY;
let savedPortfolio = null;
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) savedPortfolio = JSON.parse(raw);
} catch { /* ignore */ }

const genId = () => crypto.randomUUID();

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

  // --- Currency ---
  const [displayCurrency, setDisplayCurrency] = useState(() => {
    try { return savedPortfolio?.displayCurrency || localStorage.getItem('investo-currency') || 'EUR'; } catch { return 'EUR'; }
  });
  const [assetCurrencies, setAssetCurrencies] = useState({});  // { ticker: 'USD' | 'EUR' | ... }
  const [exchangeRates, setExchangeRates] = useState([]);      // [{ date, rate }] — EURUSD rate per day
  const exchangeRateMap = useMemo(() => {
    const m = new Map();
    exchangeRates.forEach((e) => m.set(e.date, e.rate));
    return m;
  }, [exchangeRates]);
  // Keep the module-level formatter in sync
  _displayCurrency = displayCurrency;

  // --- Modal ---
  const [modalMode, setModalMode] = useState(null);           // 'buy' | 'sell' | 'deposit' | 'withdraw' | 'edit' | 'import' | 'insights' | null
  const [stagedAsset, setStagedAsset] = useState(null);       // { symbol, name } — buy step 2
  const [sellTicker, setSellTicker] = useState(null);         // ticker — sell step 2
  const [modalAmount, setModalAmount] = useState(DEFAULT_AMOUNT);
  const [modalDate, setModalDate] = useState(fiveYearsAgo.toISOString().split('T')[0]);
  const [modalPrice, setModalPrice] = useState(null);          // null = closing price, number = custom
  const [modalInputMode, setModalInputMode] = useState('amount'); // 'amount' | 'shares'
  const [modalShares, setModalShares] = useState('');
  const [editingTx, setEditingTx] = useState(null);           // tx being edited
  const [modalPortfolioId, setModalPortfolioId] = useState(null); // per-modal portfolio override
  const [importText, setImportText] = useState('');
  const [aiImportRows, setAiImportRows] = useState(null);  // parsed rows from AI file import
  const [importAiStatus, setImportAiStatus] = useState(null); // 'loading' | 'error:msg' | null
  const [importConsolidate, setImportConsolidate] = useState(false); // merge all rows into one net transaction
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddStatus, setQuickAddStatus] = useState(null); // 'processing' | 'error:msg' | null
  const [quickAddPreview, setQuickAddPreview] = useState(null); // { ticker, name, type, amount, date }
  const [quickAddVerify, setQuickAddVerify] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);         // AI generated insights
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  // --- Auth & Sync ---
  const [user, setUser] = useState(null);
  const [portfolioId, setPortfolioId] = useState(null);
  const [portfolios, setPortfolios] = useState([]);
  const [checkedPortfolioIds, setCheckedPortfolioIds] = useState(new Set());
  const [portfolioSwitcherOpen, setPortfolioSwitcherOpen] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [renamingPortfolioId, setRenamingPortfolioId] = useState(null);
  const [renamingPortfolioName, setRenamingPortfolioName] = useState('');
  const isHydratingRef = useRef(false);

  const [colorPickerTicker, setColorPickerTicker] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(() => savedPortfolio?.viewStates?.overviewOpen ?? true);
  const [chartsOpen, setChartsOpen] = useState(() => savedPortfolio?.viewStates?.chartsOpen ?? true);
  const [summaryOpen, setSummaryOpen] = useState(() => savedPortfolio?.viewStates?.summaryOpen ?? true);
  const [statsOpen, setStatsOpen] = useState(() => savedPortfolio?.viewStates?.statsOpen ?? true);
  const [aboutOpen, setAboutOpen] = useState(() => savedPortfolio?.viewStates?.aboutOpen ?? false);
  const [addTxOpen, setAddTxOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState(null); // 'capturing' | 'done' | 'error' | null
  const [shareResult, setShareResult] = useState(null); // { url, blob }
  const [deletedTx, setDeletedTx] = useState(null); // For undo functionality
  const [undoTimer, setUndoTimer] = useState(null);

  // --- API Keys ---
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState(null); // shown once after generation
  const [keyCopied, setKeyCopied] = useState(false);

  const chartRef = useRef(null);
  const statsRef = useRef(null);
  const tableRef = useRef(null);
  const overviewRef = useRef(null);
  const historyRef = useRef(null);
  const [overviewHeight, setOverviewHeight] = useState(0);
  const [statsHeight, setStatsHeight] = useState(0);
  const statsOpenHeightRef = useRef(0);

  const colorIdx = useRef(savedPortfolio?.colorIdx || 0);
  const fetchedRangesRef = useRef({});  // { ticker: startDate } — tracks what we've already fetched
  const livePriceCacheRef = useRef(null);

  // Track overview panel height for chart sync
  useEffect(() => {
    const el = overviewRef.current;
    if (!el) { setOverviewHeight(0); return; }
    const obs = new ResizeObserver(() => setOverviewHeight(el.offsetHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, [overviewOpen]);

  // Track stats panel height for history sync
  useEffect(() => {
    const el = statsRef.current;
    if (!el) { setStatsHeight(0); return; }
    const obs = new ResizeObserver(() => {
      const h = el.offsetHeight;
      setStatsHeight(h);
      if (statsOpen && h > 100) statsOpenHeightRef.current = h;
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [statsOpen]);

  // Snap neighboring panels to same height when within threshold
  const SNAP_THRESHOLD = 150; // px
  useLayoutEffect(() => {
    if (!sidebarOpen || transactions.length === 0) return;
    const els = [overviewRef.current, chartRef.current, historyRef.current, statsRef.current];
    // Clear previous snap
    els.forEach(el => { if (el) el.style.minHeight = ''; });
    // Row 1: Overview ↔ Chart
    if (overviewOpen && chartsOpen && els[0] && els[1]) {
      const oh = els[0].offsetHeight;
      const ch = els[1].offsetHeight;
      const diff = Math.abs(oh - ch);
      if (diff > 0 && diff <= SNAP_THRESHOLD) {
        const target = Math.max(oh, ch) + 'px';
        els[0].style.minHeight = target;
        els[1].style.minHeight = target;
      }
    }
    // Row 2: History ↔ Stats
    if (historyOpen && statsOpen && els[2] && els[3]) {
      const hh = els[2].offsetHeight;
      const sh = els[3].offsetHeight;
      const diff = Math.abs(hh - sh);
      if (diff > 0 && diff <= SNAP_THRESHOLD) {
        const target = Math.max(hh, sh) + 'px';
        els[2].style.minHeight = target;
        els[3].style.minHeight = target;
      }
    }
  });

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
    // NOTE: we intentionally use raw `chartData` here to avoid referencing
    // `convertedChartData` before it is initialized (conversion layer is defined later).
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
    setModalInputMode('amount');
    setModalShares('');
    setStagedAsset(null);
    setModalPortfolioId(portfolioId);
    setModalMode('buy');
  }, [transactions, portfolioId]);

  const openSellModal = useCallback((preselectedTicker = null) => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPrice(null);
    setModalInputMode('amount');
    setModalShares('');
    setSellTicker(preselectedTicker);
    setModalPortfolioId(portfolioId);
    setModalMode('sell');
  }, [portfolioId]);

  const openDepositModal = useCallback(() => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPortfolioId(portfolioId);
    setModalMode('deposit');
  }, [portfolioId]);

  const openWithdrawModal = useCallback(() => {
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPortfolioId(portfolioId);
    setModalMode('withdraw');
  }, [portfolioId]);

  const openBuyForTicker = useCallback((ticker) => {
    const asset = selectedAssets[ticker];
    if (!asset) return;
    setModalAmount(DEFAULT_AMOUNT);
    setModalDate(TODAY);
    setModalPrice(null);
    setModalInputMode('amount');
    setModalShares('');
    setStagedAsset({ symbol: ticker, name: asset.name });
    setModalPortfolioId(portfolioId);
    setModalMode('buy');
  }, [selectedAssets, transactions, portfolioId]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setSearchQuery('');
    setSearchResults([]);
    setStagedAsset(null);
    setSellTicker(null);
    setEditingTx(null);
    setModalPortfolioId(null);
    setImportText('');
    setAiImportRows(null);
    setImportAiStatus(null);
    setImportConsolidate(false);
  }, []);

  // Resolve shares from a monetary amount: convert to native currency, divide by native price
  // Uses livePriceCacheRef to avoid hook ordering issues (only called from event handlers)
  const resolveShares = useCallback((ticker, amount, date, priceOverride = null) => {
    const cache = livePriceCacheRef.current;
    // Get native price on the date
    const nativePrice = priceOverride || cache?.[ticker]?.findLast(p => p.date <= date)?.price;
    if (!nativePrice || nativePrice <= 0) return null;
    // Convert the entered amount (in displayCurrency) to the asset's native currency
    const native = assetCurrencies[ticker];
    let nativeAmount = amount;
    if (native && native !== displayCurrency) {
      let rate = null;
      for (const entry of exchangeRates) {
        if (entry.date <= date) rate = entry.rate;
        else break;
      }
      if (rate != null) {
        if (displayCurrency === 'EUR' && native === 'USD') nativeAmount = amount * rate;
        else if (displayCurrency === 'USD' && native === 'EUR') nativeAmount = amount / rate;
      }
    }
    return { shares: nativeAmount / nativePrice, priceAtEntry: nativePrice };
  }, [assetCurrencies, displayCurrency, exchangeRates]);

  const openEditModal = useCallback((tx) => {
    setEditingTx(tx);
    // For shares-based txs, compute display amount from shares * priceAtEntry * exchange rate
    let amount;
    if (tx.shares != null && tx.priceAtEntry != null && tx.ticker !== CASH_TICKER) {
      // Show the display-currency equivalent
      const native = assetCurrencies[tx.ticker];
      let rate = 1;
      if (native && native !== displayCurrency) {
        for (const entry of exchangeRates) {
          if (entry.date <= tx.date) rate = entry.rate;
          else break;
        }
        if (native === 'USD' && displayCurrency === 'EUR') rate = 1 / rate;
        // if native === 'EUR' && displayCurrency === 'USD', rate is already EURUSD
      }
      amount = Math.round(tx.shares * tx.priceAtEntry * rate * 100) / 100;
    } else {
      amount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount) || 0;
    }
    setModalAmount(amount);
    // Ensure date is always a string
    const date = typeof tx.date === 'string' ? tx.date : String(tx.date || TODAY);
    setModalDate(date);
    setModalPrice(tx.priceAtEntry || tx.price || null);
    setModalInputMode('amount');
    // Pre-compute shares
    let shares = '';
    if (tx.ticker !== CASH_TICKER) {
      if (tx.shares != null) {
        shares = String(Math.round(tx.shares * 10000) / 10000);
      } else {
        const price = tx.price || priceCache?.[tx.ticker]?.findLast(p => p.date <= tx.date)?.price;
        if (price && price > 0) shares = String(Math.round((amount / price) * 10000) / 10000);
      }
    }
    setModalShares(shares);
    setModalPortfolioId(portfolioId);
    setModalMode('edit');
  }, [priceCache, assetCurrencies, displayCurrency, exchangeRates, portfolioId]);

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
    const targetPid = modalPortfolioId || portfolioId;
    const movingPortfolio = supabase && targetPid && editingTx.portfolioId && targetPid !== editingTx.portfolioId;
    let updatedFields = null;
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== editingTx.id) return tx;
        // For non-cash txs, recompute shares
        if (tx.ticker !== CASH_TICKER) {
          const resolved = resolveShares(tx.ticker, amountToSave, dateToSave, priceToSave || null);
          if (resolved) {
            updatedFields = { shares: resolved.shares, priceAtEntry: resolved.priceAtEntry, date: dateToSave };
            return { id: tx.id, ticker: tx.ticker, type: tx.type, portfolioId: targetPid, ...updatedFields };
          }
        }
        // Cash tx or fallback
        updatedFields = { amount: amountToSave, date: dateToSave };
        const updated = { ...tx, ...updatedFields, portfolioId: targetPid };
        if (priceToSave) updated.price = priceToSave;
        else delete updated.price;
        return updated;
      }),
    );
    if (supabase && updatedFields) updateTransaction(supabase, editingTx.id, updatedFields);
    if (movingPortfolio) {
      moveTransaction(supabase, editingTx.id, targetPid);
      // Ensure the asset exists in the target portfolio
      const asset = selectedAssets[editingTx.ticker];
      if (asset) upsertAsset(supabase, targetPid, { ticker: editingTx.ticker, name: asset.name, color: asset.color });
      // Remove from local state if the target portfolio isn't currently visible
      if (!checkedPortfolioIds.has(targetPid)) {
        setTransactions((prev) => prev.filter((tx) => tx.id !== editingTx.id));
      }
    }
    closeModal();
  }, [editingTx, modalAmount, modalDate, modalPrice, closeModal, resolveShares, modalPortfolioId, portfolioId, selectedAssets, checkedPortfolioIds]);

  // ─── Transaction actions ───────────────────────────────────────────────────

  const addBuy = useCallback((symbol, name) => {
    const ticker = symbol.toUpperCase();
    const color = selectedAssets[ticker]?.color || COLORS[colorIdx.current % COLORS.length];
    if (!selectedAssets[ticker]) {
      colorIdx.current++;
      setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    }
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0) 
      ? modalAmount 
      : DEFAULT_AMOUNT;
    let tx;
    const sharesNum = Number(modalShares);
    if (modalInputMode === 'shares' && sharesNum > 0 && modalPrice > 0) {
      // Shares mode: use the exact share count the user entered
      tx = { id: genId(), ticker, type: 'buy', shares: sharesNum, priceAtEntry: modalPrice, date: modalDate };
    } else {
      const resolved = resolveShares(ticker, validAmount, modalDate, modalPrice || null);
      tx = resolved
        ? { id: genId(), ticker, type: 'buy', shares: resolved.shares, priceAtEntry: resolved.priceAtEntry, date: modalDate }
        : { id: genId(), ticker, type: 'buy', amount: validAmount, date: modalDate, currency: displayCurrency };
      if (modalPrice && !resolved) tx.price = modalPrice;
    }
    setTransactions((prev) => [...prev, tx]);
    const pid = modalPortfolioId || portfolioId;
    if (supabase && pid) {
      upsertAsset(supabase, pid, { ticker, name, color });
      insertTransaction(supabase, pid, tx);
    }
  }, [modalAmount, modalDate, modalPrice, modalShares, modalInputMode, selectedAssets, displayCurrency, resolveShares, portfolioId, modalPortfolioId]);

  const addSell = useCallback((ticker) => {
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0) 
      ? modalAmount 
      : DEFAULT_AMOUNT;
    let tx;
    const sharesNum = Number(modalShares);
    if (modalInputMode === 'shares' && sharesNum > 0 && modalPrice > 0) {
      tx = { id: genId(), ticker, type: 'sell', shares: sharesNum, priceAtEntry: modalPrice, date: modalDate };
    } else {
      const resolved = resolveShares(ticker, validAmount, modalDate, modalPrice || null);
      tx = resolved
        ? { id: genId(), ticker, type: 'sell', shares: resolved.shares, priceAtEntry: resolved.priceAtEntry, date: modalDate }
        : { id: genId(), ticker, type: 'sell', amount: validAmount, date: modalDate, currency: displayCurrency };
      if (modalPrice && !resolved) tx.price = modalPrice;
    }
    setTransactions((prev) => [...prev, tx]);
    const pid = modalPortfolioId || portfolioId;
    if (supabase && pid) insertTransaction(supabase, pid, tx);
  }, [modalAmount, modalDate, modalPrice, modalShares, modalInputMode, displayCurrency, resolveShares, portfolioId, modalPortfolioId]);

  const addCashTx = useCallback((type) => {
    const pid = modalPortfolioId || portfolioId;
    if (!selectedAssets[CASH_TICKER]) {
      setSelectedAssets((prev) => ({ ...prev, [CASH_TICKER]: { name: 'Bank Account', color: '#6366f1' } }));
      if (supabase && pid) upsertAsset(supabase, pid, { ticker: CASH_TICKER, name: 'Bank Account', color: '#6366f1' });
    }
    const validAmount = (typeof modalAmount === 'number' && !isNaN(modalAmount) && isFinite(modalAmount) && modalAmount > 0)
      ? modalAmount
      : DEFAULT_AMOUNT;
    const tx = { id: genId(), ticker: CASH_TICKER, type, amount: validAmount, date: modalDate, currency: displayCurrency };
    setTransactions((prev) => [...prev, tx]);
    if (supabase && pid) insertTransaction(supabase, pid, tx);
  }, [modalAmount, modalDate, selectedAssets, displayCurrency, portfolioId, modalPortfolioId]);

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
          const resolved = { ticker: CASH_TICKER, name: 'Bank Account', type: parsed.type, amount: parsed.amount || DEFAULT_AMOUNT, date: parsed.date || TODAY, currency: displayCurrency };
          if (quickAddVerify) {
            setQuickAddPreview(resolved);
            setQuickAddStatus(null);
          } else {
            const color = selectedAssets[CASH_TICKER]?.color || COLORS[colorIdx.current % COLORS.length];
            if (!selectedAssets[CASH_TICKER]) {
              colorIdx.current++;
              setSelectedAssets((prev) => ({ ...prev, [CASH_TICKER]: { name: 'Bank Account', color } }));
            }
            const tx = { id: genId(), ...resolved };
            setTransactions((prev) => [...prev, tx]);
            const pid = modalPortfolioId || portfolioId;
            if (supabase && pid) {
              upsertAsset(supabase, pid, { ticker: CASH_TICKER, name: 'Bank Account', color });
              insertTransaction(supabase, pid, tx);
            }
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
        const txDate = parsed.date || TODAY;
        const sharesResolved = resolveShares(ticker, txAmount, txDate);
        const resolved = sharesResolved
          ? { ticker, name: matchName, type: parsed.type, shares: sharesResolved.shares, priceAtEntry: sharesResolved.priceAtEntry, date: txDate }
          : { ticker, name: matchName, type: parsed.type, amount: txAmount, date: txDate, currency: displayCurrency };
        if (quickAddVerify) {
          setQuickAddPreview(resolved);
          setQuickAddStatus(null);
        } else {
          const color = selectedAssets[ticker]?.color || COLORS[colorIdx.current % COLORS.length];
          if (!selectedAssets[ticker]) {
            colorIdx.current++;
            setSelectedAssets((prev) => ({ ...prev, [ticker]: { name: matchName, color } }));
          }
          const tx = { id: genId(), ...resolved };
          setTransactions((prev) => [...prev, tx]);
          const pid = modalPortfolioId || portfolioId;
          if (supabase && pid) {
            upsertAsset(supabase, pid, { ticker, name: matchName, color });
            insertTransaction(supabase, pid, tx);
          }
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

      const txDate = parsed.date || TODAY;
      const sharesResolved = resolveShares(ticker, txAmount, txDate);
      const resolved = sharesResolved
        ? { ticker, name: matchName, type: parsed.type, shares: sharesResolved.shares, priceAtEntry: sharesResolved.priceAtEntry, date: txDate }
        : { ticker, name: matchName, type: parsed.type, amount: txAmount, date: txDate, currency: displayCurrency };

      if (quickAddVerify) {
        setQuickAddPreview(resolved);
        setQuickAddStatus(null);
      } else {
        const color = selectedAssets[ticker]?.color || COLORS[colorIdx.current % COLORS.length];
        if (!selectedAssets[ticker]) {
          colorIdx.current++;
          setSelectedAssets((prev) => ({ ...prev, [ticker]: { name: matchName, color } }));
        }
        const tx = { id: genId(), ...resolved };
        setTransactions((prev) => [...prev, tx]);
        const pid = modalPortfolioId || portfolioId;
        if (supabase && pid) {
          upsertAsset(supabase, pid, { ticker, name: matchName, color });
          insertTransaction(supabase, pid, tx);
        }
        setQuickAddText('');
        setQuickAddStatus(null);
      }
    } catch (error) {
      console.error('AI parsing error:', error);
      setQuickAddStatus(`error:${error.message || 'Could not understand. Please try again.'}`);
      setTimeout(() => setQuickAddStatus(null), 3000);
    }
  }, [quickAddText, selectedAssets, chartData, quickAddVerify, supabase, portfolioId, modalPortfolioId, displayCurrency, resolveShares]);

  const confirmQuickAdd = useCallback(() => {
    if (!quickAddPreview) return;
    const { ticker, name, ...rest } = quickAddPreview;
    const color = selectedAssets[ticker]?.color || COLORS[colorIdx.current % COLORS.length];
    if (!selectedAssets[ticker]) {
      colorIdx.current++;
      setSelectedAssets((prev) => ({ ...prev, [ticker]: { name, color } }));
    }
    const tx = { id: genId(), ticker, ...rest };
    setTransactions((prev) => [...prev, tx]);
    const pid = modalPortfolioId || portfolioId;
    if (supabase && pid) {
      upsertAsset(supabase, pid, { ticker, name, color });
      insertTransaction(supabase, pid, tx);
    }
    setQuickAddText('');
    setQuickAddPreview(null);
  }, [quickAddPreview, selectedAssets, portfolioId, modalPortfolioId]);

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
    const amountIdx = header.findIndex((h) => ['amount', 'quantity'].includes(h));
    const priceIdx = header.findIndex((h) => h === 'price');
    const currencyIdx = header.findIndex((h) => h === 'currency');
    const sharesIdx = header.findIndex((h) => h === 'shares');
    const hasHeader = dateIdx >= 0 && tickerIdx >= 0;
    const rows = [];
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim());
      const date = cols[hasHeader ? dateIdx : 0];
      const ticker = (cols[hasHeader ? tickerIdx : 1] || '').toUpperCase();
      const name = hasHeader && nameIdx >= 0 ? cols[nameIdx] : '';
      const action = (cols[hasHeader ? actionIdx : 2] || '').toLowerCase();
      // Support both "Quantity" (unified) and legacy "Amount"/"Shares" columns
      const qty = parseFloat(cols[hasHeader ? amountIdx : 3]);
      const shares = hasHeader && sharesIdx >= 0 ? parseFloat(cols[sharesIdx]) : NaN;
      const price = hasHeader && priceIdx >= 0 ? parseFloat(cols[priceIdx]) : NaN;
      const isCashAction = action === 'deposit' || action === 'withdraw';
      const amount = !isNaN(shares) && shares > 0 ? shares : qty;
      if (date && (isCashAction || (ticker && (action === 'buy' || action === 'sell'))) && amount > 0) {
        const currency = hasHeader && currencyIdx >= 0 ? cols[currencyIdx] : '';
        const row = {
          date,
          ticker: isCashAction ? CASH_TICKER : ticker,
          name: isCashAction ? 'Bank Account' : (name || ticker),
          type: action,
          amount,
          isShares: !isCashAction, // stock rows are share counts, cash rows are currency amounts
        };
        if (currency) row.currency = currency;
        if (!isNaN(price) && price > 0) row.price = price;
        rows.push(row);
      }
    }
    return rows;
  }, []);

  const importParsed = useMemo(() => parseImportData(importText), [importText, parseImportData]);

  const confirmImport = useCallback(() => {
    const rows = aiImportRows ?? importParsed;
    if (rows.length === 0) return;

    // Consolidate mode: collapse all rows into a single net _CASH transaction
    if (importConsolidate && aiImportRows?.length > 0) {
      const net = rows.reduce((s, r) => s + (r.type === 'deposit' ? r.amount : -r.amount), 0);
      const latestDate = rows.reduce((d, r) => (r.date > d ? r.date : d), rows[0].date);
      const currency = rows[0].currency || displayCurrency;
      const type = net >= 0 ? 'deposit' : 'withdraw';
      const amount = Math.abs(net);
      if (!selectedAssets[CASH_TICKER]) {
        setSelectedAssets((prev) => ({ ...prev, [CASH_TICKER]: { name: 'Bank Account', color: '#6366f1' } }));
      }
      const tx = { id: genId(), ticker: CASH_TICKER, type, amount, date: latestDate, currency };
      setTransactions((prev) => [...prev, tx]);
      const pid = modalPortfolioId || portfolioId;
      if (supabase && pid) {
        upsertAsset(supabase, pid, { ticker: CASH_TICKER, name: 'Bank Account', color: '#6366f1' });
        insertTransaction(supabase, pid, tx);
      }
      setImportText('');
      setAiImportRows(null);
      setImportAiStatus(null);
      setImportConsolidate(false);
      setModalMode(null);
      return;
    }

    const newAssets = { ...selectedAssets };
    const newTxs = [];
    rows.forEach((row) => {
      if (!newAssets[row.ticker]) {
        const color = row.ticker === CASH_TICKER ? '#6366f1' : COLORS[colorIdx.current % COLORS.length];
        newAssets[row.ticker] = { name: row.name, color };
        if (row.ticker !== CASH_TICKER) colorIdx.current++;
      }
      if (row.ticker !== CASH_TICKER) {
        if (row.isShares) {
          // Import has share count directly — look up entry price from cache
          const cache = livePriceCacheRef.current;
          const entryPrice = row.price || cache?.[row.ticker]?.findLast(p => p.date <= row.date)?.price;
          newTxs.push({ id: genId(), ticker: row.ticker, type: row.type, shares: row.amount, priceAtEntry: entryPrice || 0, date: row.date });
        } else {
          // Legacy import with monetary amount — resolve to shares
          const resolved = resolveShares(row.ticker, row.amount, row.date, row.price || null);
          if (resolved) {
            newTxs.push({ id: genId(), ticker: row.ticker, type: row.type, shares: resolved.shares, priceAtEntry: resolved.priceAtEntry, date: row.date });
          } else {
            const importedTx = { id: genId(), ticker: row.ticker, type: row.type, amount: row.amount, date: row.date, currency: displayCurrency };
            if (row.price) importedTx.price = row.price;
            newTxs.push(importedTx);
          }
        }
      } else {
        newTxs.push({ id: genId(), ticker: row.ticker, type: row.type, amount: row.amount, date: row.date, currency: row.currency || displayCurrency });
      }
    });
    setSelectedAssets(newAssets);
    setTransactions((prev) => [...prev, ...newTxs]);
    const pid = modalPortfolioId || portfolioId;
    if (supabase && pid) {
      Object.entries(newAssets).forEach(([ticker, { name, color }]) => {
        upsertAsset(supabase, pid, { ticker, name, color });
      });
      bulkInsertTransactions(supabase, pid, newTxs);
    }
    setImportText('');
    setAiImportRows(null);
    setImportAiStatus(null);
    setImportConsolidate(false);
    setModalMode(null);
  }, [aiImportRows, importParsed, importConsolidate, selectedAssets, displayCurrency, resolveShares, portfolioId, modalPortfolioId]);

  const exportCSV = useCallback(() => {
    const headers = 'Date,Asset,Name,Action,Quantity,Currency';
    const rows = transactions.map((tx) => {
      const isCash = tx.ticker === CASH_TICKER;
      const name = isCash ? 'Bank Account' : (selectedAssets[tx.ticker]?.name || tx.ticker).replace(/,/g, ' ');
      const ticker = isCash ? 'CASH' : tx.ticker;
      // Quantity: shares for stocks, amount for cash
      const quantity = tx.shares != null ? tx.shares : (tx.amount != null ? tx.amount : '');
      // Currency: tx.currency for cash, native asset currency for stocks
      const currency = isCash ? (tx.currency || '') : (assetCurrencies[tx.ticker] || '');
      return `${tx.date},${ticker},${name},${tx.type},${quantity},${currency}`;
    });
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'what-i-have-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [transactions, selectedAssets, assetCurrencies]);

  const handleAiFileImport = useCallback(async (file) => {
    setAiImportRows(null);
    setImportAiStatus('loading');
    try {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';

      let payload;
      if (isImage) {
        // Read image as base64
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        payload = { type: 'image', content: base64, mimeType: file.type, currentDate: TODAY };
      } else if (isPdf) {
        // Send raw PDF to edge function — server handles text extraction (no browser worker needed)
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        payload = { type: 'pdf', content: base64, currentDate: TODAY };
      } else {
        // Fallback: read as text
        const text = await file.text();
        payload = { type: 'text', content: text, currentDate: TODAY };
      }

      const { data, error } = await supabase.functions.invoke('parse-statement', { body: payload });
      if (error) throw new Error(error.message);
      if (!data?.transactions?.length) throw new Error('No transactions found in this file');

      setAiImportRows(data.transactions);
      setImportAiStatus(null);
    } catch (err) {
      console.error('AI file import error:', err);
      setImportAiStatus(`error:${err.message || 'Could not parse file'}`);
    }
  }, []);

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isAiFile = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (isAiFile) {
      if (!user) {
        setImportAiStatus('error:Sign in to use AI file import for PDFs and images');
        return;
      }
      handleAiFileImport(file);
      return;
    }
    // Plain text / CSV path
    setAiImportRows(null);
    setImportAiStatus(null);
    const reader = new FileReader();
    reader.onload = (ev) => setImportText(ev.target.result);
    reader.readAsText(file);
  }, [user, handleAiFileImport]);

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
      // Compute amounts: for shares-based txs, use shares * priceAtEntry; for others, use amount
      const getTxAmt = (tx) => (tx.shares != null && tx.priceAtEntry != null) ? tx.shares * tx.priceAtEntry : (tx.amount || 0);
      const stockBuys = visTxs.reduce((s, tx) => s + (tx.type === 'buy' ? getTxAmt(tx) : 0), 0);
      const stockSells = visTxs.reduce((s, tx) => s + (tx.type === 'sell' ? getTxAmt(tx) : 0), 0);
      const stockValue = visibleStockTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
      const stockReturn = stockValue + stockSells - stockBuys;
      const bankDeposited = visTxs.reduce((s, tx) => s + (tx.type === 'deposit' ? getTxAmt(tx) : 0), 0);
      const bankWithdrawn = visTxs.reduce((s, tx) => s + (tx.type === 'withdraw' ? getTxAmt(tx) : 0), 0);
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
    // Flush any pending delete to DB before starting a new undo cycle
    setUndoTimer((prev) => {
      if (prev) clearTimeout(prev);
      return null;
    });
    setDeletedTx((prev) => {
      if (prev && supabase) deleteTransaction(supabase, prev.tx.id);
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
        setDeletedTx((cur) => {
          if (cur && supabase) deleteTransaction(supabase, cur.tx.id);
          return null;
        });
        setUndoTimer(null);
      }, 5000);
      setUndoTimer(timer);
      
      // Clean up selectedAssets, fetchedRanges, and DB asset if ticker has no more transactions
      if (tickerWillBeRemoved) {
        setSelectedAssets((sa) => {
          const out = { ...sa };
          delete out[txToDelete.ticker];
          delete fetchedRangesRef.current[txToDelete.ticker];
          return out;
        });
        if (supabase && portfolioId) {
          deleteAsset(supabase, portfolioId, txToDelete.ticker);
        }
      }
      
      return next;
    });
  }, [selectedAssets]);
  
  const undoDelete = useCallback(() => {
    const currentDeleted = deletedTx;
    if (!currentDeleted) return;
    
    // Clear the timer immediately
    setUndoTimer((timer) => {
      if (timer) clearTimeout(timer);
      return null;
    });
    
    // Clear undo state immediately (removes the toast)
    setDeletedTx(null);
    
    // Restore the transaction — no DB delete was fired yet (timer was cleared)
    setTransactions((txs) => [...txs, currentDeleted.tx]);
    
    // Restore asset if it was removed
    if (currentDeleted.asset) {
      setSelectedAssets((assets) => ({ ...assets, ...currentDeleted.asset }));
    }
  }, [deletedTx]);

  const toggleHideAsset = useCallback((ticker) => {
    setHiddenAssets((prev) => {
      const next = new Set(prev);
      const nowHidden = !next.has(ticker);
      if (nowHidden) next.add(ticker); else next.delete(ticker);
      if (supabase && portfolioId && selectedAssets[ticker]) {
        upsertAsset(supabase, portfolioId, { ticker, name: selectedAssets[ticker].name, color: selectedAssets[ticker].color, hidden: nowHidden });
      }
      return next;
    });
  }, [portfolioId, selectedAssets]);

  // ─── Persistence ───────────────────────────────────────────────────────────────

  // Save to localStorage on every change
  useEffect(() => {
    if (isHydratingRef.current) return;
    if (checkedPortfolioIds.size > 1) return; // skip save in multi-portfolio aggregation mode
    const key = lsKeyFor(portfolioId);
    try {
      // Create clean copies to avoid any circular references
      const cleanTransactions = transactions.map((tx) => {
        // Only include primitive values, ensure types are correct
        const clean = {
          id: tx.id,
          ticker: String(tx.ticker || ''),
          type: String(tx.type || 'buy'),
          date: String(tx.date || TODAY)
        };
        // Shares-based model (stocks)
        if (tx.shares != null) clean.shares = Number(tx.shares);
        if (tx.priceAtEntry != null) clean.priceAtEntry = Number(tx.priceAtEntry);
        // Legacy / cash model
        if (tx.amount != null) clean.amount = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount) || 0;
        if (tx.currency) clean.currency = tx.currency;
        if (tx.price != null && typeof tx.price === 'number') clean.price = tx.price;
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
      
      const viewStates = { overviewOpen, chartsOpen, summaryOpen, statsOpen, aboutOpen };
      const dataToSave = {
        transactions: cleanTransactions,
        selectedAssets: cleanSelectedAssets,
        colorIdx: typeof colorIdx.current === 'number' ? colorIdx.current : 0,
        hiddenAssets: [...hiddenAssets],
        displayCurrency,
        viewStates,
      };
      
      localStorage.setItem(key, JSON.stringify(dataToSave));
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      // Try to save with minimal data as fallback
      try {
        const minimalData = {
          transactions: transactions.map((tx) => ({
            id: tx.id,
            ticker: String(tx.ticker),
            type: String(tx.type),
            date: String(tx.date),
            ...(tx.shares != null && { shares: Number(tx.shares) }),
            ...(tx.priceAtEntry != null && { priceAtEntry: Number(tx.priceAtEntry) }),
            ...(tx.amount != null && { amount: Number(tx.amount) }),
            ...(tx.currency && { currency: tx.currency }),
            ...(tx.price != null && { price: Number(tx.price) })
          })),
          selectedAssets: {},
          colorIdx: 0,
          hiddenAssets: [...hiddenAssets],
        };
        localStorage.setItem(key, JSON.stringify(minimalData));
      } catch (fallbackError) {
        console.error('Fallback save also failed:', fallbackError);
      }
    }
  }, [transactions, selectedAssets, hiddenAssets, displayCurrency, overviewOpen, chartsOpen, summaryOpen, statsOpen, aboutOpen, portfolioId, checkedPortfolioIds]);

  // Debounced view_states sync to profile
  useEffect(() => {
    if (!supabase || !user || isHydratingRef.current) return;
    const t = setTimeout(() => {
      updateProfile(supabase, user.id, { view_states: { overviewOpen, chartsOpen, summaryOpen, statsOpen, aboutOpen, activePortfolioId: portfolioId, checkedPortfolioIds: [...checkedPortfolioIds] } });
    }, 2000);
    return () => clearTimeout(t);
  }, [overviewOpen, chartsOpen, summaryOpen, statsOpen, aboutOpen, user, portfolioId, checkedPortfolioIds]);

  // Hydrate one or more portfolios' data into state (merged)
  const hydratePortfolios = useCallback(async (pids) => {
    isHydratingRef.current = true;
    // Clear current portfolio state
    setTransactions([]);
    setSelectedAssets({});
    setHiddenAssets(new Set());
    setPriceCache(null);
    setChartData([]);
    setStats([]);
    setAssetCurrencies({});
    setExchangeRates([]);
    setLiveQuotes({});
    colorIdx.current = 0;
    fetchedRangesRef.current = {};
    try {
      const results = await Promise.all(pids.map((pid) => loadPortfolioData(supabase, pid)));
      const allTxs = [];
      const sa = {};
      const hidden = [];
      results.forEach(({ assets, transactions: dbTxs }) => {
        allTxs.push(...dbTxs);
        assets.forEach((a) => {
          if (!sa[a.ticker]) sa[a.ticker] = { name: a.name, color: a.color };
          if (a.hidden && !hidden.includes(a.ticker)) hidden.push(a.ticker);
        });
      });
      if (allTxs.length > 0) {
        setTransactions(allTxs);
        setSelectedAssets(sa);
        setHiddenAssets(new Set(hidden));
        colorIdx.current = Object.keys(sa).filter((t) => t !== CASH_TICKER).length;
      }
    } finally {
      setTimeout(() => { isHydratingRef.current = false; }, 200);
    }
  }, []);

  // Hydrate user data from Supabase (called outside onAuthStateChange to avoid deadlock)
  const hydratingUserRef = useRef(null);
  const hydrateFromDB = useCallback(async (u) => {
    if (hydratingUserRef.current === u.id) return;
    hydratingUserRef.current = u.id;
    try {
      const { profile, portfolios: userPortfolios } = await ensureProfile(supabase, u.id);
      setPortfolios(userPortfolios);
      // Restore checked portfolio IDs from view_states, or fall back to active
      const lastUsedPid = profile?.view_states?.activePortfolioId;
      const savedChecked = profile?.view_states?.checkedPortfolioIds;
      let checkedIds;
      if (savedChecked && savedChecked.length > 0) {
        const validIds = savedChecked.filter((id) => userPortfolios.some((p) => p.id === id));
        checkedIds = validIds.length > 0 ? validIds : [userPortfolios[0]?.id];
      } else {
        const fallbackPid = userPortfolios.find((p) => p.id === lastUsedPid)?.id || userPortfolios[0]?.id;
        checkedIds = [fallbackPid];
      }
      const activePid = checkedIds.includes(lastUsedPid) ? lastUsedPid : checkedIds[0];
      setPortfolioId(activePid);
      setCheckedPortfolioIds(new Set(checkedIds));
      await hydratePortfolios(checkedIds);
      if (profile) {
        if (profile.display_currency) {
          setDisplayCurrency(profile.display_currency);
          _displayCurrency = profile.display_currency;
          localStorage.setItem('investo-currency', profile.display_currency);
        }
        if (profile.dark_mode != null) {
          setDark(profile.dark_mode);
          localStorage.setItem('investo-dark', String(profile.dark_mode));
        }
        if (profile.view_states) {
          const vs = profile.view_states;
          if (vs.overviewOpen != null) setOverviewOpen(vs.overviewOpen);
          if (vs.chartsOpen != null) setChartsOpen(vs.chartsOpen);
          if (vs.summaryOpen != null) setSummaryOpen(vs.summaryOpen);
          if (vs.statsOpen != null) setStatsOpen(vs.statsOpen);
          if (vs.aboutOpen != null) setAboutOpen(vs.aboutOpen);
        }
      }
    } catch (e) {
      hydratingUserRef.current = null;
      console.error('Auth hydration error:', e);
    }
  }, [hydratePortfolios]);

  // ─── Portfolio management ─────────────────────────────────────────────────

  const switchPortfolio = useCallback(async (pid) => {
    if (pid === portfolioId && checkedPortfolioIds.size === 1 && checkedPortfolioIds.has(pid)) return;
    setPortfolioId(pid);
    setCheckedPortfolioIds(new Set([pid]));
    await hydratePortfolios([pid]);
    setPortfolioSwitcherOpen(false);
  }, [portfolioId, checkedPortfolioIds, hydratePortfolios]);

  const handleCreatePortfolio = useCallback(async (name) => {
    if (!supabase || !user || !name.trim()) return;
    try {
      const newP = await createPortfolio(supabase, user.id, name.trim());
      setPortfolios((prev) => [...prev, newP]);
      setNewPortfolioName('');
      await switchPortfolio(newP.id);
    } catch (e) {
      console.error('Failed to create portfolio:', e);
    }
  }, [user, switchPortfolio]);

  const togglePortfolioCheck = useCallback(async (pid) => {
    const newChecked = new Set(checkedPortfolioIds);
    if (newChecked.has(pid)) {
      newChecked.delete(pid);
      if (newChecked.size === 0) return; // can't uncheck all
    } else {
      newChecked.add(pid);
    }
    setCheckedPortfolioIds(newChecked);
    // If primary is no longer checked, update it
    if (!newChecked.has(portfolioId)) {
      setPortfolioId([...newChecked][0]);
    }
    await hydratePortfolios([...newChecked]);
  }, [checkedPortfolioIds, portfolioId, hydratePortfolios]);

  const handleDeletePortfolio = useCallback(async (pid) => {
    if (!supabase || portfolios.length <= 1) return; // prevent deleting last portfolio
    try {
      await deletePortfolioDb(supabase, pid);
      const remaining = portfolios.filter((p) => p.id !== pid);
      setPortfolios(remaining);
      // Remove from checked set
      const newChecked = new Set(checkedPortfolioIds);
      newChecked.delete(pid);
      if (newChecked.size === 0) newChecked.add(remaining[0].id);
      setCheckedPortfolioIds(newChecked);
      // If we deleted the primary, switch to another
      if (pid === portfolioId) {
        setPortfolioId([...newChecked][0]);
      }
      await hydratePortfolios([...newChecked]);
    } catch (e) {
      console.error('Failed to delete portfolio:', e);
    }
  }, [portfolios, portfolioId, checkedPortfolioIds, hydratePortfolios]);

  const handleRenamePortfolio = useCallback((pid, name) => {
    if (!supabase || !name.trim()) return;
    renamePortfolio(supabase, pid, name.trim());
    setPortfolios((prev) => prev.map((p) => p.id === pid ? { ...p, name: name.trim() } : p));
    setRenamingPortfolioId(null);
    setRenamingPortfolioName('');
  }, []);

  // Auth state listener — callback must be synchronous to avoid Supabase deadlock
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const u = session.user;
        setUser({
          id: u.id, email: u.email,
          name: u.user_metadata?.full_name || u.email,
          avatar: u.user_metadata?.avatar_url,
        });
        // Defer async DB work outside the callback to prevent deadlock
        setTimeout(() => hydrateFromDB(u), 0);
      } else {
        setUser(null);
        setPortfolioId(null);
        setPortfolios([]);
        setCheckedPortfolioIds(new Set());
      }
    });
    return () => subscription.unsubscribe();
  }, [hydrateFromDB]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  }, []);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const signOut = useCallback(async () => {
    if (!supabase) return;
    setIsSigningOut(true);
    // No sync needed — every mutation is written to DB immediately
    // Race with timeout to prevent infinite hang from Supabase lock issues
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('signOut timeout')), 5000)),
      ]);
    } catch { /* ignore — force continue with local cleanup */ }
    // Clear local state
    isHydratingRef.current = true;
    setUser(null);
    setPortfolioId(null);
    setPortfolios([]);
    setCheckedPortfolioIds(new Set());
    setTransactions([]);
    setSelectedAssets({});
    setHiddenAssets(new Set());
    setPriceCache(null);
    setChartData([]);
    setStats([]);
    setDisplayCurrency('EUR');
    _displayCurrency = 'EUR';
    setAssetCurrencies({});
    setExchangeRates([]);
    colorIdx.current = 0;
    fetchedRangesRef.current = {};
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem('investo-currency');
    setIsSigningOut(false);
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
    // Also need to run if cash was added but not yet in the price cache
    const needsCash = hasCash && !fetched[CASH_TICKER];
    if (!needsFetch && !needsCash) return;

    let cancelled = false;
    const debounce = setTimeout(async () => {
      setIsSimulating(true);
      setFetchError(null);
      try {
        const result = needsFetch && tickers.length > 0 ? await fetchPrices(dateRanges) : { prices: {}, currencies: {} };
        const prices = result.prices;
        if (!cancelled) {
          // Update asset currencies from API metadata
          if (Object.keys(result.currencies).length > 0) {
            setAssetCurrencies((prev) => ({ ...prev, ...result.currencies }));
          }
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
          // Always fetch exchange rates — needed for currency switching (bank + stocks)
          try {
            const rates = await fetchExchangeRates(fetchStart, TODAY);
            if (!cancelled && rates.length > 0) setExchangeRates(rates);
          } catch { /* exchange rate fetch is best-effort */ }
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
  livePriceCacheRef.current = livePriceCache;
  // ─── Backfill missing priceAtEntry for imported shares-based transactions ─
  useEffect(() => {
    if (!livePriceCache) return;
    let updatedTxs = [];
    setTransactions((prev) => {
      let changed = false;
      const next = prev.map((tx) => {
        if (tx.ticker === CASH_TICKER || tx.shares == null || (tx.priceAtEntry != null && tx.priceAtEntry > 0)) return tx;
        const prices = livePriceCache[tx.ticker];
        if (!prices?.length) return tx;
        const entry = prices.findLast((p) => p.date <= tx.date);
        if (!entry || entry.price <= 0) return tx;
        changed = true;
        const updated = { ...tx, priceAtEntry: entry.price };
        updatedTxs.push(updated);
        return updated;
      });
      return changed ? next : prev;
    });
    if (supabase && portfolioId && updatedTxs.length > 0) {
      updatedTxs.forEach((tx) => updateTransaction(supabase, portfolioId, tx));
    }
  }, [livePriceCache, supabase, portfolioId]);

  // ─── Recompute chart

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

    // Compute stats for visible transactions (for correct Combined total)
    const tickers = [...new Set(activeTx.map((tx) => tx.ticker))];
    const names = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.name]),
    );
    const colors = Object.fromEntries(
      Object.entries(selectedAssets).map(([t, a]) => [t, a.color]),
    );
    const visibleStats = computeStats(data, tickers, activeTx, names, colors);

    // Also compute stats for hidden assets to show in Stats section
    const hiddenTx = transactions.filter((tx) => hiddenAssets.has(tx.ticker) && livePriceCache[tx.ticker]?.length > 0);
    if (hiddenTx.length > 0) {
      const hiddenData = simulate(livePriceCache, hiddenTx);
      const hiddenTickers = [...new Set(hiddenTx.map((tx) => tx.ticker))];
      const hiddenStats = computeStats(hiddenData, hiddenTickers, hiddenTx, names, colors).filter((s) => !s.isPortfolio);
      setStats([...visibleStats, ...hiddenStats]);
    } else {
      setStats(visibleStats);
    }
  }, [livePriceCache, visibleTransactions, transactions, selectedAssets, hiddenAssets]);

  // ─── Currency conversion layer ────────────────────────────────────────────

  // Determine the bank account's native currency
  const bankCurrency = useMemo(() => {
    // Use explicit currency from bank transactions if available
    const cashTxs = transactions.filter(tx => tx.ticker === CASH_TICKER && tx.currency);
    if (cashTxs.length > 0) return cashTxs[cashTxs.length - 1].currency;
    // Infer from the most common asset currency (user's likely home currency)
    const currencies = Object.values(assetCurrencies);
    if (currencies.length === 0) return displayCurrency;
    const counts = {};
    currencies.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }, [transactions, assetCurrencies, displayCurrency]);

  // Helper: get the exchange rate multiplier for converting a native currency to display currency on a given date
  const getConversionRate = useCallback((nativeCurrency, date) => {
    if (!nativeCurrency || nativeCurrency === displayCurrency) return 1;
    // Find closest rate (forward-fill)
    let rate = null;
    for (const entry of exchangeRates) {
      if (entry.date <= date) rate = entry.rate;
      else break;
    }
    if (rate == null) return 1; // no rate available, show unconverted
    // EURUSD rate = how many USD per 1 EUR
    if (nativeCurrency === 'EUR' && displayCurrency === 'USD') return rate;
    if (nativeCurrency === 'USD' && displayCurrency === 'EUR') return 1 / rate;
    return 1; // unsupported pair
  }, [displayCurrency, exchangeRates]);

  // Convert a transaction to its display-currency monetary value
  const convertTxAmount = useCallback((tx) => {
    // Shares-based stock tx: shares * priceAtEntry gives native-currency amount, then convert
    if (tx.shares != null && tx.priceAtEntry != null && tx.ticker !== CASH_TICKER) {
      const nativeAmount = tx.shares * tx.priceAtEntry;
      const native = assetCurrencies[tx.ticker];
      if (!native || native === displayCurrency) return nativeAmount;
      return nativeAmount * getConversionRate(native, tx.date);
    }
    // Legacy amount-based tx or cash tx
    const storedCurrency = tx.currency || (tx.ticker === CASH_TICKER ? bankCurrency : assetCurrencies[tx.ticker]);
    if (!storedCurrency || storedCurrency === displayCurrency) return tx.amount;
    return tx.amount * getConversionRate(storedCurrency, tx.date);
  }, [assetCurrencies, bankCurrency, displayCurrency, getConversionRate]);

  const needsConversion = useMemo(() => {
    return Object.values(assetCurrencies).some((c) => c !== displayCurrency) ||
           bankCurrency !== displayCurrency;
  }, [assetCurrencies, displayCurrency, bankCurrency]);

  const convertedChartData = useMemo(() => {
    if (!needsConversion || chartData.length === 0 || exchangeRates.length === 0) return chartData;
    const tickers = [...new Set(transactions.filter((tx) => tx.ticker !== CASH_TICKER).map((tx) => tx.ticker))];
    // Build forward-filled rate map for fast lookup
    const rateMap = new Map();
    let lastRate = null;
    const allDates = chartData.map((p) => p.date);
    let rateIdx = 0;
    for (const date of allDates) {
      while (rateIdx < exchangeRates.length && exchangeRates[rateIdx].date <= date) {
        lastRate = exchangeRates[rateIdx].rate;
        rateIdx++;
      }
      if (lastRate != null) rateMap.set(date, lastRate);
    }
    return chartData.map((point) => {
      const converted = { date: point.date };
      let total = 0;
      const eurusd = rateMap.get(point.date);
      for (const ticker of tickers) {
        const val = point[ticker];
        if (val == null) continue;
        const native = assetCurrencies[ticker];
        if (!native || native === displayCurrency || !eurusd) {
          converted[ticker] = val;
        } else if (native === 'EUR' && displayCurrency === 'USD') {
          converted[ticker] = Math.round(val * eurusd * 100) / 100;
        } else if (native === 'USD' && displayCurrency === 'EUR') {
          converted[ticker] = Math.round(val / eurusd * 100) / 100;
        } else {
          converted[ticker] = val;
        }
        total += converted[ticker];
      }
      // Cash: convert if bank currency differs from display currency
      if (point[CASH_TICKER] != null) {
        if (bankCurrency && bankCurrency !== displayCurrency && eurusd) {
          if (bankCurrency === 'EUR' && displayCurrency === 'USD') {
            converted[CASH_TICKER] = Math.round(point[CASH_TICKER] * eurusd * 100) / 100;
          } else if (bankCurrency === 'USD' && displayCurrency === 'EUR') {
            converted[CASH_TICKER] = Math.round(point[CASH_TICKER] / eurusd * 100) / 100;
          } else {
            converted[CASH_TICKER] = point[CASH_TICKER];
          }
        } else {
          converted[CASH_TICKER] = point[CASH_TICKER];
        }
        total += converted[CASH_TICKER];
      }
      if (point['Total Portfolio'] != null) {
        converted['Total Portfolio'] = Math.round(total * 100) / 100;
      }
      return converted;
    });
  }, [chartData, needsConversion, exchangeRates, assetCurrencies, displayCurrency, transactions, bankCurrency]);

  // Converted stats use convertedChartData
  const convertedStats = useMemo(() => {
    if (!needsConversion || convertedChartData.length === 0) return stats;
    // Recompute stats on converted data
    const activeTx = visibleTransactions.filter((tx) => livePriceCache?.[tx.ticker]?.length > 0);
    if (activeTx.length === 0) return stats;
    const tickers = [...new Set(activeTx.map((tx) => tx.ticker))];
    const names = Object.fromEntries(Object.entries(selectedAssets).map(([t, a]) => [t, a.name]));
    const colors = Object.fromEntries(Object.entries(selectedAssets).map(([t, a]) => [t, a.color]));
    // Convert transaction amounts to display currency for stats
    const convertedTx = activeTx.map((tx) => ({ ...tx, amount: convertTxAmount(tx) }));
    const visibleStats = computeStats(convertedChartData, tickers, convertedTx, names, colors);
    // Also compute hidden asset stats
    const hiddenTx = transactions.filter((tx) => hiddenAssets.has(tx.ticker) && livePriceCache?.[tx.ticker]?.length > 0);
    if (hiddenTx.length > 0) {
      const hiddenRaw = simulate(livePriceCache, hiddenTx);
      const hiddenConverted = !needsConversion ? hiddenRaw : hiddenRaw.map((point) => {
        const cp = { date: point.date };
        for (const key of Object.keys(point)) {
          if (key === 'date') continue;
          const native = key === CASH_TICKER ? bankCurrency : assetCurrencies[key];
          const eurusd = exchangeRateMap.get(point.date);
          if (!native || native === displayCurrency || !eurusd || key === 'Total Portfolio') {
            cp[key] = point[key];
          } else if (native === 'EUR' && displayCurrency === 'USD') {
            cp[key] = Math.round(point[key] * eurusd * 100) / 100;
          } else if (native === 'USD' && displayCurrency === 'EUR') {
            cp[key] = Math.round(point[key] / eurusd * 100) / 100;
          } else {
            cp[key] = point[key];
          }
        }
        return cp;
      });
      const hiddenTickers = [...new Set(hiddenTx.map((tx) => tx.ticker))];
      const convertedHiddenTx = hiddenTx.map((tx) => ({ ...tx, amount: convertTxAmount(tx) }));
      const hiddenStats = computeStats(hiddenConverted, hiddenTickers, convertedHiddenTx, names, colors).filter((s) => !s.isPortfolio);
      return [...visibleStats, ...hiddenStats];
    }
    return visibleStats;
  }, [needsConversion, convertedChartData, stats, visibleTransactions, transactions, selectedAssets, hiddenAssets, livePriceCache, assetCurrencies, displayCurrency, exchangeRateMap, convertTxAmount, bankCurrency]);

  // Extract current share counts from raw chart data (units don't depend on currency)
  const currentShares = useMemo(() => {
    if (chartData.length === 0) return {};
    const last = chartData[chartData.length - 1];
    const shares = {};
    selectedTickers.forEach((t) => {
      const units = last[t + '_units'];
      if (units != null && units > 0) shares[t] = units;
    });
    return shares;
  }, [chartData, selectedTickers]);

  // Auto-compute modalAmount when in shares mode (uses closing price from cache or fetches on-demand)
  useEffect(() => {
    if (modalInputMode !== 'shares') return;
    const shares = Number(modalShares);
    if (!shares || shares <= 0) { setModalAmount(0); setModalPrice(null); return; }
    const ticker = stagedAsset?.symbol || sellTicker || editingTx?.ticker;
    if (!ticker) return;

    // Try the live price cache first
    const cached = livePriceCache?.[ticker];
    if (cached?.length) {
      const entry = cached.findLast(p => p.date <= modalDate) || cached[0];
      const closingPrice = entry?.price;
      if (closingPrice && isFinite(closingPrice)) {
        const native = assetCurrencies[ticker] || displayCurrency;
        const rate = getConversionRate(native, modalDate);
        setModalAmount(Math.round(shares * closingPrice * rate * 100) / 100);
        setModalPrice(closingPrice);
        return;
      }
    }

    // No cached price — fetch on-demand for this ticker/date
    let cancelled = false;
    setModalAmount(0);
    setModalPrice(null);
    const period1 = Math.floor(new Date(modalDate + 'T00:00:00').getTime() / 1000) - 86400 * 7;
    const period2 = Math.floor(new Date(modalDate + 'T00:00:00').getTime() / 1000) + 86400;
    fetch(`/api/chart/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        const result = data?.chart?.result?.[0];
        if (!result?.timestamp) return;
        const timestamps = result.timestamp;
        const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
        // Find the closest price on or before modalDate
        let closingPrice = null;
        for (let i = timestamps.length - 1; i >= 0; i--) {
          const d = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
          if (d <= modalDate && closes[i] != null) { closingPrice = closes[i]; break; }
        }
        if (!closingPrice) closingPrice = closes.findLast(c => c != null);
        if (!closingPrice || !isFinite(closingPrice)) return;
        const nativeCur = result.meta?.currency?.toUpperCase() || displayCurrency;
        const rate = getConversionRate(nativeCur, modalDate);
        setModalAmount(Math.round(shares * closingPrice * rate * 100) / 100);
        setModalPrice(closingPrice);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [modalInputMode, modalShares, modalDate, stagedAsset, sellTicker, editingTx, livePriceCache, assetCurrencies, displayCurrency, getConversionRate]);

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
    if (!chartRangeCutoff || convertedChartData.length === 0) return convertedChartData;
    return convertedChartData.filter(p => p.date >= chartRangeCutoff);
  }, [convertedChartData, chartRangeCutoff]);

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
    return convertedChartData.filter(p => p.date >= cutoff);
  }, [convertedChartData, chartRangeCutoff, oldestStockTxDate, filteredChartData]);

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
    if (convertedChartData.length === 0) return { assetMarkers: [], portfolioMarkers: [] };
    const dateIndex = new Map(convertedChartData.map((p, i) => [p.date, i]));
    const asset = [];
    const portfolio = [];
    visibleTransactions.forEach((tx) => {
      let idx = dateIndex.get(tx.date);
      if (idx == null) idx = convertedChartData.findIndex((p) => p.date >= tx.date);
      if (idx == null || idx < 0) return;
      const point = convertedChartData[idx];
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
  }, [convertedChartData, visibleTransactions]);

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
    if (supabase && user) updateProfile(supabase, user.id, { dark_mode: next });
  }, [dark, user]);

  const toggleCurrency = useCallback(() => {
    const next = displayCurrency === 'USD' ? 'EUR' : 'USD';
    setDisplayCurrency(next);
    _displayCurrency = next;
    localStorage.setItem('investo-currency', next);
    if (supabase && user) updateProfile(supabase, user.id, { display_currency: next });
  }, [displayCurrency, user]);


  return (
    <div className={`min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans p-4 md:p-8${dark ? ' dark' : ''}`}>
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Menu */}
        <div className="sticky top-0 z-30 bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-sm -mx-4 md:-mx-8 px-4 md:px-8 py-3">
        <div className="flex items-center">
          <button
            onClick={() => { setModalPortfolioId(portfolioId); setAddTxOpen(true); }}
            className={`px-4 py-2 rounded-2xl font-bold transition-all flex items-center gap-2 shadow-lg active:scale-95 bg-blue-600 hover:bg-blue-700 text-white text-sm${transactions.length === 0 ? ' animate-[pulse-ring_2s_ease-in-out_infinite]' : ''}`}
          >
            New Transaction
          </button>
          <button
            onClick={toggleCurrency}
            className={`ml-3 px-3 py-2 rounded-2xl font-black text-sm transition-all active:scale-95 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300${transactions.length === 0 ? ' animate-[pulse-ring_2s_ease-in-out_infinite]' : ''}`}
            title={`Display in ${displayCurrency === 'USD' ? 'EUR' : 'USD'}`}
          >
            {displayCurrency === 'USD' ? '$' : '€'}
          </button>
          {/* Portfolio Switcher — only for signed-in users with multiple portfolios */}
          {user && portfolios.length > 0 && (
            <div className="relative ml-3">
              <button
                onClick={() => setPortfolioSwitcherOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-all text-xs font-bold"
                title="Switch portfolio"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="hidden sm:inline max-w-[120px] truncate">{checkedPortfolioIds.size > 1 ? `${checkedPortfolioIds.size} portfolios` : portfolios.find((p) => p.id === portfolioId)?.name || 'Portfolio'}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${portfolioSwitcherOpen ? 'rotate-180' : ''}`} />
              </button>
              {portfolioSwitcherOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => { setPortfolioSwitcherOpen(false); setRenamingPortfolioId(null); }} />
                  <div className="absolute left-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3 z-50 space-y-1">
                    {portfolios.map((p) => (
                      <div key={p.id} className="group flex items-center gap-1">
                        {renamingPortfolioId === p.id ? (
                          <form
                            className="flex-1 flex gap-1"
                            onSubmit={(e) => { e.preventDefault(); handleRenamePortfolio(p.id, renamingPortfolioName); }}
                          >
                            <input
                              autoFocus
                              value={renamingPortfolioName}
                              onChange={(e) => setRenamingPortfolioName(e.target.value)}
                              className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-blue-500"
                              onKeyDown={(e) => { if (e.key === 'Escape') { setRenamingPortfolioId(null); } }}
                            />
                            <button type="submit" className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                              <Check className="w-3 h-3" />
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); togglePortfolioCheck(p.id); }}
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                checkedPortfolioIds.has(p.id)
                                  ? 'bg-blue-500 border-blue-500 text-white'
                                  : 'border-slate-300 dark:border-slate-600'
                              }`}
                              title={checkedPortfolioIds.has(p.id) ? 'Hide from view' : 'Show in view'}
                            >
                              {checkedPortfolioIds.has(p.id) && <Check className="w-2.5 h-2.5" />}
                            </button>
                            <button
                              onClick={() => switchPortfolio(p.id)}
                              className="flex-1 flex items-center gap-2 px-2 py-2 rounded-xl text-xs font-bold transition-all text-left text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="Set as active portfolio"
                            >
                              <span className="truncate">{p.name}</span>
                            </button>
                            <button
                              onClick={() => { setRenamingPortfolioId(p.id); setRenamingPortfolioName(p.name); }}
                              className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-all"
                              title="Rename"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            {portfolios.length > 1 && (
                              <button
                                onClick={() => handleDeletePortfolio(p.id)}
                                className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 opacity-0 group-hover:opacity-100 transition-all"
                                title="Delete portfolio"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    <div className="border-t border-slate-100 dark:border-slate-700 pt-1 mt-1">
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => { e.preventDefault(); handleCreatePortfolio(newPortfolioName); }}
                      >
                        <input
                          value={newPortfolioName}
                          onChange={(e) => setNewPortfolioName(e.target.value)}
                          placeholder="New portfolio name…"
                          className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={!newPortfolioName.trim()}
                          className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30"
                          title="Create portfolio"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
          {supabase && (
            user ? (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-700">
                  {user.avatar ? (
                    <img src={user.avatar} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <Cloud className="w-4 h-4 text-slate-500" />
                  )}
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 hidden sm:inline">{user.name || user.email}</span>
                </div>
                <button
                  onClick={signOut}
                  disabled={isSigningOut}
                  className="p-2 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-slate-400 hover:text-rose-500 transition-all disabled:opacity-50"
                  title="Sign out"
                >
                  {isSigningOut ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                </button>
              </div>
            ) : (
              <button
                onClick={signInWithGoogle}
                className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all"
                title="Sign in"
              >
                <LogIn className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 hidden sm:inline">Sign in</span>
              </button>
            )
          )}
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
                  {user && (
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <button
                      onClick={async () => {
                        setApiKeysOpen((v) => !v);
                        if (!apiKeysOpen && user) {
                          try { setApiKeys(await listApiKeys(supabase, user.id)); } catch (e) { console.error(e); }
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                    >
                      <Key className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                      <div className="flex-1">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 text-left">API Keys</p>
                        <p className="text-[10px] text-slate-400 text-left">Programmatic access</p>
                      </div>
                      <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${apiKeysOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {apiKeysOpen && (
                      <div className="space-y-2 pl-2">
                        {revealedKey && (
                          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 space-y-1.5">
                            <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">Copy this key — it won't be shown again!</p>
                            <div className="flex gap-1">
                              <code className="flex-1 text-[10px] bg-white dark:bg-slate-800 rounded px-2 py-1.5 font-mono text-slate-700 dark:text-slate-300 break-all select-all">{revealedKey}</code>
                              <button
                                onClick={() => { navigator.clipboard.writeText(revealedKey); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000); }}
                                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors flex-shrink-0"
                                title="Copy"
                              >
                                {keyCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>
                        )}
                        {apiKeys.map((k) => (
                          <div key={k.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-700/50 group">
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 truncate">{k.name}</p>
                              <p className="text-[9px] text-slate-400 flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleDateString()}` : 'Never used'}
                              </p>
                            </div>
                            <button
                              onClick={() => { deleteApiKey(supabase, k.id); setApiKeys((prev) => prev.filter((x) => x.id !== k.id)); }}
                              className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 opacity-0 group-hover:opacity-100 transition-all"
                              title="Delete key"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                        <form
                          className="flex gap-1"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!user) return;
                            const name = newKeyName.trim() || 'Untitled';
                            // Generate random key
                            const bytes = new Uint8Array(32);
                            crypto.getRandomValues(bytes);
                            const raw = 'inv_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
                            // Hash with SubtleCrypto
                            const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
                            const hash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
                            try {
                              const created = await createApiKey(supabase, user.id, name, hash);
                              setApiKeys((prev) => [...prev, created]);
                              setRevealedKey(raw);
                              setNewKeyName('');
                            } catch (err) { console.error('Failed to create API key:', err); }
                          }}
                        >
                          <input
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            placeholder="Key name…"
                            className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="submit"
                            className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors text-[10px] font-bold px-2"
                            title="Generate new API key"
                          >
                            Generate
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                  )}
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          {sidebarOpen && transactions.length > 0 && (
          <aside className="lg:col-span-4 space-y-4">

            {/* Overview */}
            {(selectedTickers.length > 0 || hasCashTx) && (
            <div ref={overviewRef} className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
              <button onClick={() => setOverviewOpen(v => !v)} className="w-full flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" /> Overview
                </h3>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${overviewOpen ? 'rotate-90' : ''}`} />
              </button>

              {overviewOpen && (() => {
                const lastPoint = convertedChartData[convertedChartData.length - 1];
                const visTxs = transactions.filter(tx => !hiddenAssets.has(tx.ticker));
                // Stock calculations
                const visibleStockTickers = selectedTickers.filter(t => !hiddenAssets.has(t));
                const stockBuys = visTxs.reduce((s, tx) => s + (tx.type === 'buy' ? convertTxAmount(tx) : 0), 0);
                const stockSells = visTxs.reduce((s, tx) => s + (tx.type === 'sell' ? convertTxAmount(tx) : 0), 0);
                const stockValue = visibleStockTickers.reduce((s, t) => s + (lastPoint?.[t] ?? 0), 0);
                const stockReturn = stockValue + stockSells - stockBuys;
                const stockReturnPct = stockBuys > 0 ? (stockReturn / stockBuys) * 100 : 0;
                const stockPositive = stockReturn >= 0;
                // Bank calculations
                const bankDeposited = visTxs.reduce((s, tx) => s + (tx.type === 'deposit' ? convertTxAmount(tx) : 0), 0);
                const bankWithdrawn = visTxs.reduce((s, tx) => s + (tx.type === 'withdraw' ? convertTxAmount(tx) : 0), 0);
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
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Stocks Invested</p>
                        <p className="text-xl font-black">{formatCurrency(stockBuys)}</p>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400">{visibleStockTickers.length} asset{visibleStockTickers.length !== 1 ? 's' : ''}</p>
                    </div>
                    {stockSells > 0 && (
                    <>
                      <div className="border-t border-slate-200 dark:border-slate-700" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Stocks Sold</p>
                        <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(stockSells)}</p>
                      </div>
                    </>
                    )}
                    <div className="border-t border-slate-200 dark:border-slate-700" />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Return</p>
                        <p className={`text-xl font-black ${stockPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{formatCurrency(stockReturn)}</p>
                      </div>
                      <span className={`text-xs font-black px-2 py-1 rounded-lg ${stockPositive ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>{stockPositive ? '+' : ''}{stockReturnPct.toFixed(1)}%</span>
                    </div>
                  </div>
                  )}
                  {/* Bank */}
                  {hasCashTx && !hiddenAssets.has(CASH_TICKER) && (
                  <div className="p-4 rounded-2xl border bg-indigo-500/10 border-indigo-500/20 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Bank Deposits</p>
                      <p className="text-xl font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(bankDeposited)}</p>
                    </div>
                    {bankWithdrawn > 0 && (
                    <>
                      <div className="border-t border-slate-200 dark:border-slate-700" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Withdrawals</p>
                        <p className="text-xl font-black text-amber-600 dark:text-amber-400">{formatCurrency(bankWithdrawn)}</p>
                      </div>
                      <div className="border-t border-slate-200 dark:border-slate-700" />
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Bank Balance</p>
                        <p className="text-xl font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(bankBalance)}</p>
                      </div>
                    </>
                    )}
                  </div>
                  )}
                  {/* Net Worth */}
                  <div className="p-4 rounded-2xl border bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Net Worth</p>
                        <p className="text-2xl font-black">{formatCurrency(netWorth)}</p>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400">{transactions.length} tx</p>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
            )}

            {/* History */}
            {(selectedTickers.length > 0 || hasCashTx) && (
            <div ref={historyRef} className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl sm:rounded-[2.5rem] shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col" style={historyOpen ? { maxHeight: statsOpenHeightRef.current > 0 ? statsOpenHeightRef.current : '50vh', overflow: 'hidden' } : undefined}>
              <button onClick={() => setHistoryOpen(v => !v)} className={`w-full flex items-center justify-between ${historyOpen ? 'mb-4' : ''}`}>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <History className="w-4 h-4" /> History
                </h3>
                <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
              </button>
              {historyOpen && <div className="space-y-4 flex-1 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
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
                            <div className="absolute left-4 top-0 z-50 flex gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl">
                              {COLORS.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => {
                                    setSelectedAssets((prev) => ({ ...prev, [ticker]: { ...prev[ticker], color: c } }));
                                    setColorPickerTicker(null);
                                  }}
                                  className={`w-5 h-5 rounded-full transition-transform hover:scale-125 ${asset.color === c ? 'ring-2 ring-slate-900 dark:ring-white ring-offset-1 ring-offset-white dark:ring-offset-slate-800' : ''}`}
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
                        <div key={tx.id} onClick={() => openEditModal(tx)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all hover:brightness-125 ${tx.type === 'buy' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
                          <span className="uppercase text-[10px] font-black w-8">{tx.type}</span>
                          <span className="flex-1 text-slate-700 dark:text-slate-300">{formatCurrency(convertTxAmount(tx))}{tx.shares != null ? <span className="text-slate-400 ml-1">{Math.round(tx.shares * 10000) / 10000} sh</span> : ''}{tx.priceAtEntry ? <span className="text-slate-400 ml-1">@{getCurrencySymbol(assetCurrencies[tx.ticker] || displayCurrency)}{Math.round(tx.priceAtEntry * 100) / 100}</span> : tx.price ? <span className="text-slate-400 ml-1">@{getCurrencySymbol(assetCurrencies[tx.ticker] || displayCurrency)}{tx.price}</span> : ''}</span>
                          <span className="text-slate-400 text-[10px]">{formatShortDate(tx.date)}</span>
                          <button onClick={(e) => { e.stopPropagation(); removeTx(tx.id); }} className="text-slate-300 dark:text-slate-600 hover:text-rose-400 p-0.5 transition-colors">
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
                      <div key={tx.id} onClick={() => openEditModal(tx)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all hover:brightness-125 ${tx.type === 'deposit' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'}`}>
                        <span className="uppercase text-[10px] font-black w-14">{tx.type === 'deposit' ? 'deposit' : 'withdraw'}</span>
                        <span className="flex-1 text-slate-700 dark:text-slate-300">{formatCurrency(convertTxAmount(tx))}</span>
                        <span className="text-slate-400 text-[10px]">{formatShortDate(tx.date)}</span>
                        <button onClick={(e) => { e.stopPropagation(); removeTx(tx.id); }} className="text-slate-300 dark:text-slate-600 hover:text-rose-400 p-0.5 transition-colors">
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
          <main className={`${sidebarOpen && transactions.length > 0 ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>


            {/* Welcome screen */}
            {transactions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 sm:py-24 md:py-32 text-center">
                <div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-200 dark:shadow-blue-900/40 mb-6">
                  <BarChart3 className="text-white w-10 h-10" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-800 dark:text-slate-100 uppercase mb-3">
                  What I Have
                </h2>
                <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 max-w-md leading-relaxed mb-8">
                  Track your wealth in one place. Record stock purchases, bank deposits, and watch your net worth grow with real market data.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg w-full mb-8">
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
                    <ShoppingCart className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Buy stocks</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Real prices from Yahoo Finance</p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
                    <Landmark className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Track savings</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Deposits & withdrawals</p>
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700">
                    <BarChart3 className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">See your net worth</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Charts, stats & insights</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Hit <span className="font-bold text-blue-500">New Transaction</span> above to get started, or import a CSV from the <span className="font-bold text-slate-500 dark:text-slate-400">menu</span>.
                </p>
              </div>
            )}

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
                  {chartPage === 1 && convertedChartData.length > 0 && chartTickers.length > 0 && (
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
                  {chartPage === 2 && convertedChartData.length > 0 && chartTickers.length > 0 && (
                    <button
                      onClick={() => setShowMarkers((v) => !v)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${showMarkers ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}
                    >
                      {showMarkers ? '● Markers On' : '○ Markers Off'}
                    </button>
                  )}
                  {chartPage === 3 && convertedChartData.length > 0 && (
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
                  {chartPage === 6 && convertedChartData.length > 0 && chartTickers.length > 0 && (
                    <button
                      onClick={() => setShowMarkers((v) => !v)}
                      className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all whitespace-nowrap ${showMarkers ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}
                    >
                      {showMarkers ? '● Markers On' : '○ Markers Off'}
                    </button>
                  )}
                  {convertedChartData.length > 0 && convertedStats.length > 0 && (
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
                  {convertedChartData.length > 0 && (
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
              {[0, 1, 2, 4, 6, 7].includes(chartPage) && convertedChartData.length > 0 && (
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
                ) : convertedChartData.length === 0 ? (
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
labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer', color: dark ? '#94a3b8' : undefined }} onClick={handleLegendClick} />
                        {nwTickers.length > 1 && (
                          <Line type="monotone" dataKey="Total Portfolio" stroke={dark ? '#e2e8f0' : '#3b82f6'} strokeWidth={2} dot={false} hide={hiddenSeries.has('Total Portfolio')} />
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
                              strokeWidth={1.5}
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
                    if (tx.type === 'buy') cumDeposits += convertTxAmount(tx);
                    else cumWithdrawals += convertTxAmount(tx);
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
                    const cSym = getCurrencySymbol(displayCurrency);
                    return { date: p.date, 'Return %': Math.round(pct * 100) / 100, [`Return ${cSym}`]: Math.round(pnl) };
                  }).filter((d) => d['Return %'] !== 0 || d['Return $'] !== 0);
                  const isPct = perfMode === 0;
                  const perfSym = getCurrencySymbol(displayCurrency);
                  const dataKey = isPct ? 'Return %' : `Return ${perfSym}`;
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
labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <ReferenceLine y={0} stroke={dark ? '#475569' : '#cbd5e1'} strokeWidth={1} />
                        <Area type="monotone" dataKey={dataKey} stroke="#3b82f6" strokeWidth={1.5} dot={false} fill="none" />
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
labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
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
                              strokeWidth={1.5}
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
                  const lastPoint = convertedChartData[convertedChartData.length - 1];
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
                        const deps = txs.reduce((s, tx) => s + (tx.type === 'buy' ? convertTxAmount(tx) : 0), 0);
                        const withs = txs.reduce((s, tx) => s + (tx.type === 'sell' ? convertTxAmount(tx) : 0), 0);
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
                    if (tx.type === 'buy' || tx.type === 'deposit') cumDeposits += convertTxAmount(tx);
                    else if (tx.type === 'sell' || tx.type === 'withdraw') cumWithdrawals += convertTxAmount(tx);
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
                          tickFormatter={(v) => formatShort(v)} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [formatCurrency(v)]}
labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '30px', fontSize: '11px', fontWeight: 'bold', color: dark ? '#94a3b8' : undefined }} />
                        <Area type="monotone" dataKey="Portfolio Value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
                        <Area type="stepAfter" dataKey="Net Invested" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()

                : chartPage === 5 ? (() => {
                  // Returns by Asset — bar chart (page 5)
                  const lastPoint = convertedChartData[convertedChartData.length - 1];
                  const barData = chartTickers
                    .map((ticker) => {
                      const txs = transactions.filter((tx) => tx.ticker === ticker);
                      const deposits = txs.reduce((s, tx) => s + (tx.type === 'buy' ? convertTxAmount(tx) : 0), 0);
                      const withdrawals = txs.reduce((s, tx) => s + (tx.type === 'sell' ? convertTxAmount(tx) : 0), 0);
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
labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <Area type="stepAfter" dataKey={CASH_TICKER} name="Bank Balance" stroke={bankColor} fill={bankColor} fillOpacity={0.12} strokeWidth={1.5} dot={false} />
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
                          tickFormatter={(v) => `${getCurrencySymbol(assetCurrencies[ticker] || 'USD')}${v.toLocaleString()}`}
                          domain={['auto', 'auto']} />
                        <Tooltip
                          contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.25)', padding: '20px', backgroundColor: dark ? '#1e293b' : '#fff', color: dark ? '#e2e8f0' : undefined }}
                          itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                          formatter={(v) => [`${getCurrencySymbol(assetCurrencies[ticker] || 'USD')}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Price']}
                          labelFormatter={(l) => new Date(l).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
                        <Area type="monotone" dataKey="price" stroke={asset?.color || '#3b82f6'} strokeWidth={1.5} fill={asset?.color || '#3b82f6'} fillOpacity={0.1} dot={false} />
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
            {convertedStats.length > 0 && (() => {
              const portfolio = convertedStats.find((s) => s.isPortfolio);
              const assets = convertedStats.filter((s) => !s.isPortfolio);
              // Compute YTD % for all tickers + portfolio
              const ytdMap = {};
              if (convertedChartData.length > 0) {
                const yearStart = `${new Date().getFullYear()}-01-01`;
                const startEntry = convertedChartData.find(p => p.date >= yearStart);
                if (startEntry) {
                  const lastEntry = convertedChartData[convertedChartData.length - 1];
                  for (const key of Object.keys(startEntry)) {
                    if (key === 'date') continue;
                    const sv = startEntry[key] ?? 0;
                    const ev = lastEntry[key] ?? 0;
                    if (sv > 0) ytdMap[key] = (ev - sv) / sv;
                  }
                }
              }
              const portfolioYtd = ytdMap['Total Portfolio'] ?? null;
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
                    <div className="p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-2xl transition-all hover:translate-y-[-4px]">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-blue-600 text-white w-fit mb-2">Combined</div>
                          <p className="text-2xl sm:text-3xl font-black tracking-tight">{formatCurrency(portfolio.finalValue)}</p>
                          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">Total Portfolio</p>
                        </div>
                        {portfolioYtd != null && (
                          <div className="text-center">
                            <p className={`text-xl font-black ${portfolioYtd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {portfolioYtd >= 0 ? '+' : ''}{formatPercent(portfolioYtd)}
                            </p>
                            <p className="text-[10px] font-bold text-slate-500 uppercase">YTD</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {assets.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {assets.map((stat, idx) => {
                        const isCash = stat.ticker === CASH_TICKER;
                        const ytdPct = ytdMap[stat.ticker] ?? null;
                        return (
                        <div key={idx} className={`p-4 sm:p-6 rounded-2xl sm:rounded-[2rem] border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm transition-all hover:translate-y-[-4px] ${hiddenAssets.has(stat.ticker) ? 'opacity-50' : ''}`}>
                          <div className="flex justify-between items-center mb-4 gap-2">
                            <div className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 truncate min-w-0">
                            {displayTicker(stat.ticker)}
                            </div>
                            {ytdPct != null ? (
                              <div className={`flex items-center gap-1 text-xs font-black shrink-0 whitespace-nowrap ${ytdPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {ytdPct >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                                {formatPercent(Math.abs(ytdPct))} YTD
                              </div>
                            ) : null}
                          </div>
                          <h4 className="text-xs font-bold mb-1 truncate text-slate-500 dark:text-slate-400">
                            {isCash ? 'Bank Account' : `${stat.name} · ${formatCurrency(stat.totalDeposits)}`}
                          </h4>
                          <p className="text-2xl font-black tracking-tight">{formatCurrency(stat.finalValue)}</p>
                          {!isCash && (
                            <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-bold">
                              {currentShares[stat.ticker] != null && (
                                <span className="text-blue-500 dark:text-blue-400">{currentShares[stat.ticker] < 1 ? currentShares[stat.ticker].toFixed(4) : currentShares[stat.ticker].toFixed(2)} shares</span>
                              )}
                              <span className="text-slate-500 dark:text-slate-400">Ann. {formatPercent(stat.annualizedReturn)}</span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>}
                </div>
              );
            })()}

          </main>
        </div>

        {/* Summary Table — full width */}
        {convertedStats.length > 0 && (
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
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Shares</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Deposits</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Withdrawals</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Balance</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Return</th>
                    <th className="px-4 sm:px-8 py-3 sm:py-4 text-right">Ann. Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {convertedStats.filter((s) => !s.isPortfolio && !hiddenAssets.has(s.ticker)).map((stat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                      <td className="px-4 sm:px-8 py-4 sm:py-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: stat.color }} />
                          <span className="font-black text-sm">{stat.name} ({displayTicker(stat.ticker)})</span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm text-blue-600 dark:text-blue-400">
                        {stat.ticker !== CASH_TICKER && currentShares[stat.ticker] != null
                          ? (currentShares[stat.ticker] < 1 ? currentShares[stat.ticker].toFixed(4) : currentShares[stat.ticker].toFixed(2))
                          : '—'}
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm">{formatCurrency(stat.totalDeposits)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm">{formatCurrency(stat.totalWithdrawals)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-black text-sm text-blue-600 dark:text-blue-400">{formatCurrency(stat.finalValue)}</td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right">
                        {stat.ticker === CASH_TICKER ? (
                          <span className="font-bold text-sm text-slate-400">—</span>
                        ) : (
                          <span className={`font-black text-sm ${(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits)}
                            {stat.totalDeposits > 0 ? (
                              <span className="text-xs font-normal text-slate-400 ml-1">({(stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) >= 0 ? '+' : ''}{formatPercent((stat.finalValue + stat.totalWithdrawals - stat.totalDeposits) / stat.totalDeposits)})</span>
                            ) : (
                              <span className="text-xs font-normal text-slate-400 ml-1">(—)</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 sm:px-8 py-4 sm:py-6 text-right font-bold text-sm text-slate-500 dark:text-slate-400">{stat.ticker === CASH_TICKER ? '—' : formatPercent(stat.annualizedReturn)}</td>
                    </tr>
                  ))}
                  {convertedStats.find((s) => s.isPortfolio) && (() => {
                    const p = convertedStats.find((s) => s.isPortfolio);
                    return (
                      <tr className="bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white border-t border-slate-200 dark:border-slate-800">
                        <td className="px-4 sm:px-8 py-6 sm:py-10 font-black rounded-bl-2xl sm:rounded-bl-[2.5rem]">Portfolio Total</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold"></td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold">{formatCurrency(p.totalDeposits)}</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-bold">{formatCurrency(p.totalWithdrawals)}</td>
                        <td className="px-4 sm:px-8 py-6 sm:py-10 text-right font-black text-blue-600 dark:text-blue-400 text-lg">{formatCurrency(p.finalValue)}</td>
                        <td className={`px-4 sm:px-8 py-6 sm:py-10 text-right font-black text-lg ${(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatCurrency(p.finalValue + p.totalWithdrawals - p.totalDeposits)}
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">({(p.finalValue + p.totalWithdrawals - p.totalDeposits) >= 0 ? '+' : ''}{formatPercent((p.finalValue + p.totalWithdrawals - p.totalDeposits) / p.totalDeposits)})</span>
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
            {user && portfolios.length > 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Portfolio</p>
                <div className="flex flex-wrap gap-1.5">
                  {portfolios.map((p) => (
                    <button key={p.id} onClick={() => setModalPortfolioId(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${(modalPortfolioId || portfolioId) === p.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
            {user && portfolios.length > 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Portfolio</p>
                <div className="flex flex-wrap gap-1.5">
                  {portfolios.map((p) => (
                    <button key={p.id} onClick={() => setModalPortfolioId(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${(modalPortfolioId || portfolioId) === p.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                  <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                    {['amount', 'shares'].map((mode) => (
                      <button key={mode} onClick={() => {
                        setModalInputMode(mode);
                        if (mode === 'shares') { setModalAmount(0); setModalPrice(null); }
                      }}
                        className={`flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${modalInputMode === mode ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                        {mode === 'amount' ? 'Amount' : 'Shares'}
                      </button>
                    ))}
                  </div>
                  {modalInputMode === 'amount' ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{getCurrencySymbol(displayCurrency)}</span>
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
                  ) : (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Number of Shares</label>
                      <input type="number" value={modalShares} onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') { setModalShares(''); return; }
                        const n = Number(v);
                        if (!isNaN(n) && isFinite(n) && n >= 0) setModalShares(v);
                      }}
                        step="any" placeholder="0"
                        className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 px-3 text-lg font-black focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Purchase Date</label>
                    <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                  </div>
                  {modalInputMode === 'amount' ? (
                    <IntradayPricePicker ticker={stagedAsset.symbol} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="emerald" />
                  ) : Number(modalShares) > 0 && modalAmount > 0 && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950 border border-emerald-100 dark:border-emerald-900">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</span>
                        <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(modalAmount)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setStagedAsset(null)} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Back</button>
                  <button onClick={() => { addBuy(stagedAsset.symbol, stagedAsset.name); closeModal(); }}
                    disabled={modalInputMode === 'shares' ? (!modalShares || Number(modalShares) <= 0 || modalAmount <= 0) : modalAmount <= 0}
                    className="flex-1 py-3 rounded-2xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 shadow-lg transition-all active:scale-95">
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
            {user && portfolios.length > 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Portfolio</p>
                <div className="flex flex-wrap gap-1.5">
                  {portfolios.map((p) => (
                    <button key={p.id} onClick={() => setModalPortfolioId(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${(modalPortfolioId || portfolioId) === p.id ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sellTicker ? (() => {
              const entry = convertedChartData.findLast((p) => p.date <= modalDate);
              const availableBalance = entry?.[sellTicker] ?? 0;
              const sharesEntry = chartData.findLast((p) => p.date <= modalDate);
              const availableShares = sharesEntry?.[sellTicker + '_units'] ?? 0;
              return (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm font-black text-[10px] bg-rose-500">
                      {sellTicker.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-black truncate">{selectedAssets[sellTicker]?.name}</h4>
                      <p className="text-[10px] font-bold text-rose-500 uppercase">{sellTicker} · {modalInputMode === 'shares'
                        ? `Available: ${availableShares < 1 ? availableShares.toFixed(4) : availableShares.toFixed(2)} shares`
                        : `Available: ${formatCurrency(Math.max(0, availableBalance))}`}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                    {['amount', 'shares'].map((mode) => (
                      <button key={mode} onClick={() => setModalInputMode(mode)}
                        className={`flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${modalInputMode === mode ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                        {mode === 'amount' ? 'Amount' : 'Shares'}
                      </button>
                    ))}
                  </div>
                  {modalInputMode === 'amount' ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Sale Amount</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{getCurrencySymbol(displayCurrency)}</span>
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
                  ) : (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Number of Shares</label>
                      <input type="number" value={modalShares} onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') { setModalShares(''); return; }
                        const n = Number(v);
                        if (!isNaN(n) && isFinite(n) && n >= 0) setModalShares(v);
                      }}
                        step="any" placeholder="0"
                        className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 px-3 text-lg font-black focus:ring-2 focus:ring-rose-500 outline-none" />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Sale Date</label>
                    <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                      min={(() => {
                        const buys = (txByTicker[sellTicker] || []).filter((tx) => tx.type === 'buy');
                        return buys.length > 0 ? buys[0].date : undefined;
                      })()}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-rose-500 outline-none" />
                  </div>
                  {modalInputMode === 'amount' ? (
                    <IntradayPricePicker ticker={sellTicker} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="rose" />
                  ) : Number(modalShares) > 0 && modalAmount > 0 && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950 border border-rose-100 dark:border-rose-900">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</span>
                        <span className="text-lg font-black text-rose-600 dark:text-rose-400">{formatCurrency(modalAmount)}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setSellTicker(null)} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Back</button>
                  <button onClick={() => { addSell(sellTicker); closeModal(); }}
                    disabled={modalInputMode === 'shares'
                      ? (!modalShares || Number(modalShares) <= 0 || modalAmount <= 0 || Number(modalShares) > availableShares)
                      : (modalAmount <= 0 || modalAmount > availableBalance)}
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
            {user && portfolios.length > 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Portfolio</p>
                <div className="flex flex-wrap gap-1.5">
                  {portfolios.map((p) => (
                    <button key={p.id} onClick={() => setModalPortfolioId(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${(modalPortfolioId || portfolioId) === p.id ? (modalMode === 'deposit' ? 'bg-indigo-600 text-white' : 'bg-amber-600 text-white') : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{getCurrencySymbol(displayCurrency)}</span>
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
            {user && portfolios.length > 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Portfolio</p>
                <div className="flex flex-wrap gap-1.5">
                  {portfolios.map((p) => (
                    <button key={p.id} onClick={() => setModalPortfolioId(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${(modalPortfolioId || portfolioId) === p.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
              {editingTx.ticker !== CASH_TICKER && (
                <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-0.5">
                  {['amount', 'shares'].map((mode) => (
                    <button key={mode} onClick={() => {
                      setModalInputMode(mode);
                      // Keep the pre-computed shares for the edited transaction (set in openEditModal).
                      if (mode === 'shares' && !modalShares) { setModalAmount(0); setModalPrice(null); }
                    }}
                      className={`flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-xl transition-all ${modalInputMode === mode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}>
                      {mode === 'amount' ? 'Amount' : 'Shares'}
                    </button>
                  ))}
                </div>
              )}
              {modalInputMode === 'amount' || editingTx.ticker === CASH_TICKER ? (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">{getCurrencySymbol(displayCurrency)}</span>
                    <input 
                      type="text" 
                      inputMode="decimal"
                      value={modalAmount === '' ? '' : modalAmount} 
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '') { setModalAmount(''); return; }
                        if (/^\d*\.?\d*$/.test(value)) {
                          const numValue = parseFloat(value);
                          if (!isNaN(numValue)) setModalAmount(numValue);
                          else setModalAmount(value);
                        }
                      }}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 pl-8 pr-3 text-lg font-black focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Number of Shares</label>
                  <input type="number" value={modalShares} onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setModalShares(''); return; }
                    const n = Number(v);
                    if (!isNaN(n) && isFinite(n) && n >= 0) setModalShares(v);
                  }}
                    step="any" placeholder="0" autoFocus
                    className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 px-3 text-lg font-black focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Date</label>
                <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-2.5 px-3 text-xs font-bold text-slate-600 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              {modalInputMode === 'amount' || editingTx.ticker === CASH_TICKER ? (
                <IntradayPricePicker ticker={editingTx.ticker} date={modalDate} price={modalPrice} onPriceChange={setModalPrice} accentColor="blue" />
              ) : Number(modalShares) > 0 && modalAmount > 0 && (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950 border border-blue-100 dark:border-blue-900">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</span>
                    <span className="text-lg font-black text-blue-600 dark:text-blue-400">{formatCurrency(modalAmount)}</span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button onClick={() => saveEdit()} disabled={modalInputMode === 'shares' ? (!modalShares || Number(modalShares) <= 0 || modalAmount <= 0) : (!modalAmount || modalAmount <= 0)}
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
              {/* Drop zone */}
              <label
                className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-600 hover:border-blue-300 cursor-pointer transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400'); }}
                onDragLeave={(e) => e.currentTarget.classList.remove('border-blue-400')}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-400');
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleImportFile({ target: { files: [file] } });
                }}
              >
                <Upload className="w-5 h-5 text-slate-400" />
                <span className="text-sm font-bold text-slate-500 dark:text-slate-400">Drop or choose a file</span>
                <span className="text-[10px] text-slate-400">
                  CSV / TSV · {user ? 'PDF · PNG · JPG' : <span className="text-amber-500">Sign in for PDF & image support</span>}
                </span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,.pdf,.png,.jpg,.jpeg,.webp"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>

              {/* AI loading */}
              {importAiStatus === 'loading' && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
                  <span className="text-xs font-bold text-blue-600">Analyzing file with AI…</span>
                </div>
              )}

              {/* AI error */}
              {importAiStatus?.startsWith('error:') && (
                <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {importAiStatus.slice(6)}
                </p>
              )}

              {/* CSV textarea — only show when no AI rows */}
              {!aiImportRows && importAiStatus !== 'loading' && (
                <>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Or paste CSV / TSV · PDF · PNG · JPG</p>
                  <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={`Date,Asset,Name,Action,Amount\n2020-01-01,GOOGL,Alphabet Inc,buy,10000\n2023-06-15,AAPL,Apple Inc,buy,5000`}
                    rows={5}
                    className="w-full bg-slate-100 dark:bg-slate-700 border-none rounded-xl py-3 px-4 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                  />
                </>
              )}
            </div>

            {/* AI-parsed rows preview */}
            {aiImportRows?.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">{aiImportRows.length} transaction{aiImportRows.length !== 1 ? 's' : ''} found</p>
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> AI
                  </span>
                <button onClick={() => { setAiImportRows(null); setImportAiStatus(null); setImportConsolidate(false); }} className="ml-auto text-[9px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                    Clear
                  </button>
                </div>
                {/* Consolidate toggle — only for all-cash AI rows */}
                {aiImportRows.every(r => r.ticker === CASH_TICKER) && aiImportRows.length >= 2 && (() => {
                  const net = aiImportRows.reduce((s, r) => s + (r.type === 'deposit' ? r.amount : -r.amount), 0);
                  return (
                    <button
                      onClick={() => setImportConsolidate(v => !v)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold border-2 transition-colors ${
                        importConsolidate
                          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-600 text-slate-500 hover:border-blue-300'
                      }`}
                    >
                      <span>Consolidate into one transaction</span>
                      <span className={`font-black ${ net >= 0 ? 'text-indigo-600' : 'text-amber-600' }`}>
                        {net >= 0 ? '+' : ''}{formatCurrency(net)}
                      </span>
                    </button>
                  );
                })()}
                {!importConsolidate && (
                <div className="max-h-40 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {aiImportRows.map((row, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${
                      row.type === 'buy' ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700'
                      : row.type === 'deposit' ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700'
                      : row.type === 'withdraw' ? 'bg-amber-50 dark:bg-amber-950 text-amber-700'
                      : 'bg-rose-50 dark:bg-rose-950 text-rose-700'
                    }`}>
                      <span className="uppercase text-[10px] font-black w-8">{row.type}</span>
                      <span className="flex-1 truncate">{row.name} ({displayTicker(row.ticker)})</span>
                      <span>{row.isShares ? `${row.amount} shares` : formatCurrency(row.amount)}</span>
                      <span className="text-slate-400 text-[10px]">{row.date}</span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* CSV-parsed rows preview */}
            {!aiImportRows && importParsed.length > 0 && (
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
            {!aiImportRows && importText.trim() && importParsed.length === 0 && (
              <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> No valid transactions found. Expected: Date, Asset, Action, Amount
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 py-3 rounded-2xl font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">Cancel</button>
              <button
                onClick={confirmImport}
                disabled={(aiImportRows ?? importParsed).length === 0}
                className="flex-1 py-3 rounded-2xl font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 shadow-lg transition-all active:scale-95"
              >
                Import {(aiImportRows ?? importParsed).length > 0 ? `(${(aiImportRows ?? importParsed).length})` : ''}
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
