/**
 * Database helpers for the normalized Supabase schema.
 * All write operations are fire-and-forget (optimistic UI).
 */

// ─── Bootstrap ───────────────────────────────────────────────────────────────

/**
 * Ensure a profile and default portfolio exist for the user.
 * Returns { profile, portfolios } where portfolios is the full list.
 */
export async function ensureProfile(supabase, userId) {
  // Upsert profile
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .upsert({ id: userId }, { onConflict: 'id' })
    .select()
    .single();
  if (pErr) throw pErr;

  // Get all portfolios for user
  let { data: portfolios } = await supabase
    .from('portfolios')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .order('created_at');

  if (!portfolios || portfolios.length === 0) {
    const { error: nErr } = await supabase
      .from('portfolios')
      .insert({ user_id: userId, name: 'Default' });
    if (nErr && nErr.code !== '23505') throw nErr;
    // Re-fetch to get the winning row in case of a race
    const { data: refetch } = await supabase
      .from('portfolios')
      .select('id, name, created_at')
      .eq('user_id', userId)
      .order('created_at');
    portfolios = refetch;
  }

  return { profile, portfolios };
}

/**
 * Load assets + transactions for a specific portfolio.
 */
export async function loadPortfolioData(supabase, portfolioId) {
  const [assetsRes, txRes] = await Promise.all([
    supabase.from('assets').select('*').eq('portfolio_id', portfolioId),
    supabase.from('transactions').select('*').eq('portfolio_id', portfolioId).order('date'),
  ]);

  return {
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

export function deleteAsset(supabase, portfolioId, ticker) {
  supabase
    .from('assets')
    .delete()
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .then(({ error }) => { if (error) console.error('deleteAsset error:', error); });
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
  if (row.portfolio_id) tx.portfolioId = row.portfolio_id;
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

export function moveTransaction(supabase, txId, newPortfolioId) {
  supabase
    .from('transactions')
    .update({ portfolio_id: newPortfolioId, updated_at: new Date().toISOString() })
    .eq('id', txId)
    .then(({ error }) => { if (error) console.error('moveTransaction error:', error); });
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

// ─── Portfolios ──────────────────────────────────────────────────────────────

export async function createPortfolio(supabase, userId, name) {
  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, name })
    .select('id, name, created_at')
    .single();
  if (error) throw error;
  return data;
}

export function renamePortfolio(supabase, portfolioId, name) {
  supabase
    .from('portfolios')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', portfolioId)
    .then(({ error }) => { if (error) console.error('renamePortfolio error:', error); });
}

export async function deletePortfolio(supabase, portfolioId) {
  const { error } = await supabase
    .from('portfolios')
    .delete()
    .eq('id', portfolioId);
  if (error) throw error;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export function updateProfile(supabase, userId, fields) {
  supabase
    .from('profiles')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .then(({ error }) => { if (error) console.error('updateProfile error:', error); });
}
