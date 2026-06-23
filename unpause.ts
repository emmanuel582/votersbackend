import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { error } = await supabase.from('app_settings').update({ voting_status: 'OPEN' }).eq('id', 'singleton');
  if (error) {
    console.error('Error unpausing:', error);
  } else {
    console.log('Unpaused voting successfully!');
  }
}

main();
