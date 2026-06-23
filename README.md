# votersbackend

School Awards voting API — deploy on [Render](https://render.com).

## Setup

1. Create a Web Service on Render and connect this repo.
2. Set environment variables from `.env.example`.
3. Set `FRONTEND_URL` to your Vercel frontend URL (e.g. `https://votersfrontend.vercel.app`).
4. Deploy — Render uses `render.yaml` (`npm run build` then `npm start`).

## Paystack webhook

Point Paystack webhooks to: `https://YOUR-RENDER-URL.onrender.com/webhook/paystack`
