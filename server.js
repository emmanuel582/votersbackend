"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = __importDefault(require("crypto"));
const supabase_js_1 = require("./lib/supabase.js");
const public_js_1 = __importDefault(require("./routes/public.js"));
const admin_js_1 = __importDefault(require("./routes/admin.js"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';
const allowedOrigins = [
    'http://localhost:5173',
    ...(process.env.FRONTEND_URL || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean),
];
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin))
            return callback(null, true);
        if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin))
            return callback(null, true);
        callback(null, false);
    },
    credentials: true,
}));
app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'votersbackend' });
});
// Webhook route MUST use express.raw to preserve exact payload bytes for HMAC verification
app.post('/webhook/paystack', express_1.default.raw({ type: 'application/json' }), async (req, res) => {
    const hash = crypto_1.default
        .createHmac('sha512', PAYSTACK_SECRET_KEY)
        .update(req.body)
        .digest('hex');
    if (hash !== req.headers['x-paystack-signature']) {
        return res.status(401).send('Invalid signature');
    }
    // Always respond 200 immediately to Paystack
    res.status(200).send('OK');
    try {
        const event = JSON.parse(req.body.toString());
        if (event.event === 'charge.success') {
            const { reference, amount, channel, id: transaction_id } = event.data;
            // Find the vote record
            const { data: vote } = await supabase_js_1.supabaseAdmin
                .from('votes')
                .select('*')
                .eq('reference', reference)
                .single();
            if (!vote) {
                // Mismatch: payment success but no vote record found
                await supabase_js_1.supabaseAdmin.from('votes').insert({
                    reference,
                    amount: 10000,
                    paystack_status: 'success',
                    vote_recorded: false,
                    mismatch: true,
                    mismatch_note: 'Vote record not found for this reference',
                    paystack_payload: event.data
                });
                return;
            }
            // Idempotency: if already recorded, do nothing
            if (vote.vote_recorded)
                return;
            if (amount === vote.amount) {
                // Perfect match
                await supabase_js_1.supabaseAdmin.from('votes').update({
                    paystack_status: 'success',
                    vote_recorded: true,
                    mismatch: false,
                    paystack_payload: event.data
                }).eq('reference', reference);
            }
            else {
                // Amount mismatch
                await supabase_js_1.supabaseAdmin.from('votes').update({
                    paystack_status: 'success',
                    vote_recorded: false, // DO NOT RECORD THE VOTE
                    mismatch: true,
                    mismatch_note: `Expected ₦${vote.amount / 100}, got ₦${amount / 100}`,
                    paystack_payload: event.data
                }).eq('reference', reference);
            }
        }
    }
    catch (error) {
        console.error('Webhook processing error:', error);
    }
});
// Admin routes may include base64 photo uploads (up to ~5MB)
app.use('/api/admin', express_1.default.json({ limit: '7mb' }));
app.use(express_1.default.json());
app.use('/api', public_js_1.default);
app.use('/api/admin', admin_js_1.default);
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
//# sourceMappingURL=server.js.map