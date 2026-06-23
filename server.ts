import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { supabaseAdmin } from './lib/supabase.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_placeholder';

const allowedOrigins = [
  'http://localhost:5173',
  ...(process.env.FRONTEND_URL || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'votersbackend' });
});

// Webhook route MUST use express.raw to preserve exact payload bytes for HMAC verification
app.post('/webhook/paystack', express.raw({ type: 'application/json' }), async (req: any, res: any) => {
  const hash = crypto
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
      const { data: vote } = await supabaseAdmin
        .from('votes')
        .select('*')
        .eq('reference', reference)
        .single();

      if (!vote) {
        // Mismatch: payment success but no vote record found
        await supabaseAdmin.from('votes').insert({
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
      if (vote.vote_recorded) return;

      if (amount === vote.amount) {
        // Perfect match
        await supabaseAdmin.from('votes').update({
          paystack_status: 'success',
          vote_recorded: true,
          mismatch: false,
          paystack_payload: event.data
        }).eq('reference', reference);
      } else {
        // Amount mismatch
        await supabaseAdmin.from('votes').update({
          paystack_status: 'success',
          vote_recorded: false, // DO NOT RECORD THE VOTE
          mismatch: true,
          mismatch_note: `Expected ₦${vote.amount / 100}, got ₦${amount / 100}`,
          paystack_payload: event.data
        }).eq('reference', reference);
      }
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
});

// Admin routes may include base64 photo uploads (up to ~5MB)
app.use('/api/admin', express.json({ limit: '7mb' }));
app.use(express.json());

app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
