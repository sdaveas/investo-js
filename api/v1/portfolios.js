import { authenticate, supabase } from '../_lib/auth.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, error, status } = await authenticate(req);
  if (!userId) return res.status(status).json({ error });

  const { data, error: dbError } = await supabase
    .from('portfolios')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .order('created_at');

  if (dbError) {
    return res.status(500).json({ error: dbError.message });
  }

  return res.status(200).json(data);
}
