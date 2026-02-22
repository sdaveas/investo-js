# Investo AI Edge Function

This directory contains the Supabase Edge Function that powers AI-based transaction parsing.

## Setup

### 1. Get a Google Gemini API Key

1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API key"
3. Copy the key

### 2. Configure Local Environment

```bash
# Create .env.local file
cp .env.local.example .env.local

# Edit .env.local and add your Gemini API key
# GEMINI_API_KEY=YOUR_KEY_HERE
```

### 3. Deploy the Function

```bash
# Login to Supabase
npx supabase login

# Link to your project
npx supabase link --project-ref ixgezwdscbkiiqzsrcyu

# Set the secret in production
npx supabase secrets set GEMINI_API_KEY=YOUR_KEY_HERE

# Deploy the function
npx supabase functions deploy parse-transaction
```

### 4. Test Locally (Optional)

```bash
# Start Supabase locally
npx supabase start

# Serve the function locally
npx supabase functions serve parse-transaction --env-file supabase/.env.local

# Test it
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/parse-transaction' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "sold half of my google 6 months ago",
    "currentDate": "2026-02-22",
    "portfolio": {
      "GOOGL": {
        "name": "Alphabet Inc",
        "currentValue": 5000
      }
    }
  }'
```

## Features

The AI parser can understand:

- **Natural language**: "sold half of my google 6 months ago"
- **Relative dates**: "yesterday", "last week", "6 months ago", "last quarter"
- **Fractions**: "half", "quarter", "third", "all"
- **Various phrasings**: "bought some Tesla", "offloaded my Apple", "dumped MSFT"
- **Portfolio context**: Knows your current holdings

## Cost

Using Google Gemini 2.0 Flash:
- **FREE** up to 1,500 requests per day
- After free tier: ~$0.000075 per transaction parse (half the cost of GPT-4o-mini)
- Well within Supabase's free tier Edge Function limits
- See pricing: https://ai.google.dev/pricing

## Why Gemini?

- **Free tier**: 1,500 requests/day for free
- **Fast**: Gemini 2.0 Flash is optimized for speed
- **Cost-effective**: Half the price of OpenAI after free tier
- **No credit card required**: Start using immediately

## Alternative: Use OpenAI or Anthropic

If you prefer OpenAI or Anthropic, modify `index.ts`:

**OpenAI:**
```typescript
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 200,
  }),
})
```
