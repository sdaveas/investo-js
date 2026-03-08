// AI-powered statement parser for Investo
// Extracts transactions from bank statements / brokerage exports / screenshots
import "@supabase/functions-js/edge-runtime.d.ts"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

interface ParseRequest {
  type: 'text' | 'image'
  content: string      // raw text OR base64-encoded image (no data: prefix)
  mimeType?: string    // e.g. 'image/jpeg', 'image/png'
  currentDate: string
}

interface ParsedRow {
  date: string
  ticker: string       // best-guess ticker or '_CASH'
  name: string
  type: 'buy' | 'sell' | 'deposit' | 'withdraw'
  amount: number       // shares for stocks, currency amount for cash
  isShares: boolean    // true = amount is share count, false = currency amount
  price?: number       // price per share if known
  currency?: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `You are a financial transaction extractor. Your job is to read bank statements, brokerage reports, or investment screenshots and extract every transaction into a structured JSON array.

Rules:
- For stock/ETF/fund transactions: set type to "buy" or "sell", set ticker to the best-guess ticker symbol (uppercase, e.g. "AAPL"), set isShares to true and amount to the number of shares. If shares are unknown but amount in currency is given, set isShares to false and amount to the currency value.
- For cash movements (bank transfers, deposits, withdrawals): set ticker to "_CASH", isShares to false, and amount to the currency value.
  - Incoming transfers / credits (e.g. ΕΙΣΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ, incoming wire, credit, received) → type "deposit"
  - Outgoing transfers / debits (e.g. ΕΞΕΡΧΟΜΕΝΟ ΕΜΒΑΣΜΑ, ΜΕΤΑΦΟΡΑ ΣΕ ΛΟΓ.ΤΡΙΤΟΥ, outgoing wire, debit, sent) → type "withdraw"
- dates must be in YYYY-MM-DD format. European short dates like "02/01/26" mean DD/MM/YY.
- European number format: 1.000,00 means one thousand (dot = thousands separator, comma = decimal).
- If a currency is mentioned (USD, EUR, GBP…) include it in the currency field.
- Include a price field (price per share) only if explicitly stated.
- Ignore fees, bank charges, card purchases, balance rows, duplicate rows, and non-transaction lines.
- If you cannot confidently identify a transaction, skip it.

Respond with ONLY valid JSON in this exact format:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "ticker": "AAPL",
      "name": "Apple Inc",
      "type": "buy",
      "amount": 10,
      "isShares": true,
      "price": 150.00,
      "currency": "USD"
    }
  ]
}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, content, mimeType, currentDate }: ParseRequest = await req.json()

    if (!content || !currentDate) {
      return new Response(
        JSON.stringify({ error: 'Missing content or currentDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userMessage =
      type === 'image'
        ? {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType || 'image/jpeg'};base64,${content}`,
                  detail: 'high',
                },
              },
              {
                type: 'text',
                text: `Today is ${currentDate}. Extract all transactions from this financial document.`,
              },
            ],
          }
        : {
            role: 'user',
            content: `Today is ${currentDate}.\n\n${content}`,
          }

    const model = type === 'image' ? 'gpt-4o' : 'gpt-4o-mini'

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          userMessage,
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to parse statement' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const content_str = data.choices[0]?.message?.content

    if (!content_str) {
      return new Response(
        JSON.stringify({ error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const parsed: { transactions: ParsedRow[] } = JSON.parse(content_str)

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
