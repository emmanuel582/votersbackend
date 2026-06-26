import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  const { count: total } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true });
  const { count: recorded } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('vote_recorded', true);
  const { count: success } = await supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('paystack_status', 'success');
  console.log(`TOTAL ROWS IN DB: ${total}`);
  console.log(`RECORDED IN DB: ${recorded}`);
  console.log(`SUCCESS IN DB: ${success}`);
}

check().catch(console.error);
