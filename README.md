# Investo

**[Live Demo →](https://investo-js.vercel.app/)** · [Buy me a coffee ☕](https://buymeacoffee.com/br3gan)

An investment portfolio simulator that uses real market data from Yahoo Finance. Build a virtual portfolio by recording buy/sell transactions and track performance over time.

> **Disclaimer:** Investo is a simulation tool only. No real money is involved — it does not execute any actual trades or connect to any brokerage. All transactions are virtual records used to simulate portfolio performance against real historical market data.

![Investo](investo.png)

## Features

- **Transaction Ledger** — Record buy and sell transactions for any asset available on Yahoo Finance
- **Real Market Data** — Historical prices fetched from Yahoo Finance API
- **Portfolio Chart** — Interactive time-series chart with per-asset and total portfolio lines, buy/sell markers, and click-to-toggle legend
- **AI Quick Add** — Natural language input powered by LLM to add transactions:
  - Simple: `"bought google 1/1/2025 $1000"`
  - Advanced: `"sold half of my apple 6 months ago"`, `"bought some tesla yesterday for 5k"`
  - Understands relative dates, fractions, and portfolio context
- **Performance Stats** — Total return, annualized return, and max drawdown per asset and combined
- **CSV Import/Export** — Bulk import transactions via CSV/TSV file or paste, export your portfolio
- **Cloud Sync** — Sign in with Google to sync your portfolio across devices (via Supabase)
- **Local Persistence** — Portfolio saved to localStorage for anonymous users

## Tech Stack

- React 19 + Vite
- Tailwind CSS 4
- Recharts
- Supabase (auth + storage)
- Lucide React icons

## Getting Started

```bash
npm install
npm run dev
```

### Environment Variables

For cloud sync, create a `.env` file:

```
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Cloud sync is optional — the app works fully offline with localStorage.

### AI Quick Add (Optional)

The AI-powered natural language parser requires deploying a Supabase Edge Function:

1. Get a free Google Gemini API key from [aistudio.google.com](https://aistudio.google.com/app/apikey)
2. Deploy the Edge Function:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=YOUR_KEY
npx supabase functions deploy parse-transaction
```

See [supabase/functions/README.md](supabase/functions/README.md) for detailed setup instructions.

**Without the Edge Function deployed**, the app falls back to a basic regex-based parser that works offline but with limited capabilities.

## Deployment

Deployed on [Vercel](https://vercel.com). The `vercel.json` config proxies Yahoo Finance API requests to avoid CORS issues in production.

## License

MIT
