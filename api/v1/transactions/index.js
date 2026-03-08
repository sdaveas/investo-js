import { authenticate, supabase } from '../../_lib/auth.js';

const VALID_TYPES = ['buy', 'sell', 'deposit', 'withdraw'];

async function handlePost(req, res, userId) {
  const { portfolio, ticker, type, date, shares, price_at_entry, amount, currency } = req.body || {};

  // Validate required fields
  if (!ticker || !type || !date) {
    return res.status(400).json({ error: 'Missing required fields: ticker, type, date' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  if ((type === 'buy' || type === 'sell') && (shares == null || price_at_entry == null)) {
    return res.status(400).json({ error: 'buy/sell transactions require shares and price_at_entry' });
  }
  if ((type === 'deposit' || type === 'withdraw') && amount == null) {
    return res.status(400).json({ error: 'deposit/withdraw transactions require amount' });
  }

  // Resolve portfolio
  let portfolioId;
  if (portfolio) {
    const { data: p } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
      .eq('name', portfolio)
      .single();
    if (!p) {
      return res.status(404).json({ error: `Portfolio "${portfolio}" not found` });
    }
    portfolioId = p.id;
  } else {
    const { data: ps } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
      .order('created_at')
      .limit(1);
    if (!ps?.length) {
      return res.status(404).json({ error: 'No portfolios found for this user' });
    }
    portfolioId = ps[0].id;
  }

  // Auto-upsert asset if it's a new ticker (skip for _CASH)
  if (ticker !== '_CASH') {
    await supabase
      .from('assets')
      .upsert(
        { portfolio_id: portfolioId, ticker, name: ticker, color: '#3b82f6' },
        { onConflict: 'portfolio_id,ticker', ignoreDuplicates: true },
      );
  }

  // Build transaction row
  const row = {
    portfolio_id: portfolioId,
    ticker,
    type,
    date,
  };
  if (shares != null) row.shares = shares;
  if (price_at_entry != null) row.price_at_entry = price_at_entry;
  if (amount != null) row.amount = amount;
  if (currency) row.currency = currency;

  const { data, error } = await supabase
    .from('transactions')
    .insert(row)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json(data);
}

async function handleGet(req, res, userId) {
  const { portfolio, ticker, from, to } = req.query || {};

  // Get user's portfolio IDs
  let portfolioIds;
  if (portfolio) {
    const { data: p } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
      .eq('name', portfolio)
      .single();
    if (!p) {
      return res.status(404).json({ error: `Portfolio "${portfolio}" not found` });
    }
    portfolioIds = [p.id];
  } else {
    const { data: ps } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', userId);
    portfolioIds = (ps || []).map((p) => p.id);
  }

  if (portfolioIds.length === 0) {
    return res.status(200).json([]);
  }

  let query = supabase
    .from('transactions')
    .select('*')
    .in('portfolio_id', portfolioIds)
    .order('date');

  if (ticker) query = query.eq('ticker', ticker);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json(data);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { userId, error, status } = await authenticate(req);
  if (!userId) return res.status(status).json({ error });

  if (req.method === 'POST') return handlePost(req, res, userId);
  if (req.method === 'GET') return handleGet(req, res, userId);

  return res.status(405).json({ error: 'Method not allowed' });
}
