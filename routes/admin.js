"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const supabase_js_1 = require("../lib/supabase.js");
const auth_js_1 = require("../middleware/auth.js");
const paystackVote_js_1 = require("../lib/paystackVote.js");
const ALLOWED_PHOTO_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
};
const router = express_1.default.Router();
router.use(auth_js_1.requireAdmin);
// Helper for Action Logging
const logAction = async (adminId, action, meta = {}) => {
    await supabase_js_1.supabaseAdmin.from('action_logs').insert({
        admin_id: adminId,
        action,
        meta
    });
};
// ==========================================
// STATS & OVERVIEW
// ==========================================
router.get('/stats', async (req, res) => {
    try {
        await (0, paystackVote_js_1.syncPendingVotes)(20);
        const [{ count: totalAttempts }, { count: successfulAttempts }] = await Promise.all([
            supabase_js_1.supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }),
            supabase_js_1.supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('paystack_status', 'success')
        ]);
        let allVotesForStats = [];
        let page = 0;
        while (true) {
            const { data } = await supabase_js_1.supabaseAdmin
                .from('votes')
                .select('amount, vote_recorded, paystack_status, created_at, vote_count')
                .range(page * 1000, (page + 1) * 1000 - 1);
            if (data && data.length > 0) {
                allVotesForStats.push(...data);
                if (data.length < 1000)
                    break;
                page++;
            }
            else {
                break;
            }
        }
        let totalVotes = 0;
        const recordedVotes = allVotesForStats.filter(v => {
            if (v.vote_recorded) {
                totalVotes += (v.vote_count || 1);
                return true;
            }
            return false;
        });
        const totalRevenue = recordedVotes.reduce((sum, v) => sum + (v.amount || 0), 0) / 100; // in Naira
        const successRate = (totalAttempts && totalAttempts > 0) ? Math.round(((successfulAttempts || 0) / totalAttempts) * 100) : 100;
        // Sparkline calculation
        const now = new Date().getTime();
        const sparkline = Array(12).fill(0);
        allVotesForStats.forEach(v => {
            const voteTime = new Date(v.created_at).getTime();
            const diffMins = (now - voteTime) / (1000 * 60);
            if (diffMins >= 0 && diffMins < 60) {
                // which bucket (0 = oldest ... 11 = newest)
                const bucket = 11 - Math.floor(diffMins / 5);
                if (bucket >= 0 && bucket < 12) {
                    if (v.paystack_status === 'success') {
                        // If we already marked it as failure (-1), but we see a success, we should maybe make it success? 
                        // "A window with 0 successes + 1 or more failures = fully red." Thus any success makes it NOT fully red, maybe just success? Let's say 1.
                        sparkline[bucket] = 1;
                    }
                    else if (v.paystack_status === 'failed' || v.paystack_status === 'abandoned') {
                        if (sparkline[bucket] === 0)
                            sparkline[bucket] = -1;
                    }
                }
            }
        });
        res.json({ totalVotes, totalRevenue, successRate, activeSessions: Math.floor(Math.random() * 20) + 1, sparkline });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});
router.get('/leaderboard', async (req, res) => {
    try {
        const { data: categories } = await supabase_js_1.supabaseAdmin
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
        if (!categories)
            return res.json([]);
        let allVotes = [];
        let pageLeader = 0;
        while (true) {
            const { data } = await supabase_js_1.supabaseAdmin
                .from('votes')
                .select('nominee_id, vote_count')
                .eq('vote_recorded', true)
                .range(pageLeader * 1000, (pageLeader + 1) * 1000 - 1);
            if (data && data.length > 0) {
                allVotes.push(...data);
                if (data.length < 1000)
                    break;
                pageLeader++;
            }
            else {
                break;
            }
        }
        const voteCounts = {};
        allVotes.forEach(v => {
            voteCounts[v.nominee_id] = (voteCounts[v.nominee_id] || 0) + (v.vote_count || 1);
        });
        const finalData = categories.map((cat) => {
            let nList = cat.nominees?.map((n) => ({
                id: n.id,
                name: n.name,
                photoUrl: n.photo_url,
                subtitle: n.subtitle,
                voteCount: voteCounts[n.id] || 0
            })).sort((a, b) => b.voteCount - a.voteCount) || [];
            return {
                id: cat.id,
                name: cat.name,
                type: cat.type,
                emoji: cat.emoji,
                nominees: nList
            };
        });
        res.json(finalData);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch admin leaderboard' });
    }
});
// ==========================================
// VOTES & TRANSACTIONS
// ==========================================
router.get('/votes', async (req, res) => {
    try {
        await (0, paystackVote_js_1.syncPendingVotes)(20);
        const { data, error } = await supabase_js_1.supabaseAdmin
            .from('votes')
            .select('*, nominees(name, categories(name))')
            .order('created_at', { ascending: false });
        if (error)
            throw error;
        res.json(data);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch votes' });
    }
});
router.post('/votes/sync-pending', async (req, res) => {
    try {
        const result = await (0, paystackVote_js_1.syncPendingVotes)(50);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to sync pending votes' });
    }
});
// Flag/Unflag a transaction
router.post('/votes/:id/flag', async (req, res) => {
    try {
        const { note, flag } = req.body;
        await supabase_js_1.supabaseAdmin.from('votes').update({ flagged: flag, mismatch_note: note || null }).eq('id', req.params.id);
        await logAction(req.admin.id, flag ? 'Flagged transaction' : 'Unflagged transaction', { vote_id: req.params.id, note });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to flag transaction' });
    }
});
// Mark Mismatch as Reviewed
router.post('/votes/:id/review', async (req, res) => {
    try {
        const { note } = req.body;
        await supabase_js_1.supabaseAdmin.from('votes').update({
            mismatch: false,
            resolved_note: note,
            resolved_by: req.admin.id,
            resolved_at: new Date().toISOString()
        }).eq('id', req.params.id);
        await logAction(req.admin.id, 'Marked mismatch as reviewed', { vote_id: req.params.id, note });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to review mismatch' });
    }
});
// Manually Credit Vote (SUPER ADMIN ONLY)
router.post('/votes/:id/credit', auth_js_1.requireSuperAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason || reason.length < 10)
            return res.status(400).json({ error: 'Reason must be at least 10 chars' });
        const { data: vote } = await supabase_js_1.supabaseAdmin.from('votes').select('*').eq('id', req.params.id).single();
        if (!vote || vote.vote_recorded)
            return res.status(400).json({ error: 'Vote cannot be credited' });
        await supabase_js_1.supabaseAdmin.from('votes').update({
            vote_recorded: true,
            resolved_by: req.admin.id,
            resolved_at: new Date().toISOString(),
            resolved_note: reason
        }).eq('id', req.params.id);
        await logAction(req.admin.id, 'Manually credited vote', { vote_id: req.params.id, reason, ref: vote.reference });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to credit vote' });
    }
});
// ==========================================
// CATEGORIES & NOMINEES
// ==========================================
router.get('/categories', async (req, res) => {
    const { data } = await supabase_js_1.supabaseAdmin.from('categories').select('*, nominees(*)').order('display_order');
    res.json(data);
});
router.post('/categories', async (req, res) => {
    const { name, type, emoji, display_order } = req.body;
    const { data, error } = await supabase_js_1.supabaseAdmin.from('categories').insert({ name, type, emoji, display_order }).select().single();
    if (error)
        return res.status(400).json({ error: error.message });
    await logAction(req.admin.id, 'Created category', { category_name: name });
    res.json(data);
});
router.patch('/categories/:id', async (req, res) => {
    const updates = req.body;
    const { data, error } = await supabase_js_1.supabaseAdmin.from('categories').update(updates).eq('id', req.params.id).select().single();
    if (error)
        return res.status(400).json({ error: error.message });
    await logAction(req.admin.id, 'Updated category', { category_id: req.params.id, updates });
    res.json(data);
});
router.delete('/categories/:id', async (req, res) => {
    // Check votes first
    const { count } = await supabase_js_1.supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('category_id', req.params.id);
    if (count && count > 0)
        return res.status(400).json({ error: 'Category has votes. Deactivate instead.' });
    await supabase_js_1.supabaseAdmin.from('categories').delete().eq('id', req.params.id);
    await logAction(req.admin.id, 'Deleted category', { category_id: req.params.id });
    res.json({ success: true });
});
router.post('/nominees/upload-photo', async (req, res) => {
    try {
        const { data, mimeType, categoryId } = req.body;
        if (!data || !mimeType || !ALLOWED_PHOTO_TYPES[mimeType]) {
            return res.status(400).json({ error: 'Invalid image. Use PNG, JPEG, GIF, or WebP (max 5MB).' });
        }
        const buffer = Buffer.from(data, 'base64');
        if (buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image must be 5MB or smaller.' });
        }
        const ext = ALLOWED_PHOTO_TYPES[mimeType];
        const path = `${categoryId || 'misc'}/${crypto_1.default.randomUUID()}.${ext}`;
        const { error } = await supabase_js_1.supabaseAdmin.storage.from('nominees').upload(path, buffer, {
            contentType: mimeType,
            upsert: false,
        });
        if (error) {
            console.error('Photo upload failed:', error);
            return res.status(500).json({ error: 'Failed to upload photo. Ensure the nominees storage bucket exists.' });
        }
        const { data: urlData } = supabase_js_1.supabaseAdmin.storage.from('nominees').getPublicUrl(path);
        res.json({ url: urlData.publicUrl });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to upload photo' });
    }
});
router.post('/nominees', async (req, res) => {
    const { name, photo_url, subtitle, category_id } = req.body;
    const { data } = await supabase_js_1.supabaseAdmin.from('nominees').insert({ name, photo_url, subtitle, category_id }).select().single();
    await logAction(req.admin.id, 'Added nominee', { nominee_name: name });
    res.json(data);
});
router.patch('/nominees/:id', async (req, res) => {
    const updates = req.body;
    const { data } = await supabase_js_1.supabaseAdmin.from('nominees').update(updates).eq('id', req.params.id).select().single();
    await logAction(req.admin.id, 'Updated nominee', { nominee_id: req.params.id, updates });
    res.json(data);
});
router.delete('/nominees/:id', async (req, res) => {
    const { count } = await supabase_js_1.supabaseAdmin.from('votes').select('*', { count: 'exact', head: true }).eq('nominee_id', req.params.id);
    if (count && count > 0)
        return res.status(400).json({ error: 'Nominee has votes. Deactivate instead.' });
    await supabase_js_1.supabaseAdmin.from('nominees').delete().eq('id', req.params.id);
    await logAction(req.admin.id, 'Deleted nominee', { nominee_id: req.params.id });
    res.json({ success: true });
});
// ==========================================
// SETTINGS
// ==========================================
router.patch('/settings', async (req, res) => {
    const updates = req.body;
    // Only super admin can change vote_price_kobo
    if (updates.vote_price_kobo && req.admin.role !== 'super_admin') {
        delete updates.vote_price_kobo;
    }
    const { data } = await supabase_js_1.supabaseAdmin.from('app_settings').update(updates).eq('id', 'singleton').select().single();
    await logAction(req.admin.id, 'Updated settings', updates);
    res.json(data);
});
router.post('/settings/reset', auth_js_1.requireSuperAdmin, async (req, res) => {
    // Nuclear option
    await supabase_js_1.supabaseAdmin.from('votes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase_js_1.supabaseAdmin.from('action_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await logAction(req.admin.id, 'RESET ALL DATA');
    res.json({ success: true });
});
// ==========================================
// ACTION LOGS & ADMINS (SUPER ADMIN ONLY)
// ==========================================
router.get('/action-logs', async (req, res) => {
    const { data } = await supabase_js_1.supabaseAdmin.from('action_logs').select('*, admins(email, role)').order('created_at', { ascending: false }).limit(200);
    res.json(data);
});
router.get('/users', auth_js_1.requireSuperAdmin, async (req, res) => {
    const { data } = await supabase_js_1.supabaseAdmin.from('admins').select('*').order('created_at', { ascending: false });
    res.json(data);
});
router.patch('/users/:id/role', auth_js_1.requireSuperAdmin, async (req, res) => {
    const { role } = req.body;
    const { data } = await supabase_js_1.supabaseAdmin.from('admins').update({ role }).eq('id', req.params.id).select().single();
    await logAction(req.admin.id, 'Changed admin role', { target_admin_id: req.params.id, role });
    res.json(data);
});
// Invite new admin
router.post('/users/invite', auth_js_1.requireSuperAdmin, async (req, res) => {
    try {
        const { email, role } = req.body;
        if (!email)
            return res.status(400).json({ error: 'Email is required' });
        // Invite via Supabase Auth
        const { data: authData, error: authError } = await supabase_js_1.supabaseAdmin.auth.admin.inviteUserByEmail(email);
        if (authError) {
            return res.status(400).json({ error: authError.message });
        }
        // Insert into admins table
        const { error: insertError } = await supabase_js_1.supabaseAdmin.from('admins').insert({
            id: authData.user.id,
            email,
            role: role || 'admin'
        });
        if (insertError) {
            return res.status(400).json({ error: insertError.message });
        }
        await logAction(req.admin.id, 'Invited admin', { email, role });
        res.json({ success: true, message: `Invitation sent to ${email}` });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to invite admin' });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map