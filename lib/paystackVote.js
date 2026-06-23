"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paystackRequest = void 0;
exports.reconcileVoteWithPaystack = reconcileVoteWithPaystack;
exports.syncPendingVotes = syncPendingVotes;
const https_1 = __importDefault(require("https"));
const supabase_js_1 = require("./supabase.js");
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';
const paystackRequest = (method, path, data) => {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path,
            method,
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
        };
        const req = https_1.default.request(options, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    resolve(body);
                }
            });
        });
        req.on('error', error => reject(error));
        if (data)
            req.write(JSON.stringify(data));
        req.end();
    });
};
exports.paystackRequest = paystackRequest;
/** Reconcile a vote with Paystack and update the database. Returns updated vote or null. */
async function reconcileVoteWithPaystack(reference) {
    const { data: vote } = await supabase_js_1.supabaseAdmin
        .from('votes')
        .select('*')
        .eq('reference', reference)
        .single();
    if (!vote)
        return null;
    if (vote.vote_recorded || vote.mismatch)
        return vote;
    const paystackRes = await (0, exports.paystackRequest)('GET', `/transaction/verify/${reference}`);
    if (!paystackRes.status || !paystackRes.data)
        return vote;
    const { status, amount } = paystackRes.data;
    let isMismatch = false;
    let isRecorded = false;
    let finalStatus = status;
    let mismatchNote = null;
    if (status === 'success') {
        if (amount === vote.amount) {
            isRecorded = true;
        }
        else {
            isMismatch = true;
            mismatchNote = `Amount mismatch: Expected ${vote.amount}, got ${amount}`;
        }
    }
    else if (status === 'failed' || status === 'abandoned') {
        finalStatus = 'failed';
    }
    const { data: updatedVote } = await supabase_js_1.supabaseAdmin
        .from('votes')
        .update({
        paystack_status: finalStatus,
        vote_recorded: isRecorded,
        mismatch: isMismatch,
        mismatch_note: mismatchNote,
        paystack_payload: paystackRes.data,
    })
        .eq('reference', reference)
        .select()
        .single();
    return updatedVote || vote;
}
async function syncPendingVotes(limit = 30) {
    const { data: pending } = await supabase_js_1.supabaseAdmin
        .from('votes')
        .select('reference')
        .in('paystack_status', ['pending', 'abandoned'])
        .eq('vote_recorded', false)
        .order('created_at', { ascending: false })
        .limit(limit);
    let updated = 0;
    for (const row of pending || []) {
        const result = await reconcileVoteWithPaystack(row.reference);
        if (result && (result.vote_recorded || result.paystack_status !== 'pending')) {
            updated++;
        }
    }
    return { checked: pending?.length || 0, updated };
}
//# sourceMappingURL=paystackVote.js.map