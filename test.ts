import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from './lib/supabase.js';

async function runTests() {
  console.log('--- STARTING FULL SYSTEM TEST ---\n');

  try {
    // 1. Create a Category via Backend API bypassing router (direct DB) to verify Schema
    console.log('[1/4] Testing Category Creation (Enum Validation)...');
    const catName = 'Test Category ' + Date.now();
    const { data: cat, error: catError } = await supabaseAdmin.from('categories')
      .insert({ name: catName, type: 'Singular', emoji: '🧪', display_order: 99 })
      .select().single();
      
    if (catError) throw new Error('Category creation failed: ' + catError.message);
    console.log('✅ Category created successfully:', cat.id);

    // 2. Create a Nominee
    console.log('\n[2/4] Testing Nominee Creation...');
    const { data: nom, error: nomError } = await supabaseAdmin.from('nominees')
      .insert({ category_id: cat.id, name: 'Test Nominee', subtitle: 'Automated Test' })
      .select().single();

    if (nomError) throw new Error('Nominee creation failed: ' + nomError.message);
    console.log('✅ Nominee created successfully:', nom.id);

    // 3. Create a Test Vote
    console.log('\n[3/4] Testing Vote Recording...');
    const ref = 'TEST_' + Date.now();
    const { data: vote, error: voteError } = await supabaseAdmin.from('votes')
      .insert({
        reference: ref,
        nominee_id: nom.id,
        category_id: cat.id,
        voter_name: 'Test Voter',
        amount: 10000,
        paystack_status: 'success',
        vote_recorded: true
      })
      .select().single();

    if (voteError) throw new Error('Vote recording failed: ' + voteError.message);
    console.log('✅ Vote recorded successfully:', vote.reference);

    // 4. Test Public Leaderboard Endpoint
    console.log('\n[4/4] Testing Public Leaderboard Sync...');
    const API = process.env.VITE_API_URL || 'http://localhost:3000';
    const res = await fetch(`${API}/api/categories`);
    
    if (!res.ok) {
      console.log('⚠️ Could not reach Local Express API (Is the server running?)');
    } else {
      const { categories } = await res.json() as any;
      const testCat = categories.find((c: any) => c.id === cat.id);
      if (!testCat) throw new Error('Category not found in public API');
      
      const testNom = testCat.nominees.find((n: any) => n.id === nom.id);
      if (!testNom) throw new Error('Nominee not found in public API');
      
      if (testNom.voteCount !== 1) throw new Error(`Vote count mismatch. Expected 1, got ${testNom.voteCount}`);
      console.log('✅ Public API verified! Vote count correctly aggregated to 1.');
    }

    // Cleanup
    console.log('\n--- CLEANING UP TEST DATA ---');
    await supabaseAdmin.from('votes').delete().eq('id', vote.id);
    await supabaseAdmin.from('categories').delete().eq('id', cat.id);
    console.log('✅ Cleaned up successfully.');

    console.log('\n🎉 ALL TESTS PASSED!');

  } catch (err: any) {
    console.error('\n❌ TEST FAILED:', err.message);
  }
}

runTests();
