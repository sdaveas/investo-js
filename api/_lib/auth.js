import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Authenticate a request via API key.
 * Returns { userId, error, status }.
 */
export async function authenticate(req) {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return { userId: null, error: 'Missing Authorization header', status: 401 };
  }

  const raw = auth.slice(7);
  if (!raw.startsWith('inv_')) {
    return { userId: null, error: 'Invalid API key format', status: 401 };
  }

  const hash = hashKey(raw);
  const { data, error } = await supabase
    .from('api_keys')
    .select('user_id')
    .eq('key_hash', hash)
    .single();

  if (error || !data) {
    return { userId: null, error: 'Invalid API key', status: 401 };
  }

  // Fire-and-forget: update last_used_at
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', hash)
    .then(() => {});

  return { userId: data.user_id, error: null, status: 200 };
}

export { supabase };
