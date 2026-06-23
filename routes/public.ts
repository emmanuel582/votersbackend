import express from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { nanoid } from 'nanoid';
import { paystackRequest, reconcileVoteWithPaystack } from '../lib/paystackVote.js';

const router = express.Router();

// 0. Public: Categories & Settings
router.get('/categories', async (req, res) => {
  try {
    const { data: settings } = await supabaseAdmin
      .from('app_settings')
      .select('voting_status, voting_end_time, event_name')
      .eq('id', 'singleton')
      .single();

    const { data: categories } = await supabaseAdmin
      .from('categories')
      .select(`
        id, name, type, emoji, display_order, is_active,
        nominees ( id, name, photo_url, subtitle )
      `)
      .eq('is_active', true)
      .order('display_order');

    if (!categories) return res.json({ settings, categories: [] });

    // Get vote counts
    const { data: allVotes } = await supabaseAdmin
      .from('votes')
      .select('nominee_id')
      .eq('vote_recorded', true);

    const voteCounts: Record<string, number> = {};
    allVotes?.forEach(v => {
      voteCounts[v.nominee_id] = (voteCounts[v.nominee_id] || 0) + 1;
    });

    const formatted = categories.map((cat: any) => {
      const nominees = (cat.nominees || []).map((n: any) => ({
        ...n,
        voteCount: voteCounts[n.id] || 0
      })).sort((a: any, b: any) => b.voteCount - a.voteCount);

      return {
        ...cat,
        nominees,
        nomineeCount: nominees.length,
        leadingNominee: nominees[0] || null
      };
    });

    res.json({ settings, categories: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.get('/categories/:id', async (req, res) => {
  try {
    const { data: category } = await supabaseAdmin
      .from('categories')
      .select(`
        id, name, type, emoji,
        nominees ( id, name, photo_url, subtitle )
      `)
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single();

    if (!category) return res.status(404).json({ error: 'Category not found' });
    res.json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// 1. Initialize Vote
router.post('/vote/initialize', async (req, res) => {
  try {
    const { nomineeId, categoryId, voterEmail, voterName } = req.body;

    if (!nomineeId || !categoryId || !voterEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if voting is open
    const { data: settings } = await supabaseAdmin
      .from('app_settings')
      .select('voting_status, vote_price_kobo')
      .eq('id', 'singleton')
      .single();

    if (settings?.voting_status !== 'OPEN') {
      return res.status(403).json({ error: 'Voting is currently closed or paused.' });
    }

    // Verify category and nominee
    const { data: nominee } = await supabaseAdmin
      .from('nominees')
      .select('id, name, categories!inner(id, name, is_active)')
      .eq('id', nomineeId)
      .eq('categories.id', categoryId)
      .single();

    const catData: any = Array.isArray(nominee?.categories) ? nominee.categories[0] : nominee?.categories;

    if (!nominee || !catData?.is_active) {
      return res.status(400).json({ error: 'Invalid or inactive nominee/category' });
    }

    const reference = `vote_${categoryId}_${nomineeId}_${Date.now()}_${nanoid(6)}`;
    const amount = settings?.vote_price_kobo || 10000;

    // Create pending vote record
    const { error: insertError } = await supabaseAdmin
      .from('votes')
      .insert({
        reference,
        nominee_id: nomineeId,
        category_id: categoryId,
        voter_email: voterEmail,
        voter_name: voterName,
        amount,
        paystack_status: 'pending',
        vote_recorded: false
      });

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: 'Failed to record pending vote' });
    }

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/confirmation?reference=${reference}`;

    const paystackRes = await paystackRequest('POST', '/transaction/initialize', {
      email: voterEmail,
      amount,
      reference,
      callback_url: callbackUrl,
      metadata: {
        categoryId,
        categoryName: catData?.name,
        nomineeId,
        nomineeName: nominee.name
      }
    });

    if (paystackRes.status) {
      res.json(paystackRes);
    } else {
      res.status(400).json({ error: paystackRes.message });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error initializing vote' });
  }
});

// 2. Verify Vote (Fallback if webhook delayed)
router.get('/vote/verify/:reference', async (req, res) => {
  try {
    const reference = req.params.reference;
    const { data: vote } = await supabaseAdmin
      .from('votes')
      .select('*')
      .eq('reference', reference)
      .single();

    if (!vote) {
      return res.status(404).json({ error: 'Vote not found' });
    }

    const updated = await reconcileVoteWithPaystack(reference);
    res.json({ success: true, data: updated || vote });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error verifying vote' });
  }
});

// 3. Leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { data: settings } = await supabaseAdmin
      .from('app_settings')
      .select('leaderboard_mode, results_revealed')
      .eq('id', 'singleton')
      .single();

    // Fetch categories and nominees
    const { data: categories } = await supabaseAdmin
      .from('categories')
      .select(`
        id, name, type, emoji, display_order,
        nominees (
          id, name, photo_url, subtitle,
          votes ( id )
        )
      `)
      .eq('is_active', true)
      .order('display_order');

    if (!categories) return res.json([]);

    const formattedCategories = categories.map((cat: any) => {
      let nomineesList = cat.nominees?.map((n: any) => {
        return {
          id: n.id,
          name: n.name,
          photo_url: n.photo_url,
          subtitle: n.subtitle,
          vote_count: n.votes?.length || 0
        };
      }) || [];
      return { ...cat, nominees: nomineesList };
    });

    const { data: allVotes } = await supabaseAdmin
      .from('votes')
      .select('nominee_id')
      .eq('vote_recorded', true);

    const voteCounts: Record<string, number> = {};
    allVotes?.forEach(v => {
      voteCounts[v.nominee_id] = (voteCounts[v.nominee_id] || 0) + 1;
    });

    const finalData = categories.map((cat: any) => {
      let nList = cat.nominees?.map((n: any) => ({
        id: n.id,
        name: n.name,
        photoUrl: n.photo_url,
        subtitle: n.subtitle,
        voteCount: voteCounts[n.id] || 0
      })).sort((a: any, b: any) => b.voteCount - a.voteCount) || [];

      // Apply mode
      if (settings?.leaderboard_mode === 'Hidden') {
        nList = nList.map((n: any) => ({ ...n, voteCount: null }));
      } else if (settings?.leaderboard_mode === 'Rank') {
        nList = nList.map((n: any) => ({ ...n, voteCount: null }));
      }

      return {
        id: cat.id,
        name: cat.name,
        type: cat.type,
        emoji: cat.emoji,
        nominees: nList
      };
    });

    res.json(finalData);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching leaderboard' });
  }
});

export default router;
