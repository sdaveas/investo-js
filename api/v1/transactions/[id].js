import { authenticate, supabase } from '../../_lib/auth.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, error, status } = await authenticate(req);
  if (!userId) return res.status(status).json({ error });

  const { id } = req.query;

  // Verify the transaction belongs to the user
  const { data: tx } = await supabase
    .from('transactions')
    .select('id, portfolio_id')
    .eq('id', id)
    .single();

  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('id', tx.portfolio_id)
    .eq('user_id', userId)
    .single();

  if (!portfolio) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  const { error: delError } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id);

  if (delError) {
    return res.status(500).json({ error: delError.message });
  }

  return res.status(204).end();
}
