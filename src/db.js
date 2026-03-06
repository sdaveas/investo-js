/**
 * Database helpers for the normalized Supabase schema.
 * All write operations are fire-and-forget (optimistic UI).
 */

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Ensure a profile and default portfolio exist for the user.
 * Returns { profile, portfolioId }.
 */
export async function ensureProfile(supabase, userId) {
  // Upsert profile
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .upsert({ id: userId }, { onConflict: 'id' })
    .select()
    .single();
  if (pErr) throw pErr;

  // Get or create default portfolio
  let { data: portfolios } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  let portfolioId;
  if (portfolios && portfolios.length > 0) {
    portfolioId = portfolios[0].id;
  } else {
    const { data: newP, error: nErr } = await supabase
      .from('portfolios')
      .insert({ user_id: userId, name: 'Default' })
      .select('id')
      .single();
    if (nErr) throw nErr;
    portfolioId = newP.id;
  }

  return { profile, portfolioId };
}

/**
 * Load all user data: profile + assets + transactions for the default portfolio.
 */
export async function loadUserData(supabase, userId) {
  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  // Get default portfolio
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id, name')
    .eq('user_id', userId)
    .limit(1);

  if (!portfolios || portfolios.length === 0) {
    return { profile, portfolioId: null, assets: [], transactions: [] };
  }

  const portfolioId = portfolios[0].id;

  // Load assets and transactions in parallel
  const [assetsRes, txRes] = await Promise.all([
    supabase.from('assets').select('*').eq('portfolio_id', portfolioId),
    supabase.from('transactions').select('*').eq('portfolio_id', portfolioId).order('date'),
  ]);

  return {
    profile,
    portfolioId,
    assets: assetsRes.data || [],
    transactions: (txRes.data || []).map(dbTxToLocal),
  };
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export function upsertAsset(supabase, portfolioId, { ticker, name, color, hidden }) {
  const row = { portfolio_id: portfolioId, ticker, name, color };
  if (hidden != null) row.hidden = hidden;
  supabase
    .from('assets')
    .upsert(row, { onConflict: 'portfolio_id,ticker' })
    .then(({ error }) => { if (error) console.error('upsertAsset error:', error); });
}

// ─── Transactions ────────────────────────────────────────────────────────────

function localTxToDb(portfolioId, tx) {
  const row = {
    id: tx.id,
    portfolio_id: portfolioId,
    ticker: tx.ticker,
    type: tx.type,
    date: tx.date,
  };
  if (tx.shares != null) row.shares = tx.shares;
  if (tx.priceAtEntry != null) row.price_at_entry = tx.priceAtEntry;
  if (tx.amount != null) row.amount = tx.amount;
  if (tx.currency) row.currency = tx.currency;
  return row;
}

function dbTxToLocal(row) {
  const tx = {
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    date: row.date,
  };
  if (row.shares != null) tx.shares = Number(row.shares);
  if (row.price_at_entry != null) tx.priceAtEntry = Number(row.price_at_entry);
  if (row.amount != null) tx.amount = Number(row.amount);
  if (row.currency) tx.currency = row.currency;
  return tx;
}

export function insertTransaction(supabase, portfolioId, tx) {
  supabase
    .from('transactions')
    .insert(localTxToDb(portfolioId, tx))
    .then(({ error }) => { if (error) console.error('insertTransaction error:', error); });
}

export function updateTransaction(supabase, txId, fields) {
  const row = {};
  if (fields.date !== undefined) row.date = fields.date;
  if (fields.shares !== undefined) row.shares = fields.shares;
  if (fields.priceAtEntry !== undefined) row.price_at_entry = fields.priceAtEntry;
  if (fields.amount !== undefined) row.amount = fields.amount;
  if (fields.currency !== undefined) row.currency = fields.currency;
  if (fields.type !== undefined) row.type = fields.type;
  row.updated_at = new Date().toISOString();
  supabase
    .from('transactions')
    .update(row)
    .eq('id', txId)
    .then(({ error }) => { if (error) console.error('updateTransaction error:', error); });
}

export function deleteTransaction(supabase, txId) {
  supabase
    .from('transactions')
    .delete()
    .eq('id', txId)
    .then(({ error }) => { if (error) console.error('deleteTransaction error:', error); });
}

export function bulkInsertTransactions(supabase, portfolioId, txs) {
  const rows = txs.map((tx) => localTxToDb(portfolioId, tx));
  supabase
    .from('transactions')
    .insert(rows)
    .then(({ error }) => { if (error) console.error('bulkInsertTransactions error:', error); });
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export function updateProfile(supabase, userId, fields) {
  supabase
    .from('profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .then(({ error }) => { if (error) console.error('updateProfile error:', error); });
}
