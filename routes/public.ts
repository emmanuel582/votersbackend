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

router.get('/live-feed', async (req, res) => {
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();

    const { data: settings } = await supabaseAdmin
      .from('app_settings')
      .select('live_ticker_enabled, event_name, event_hashtag')
      .eq('id', 'singleton')
      .single();

    if (settings?.live_ticker_enabled === false) {
      return res.json({ enabled: false, stats: null, events: [], insights: [] });
    }

    const [{ data: allVotes }, { data: recentVotes }, { data: categories }] = await Promise.all([
      supabaseAdmin.from('votes').select('id, created_at, category_id').eq('vote_recorded', true),
      supabaseAdmin
        .from('votes')
        .select(`
          id, voter_name, created_at,
          nominees ( name, photo_url ),
          categories ( name, emoji )
        `)
        .eq('vote_recorded', true)
        .order('created_at', { ascending: false })
        .limit(25),
      supabaseAdmin.from('categories').select('id, name, emoji').eq('is_active', true),
    ]);

    const catMap = Object.fromEntries((categories || []).map((c) => [c.id, c]));
    const votes = allVotes || [];

    const votesLastHour = votes.filter((v) => new Date(v.created_at).getTime() > oneHourAgo);
    const votesToday = votes.filter((v) => new Date(v.created_at).getTime() > todayMs);

    const countByCategory = (list: typeof votes) => {
      const counts: Record<string, number> = {};
      list.forEach((v) => {
        if (v.category_id) counts[v.category_id] = (counts[v.category_id] || 0) + 1;
      });
      return counts;
    };

    const hourByCat = countByCategory(votesLastHour);
    const todayByCat = countByCategory(votesToday);

    const topCategoryId = (counts: Record<string, number>) =>
      Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    const [hotCatId, hotCatCount] = topCategoryId(hourByCat) || [];
    const [todayCatId, todayCatCount] = topCategoryId(todayByCat) || [];
    const hotCategory = hotCatId ? catMap[hotCatId] : null;
    const todayTopCategory = todayCatId ? catMap[todayCatId] : null;

    const firstName = (name: string | null) => {
      if (!name?.trim()) return 'Someone';
      return name.trim().split(/\s+/)[0];
    };

    const events = (recentVotes || []).map((v: any) => ({
      id: v.id,
      voterName: firstName(v.voter_name),
      nomineeName: v.nominees?.name || 'a nominee',
      nomineePhoto: v.nominees?.photo_url || null,
      categoryName: v.categories?.name || 'a category',
      categoryEmoji: v.categories?.emoji || null,
      createdAt: v.created_at,
    }));

    const insights: string[] = [];
    if (events.length > 0) {
      const latest = events[0]!;
      insights.push(`${latest.voterName} just voted for ${latest.nomineeName.split(' ')[0]} 👑`);
    }
    if (votesLastHour.length > 0) {
      insights.push(`${votesLastHour.length} vote${votesLastHour.length === 1 ? '' : 's'} in the last hour`);
    }
    if (hotCategory && hotCatCount) {
      insights.push(`${hotCategory.emoji || '🔥'} ${hotCategory.name} is on fire — ${hotCatCount} this hour`);
    }
    if (todayTopCategory && todayCatCount && todayTopCategory.id !== hotCategory?.id) {
      insights.push(`${todayTopCategory.emoji || '📈'} ${todayTopCategory.name} leads today with ${todayCatCount} votes`);
    }
    if (votes.length >= 5) {
      insights.push(`${votes.length} total votes cast`);
    }

    res.json({
      enabled: true,
      eventName: settings?.event_name || 'School Awards',
      hashtag: settings?.event_hashtag || '#SchoolAwards',
      stats: {
        votesLastHour: votesLastHour.length,
        votesToday: votesToday.length,
        totalVotes: votes.length,
      },
      events,
      insights: [...new Set(insights)].slice(0, 6),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live feed' });
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
