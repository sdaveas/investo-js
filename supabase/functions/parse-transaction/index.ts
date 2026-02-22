// AI-powered transaction parser for Investo
import "@supabase/functions-js/edge-runtime.d.ts"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

interface ParseRequest {
  prompt: string
  currentDate: string
  portfolio?: Record<string, { name: string; currentValue?: number }>
}

interface ParsedTransaction {
  type: 'buy' | 'sell'
  asset: string
  amount?: number
  date?: string
  fraction?: number
  sellAll?: boolean
  confidence: number
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prompt, currentDate, portfolio }: ParseRequest = await req.json()

    if (!prompt || !currentDate) {
      return new Response(
        JSON.stringify({ error: 'Missing prompt or currentDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build portfolio context
    const portfolioContext = portfolio
      ? `\n\nUser's current portfolio:\n${Object.entries(portfolio)
          .map(([ticker, info]) => `- ${ticker} (${info.name})${info.currentValue ? `: $${info.currentValue.toFixed(0)}` : ''}`)
          .join('\n')}`
      : ''

    const systemPrompt = `You are a financial transaction parser. Parse natural language into structured transaction data.

Current date: ${currentDate}${portfolioContext}

Rules:
- Extract transaction type (buy/sell)
- Identify the asset (company name or ticker)
- Extract amount in USD (if specified)
- Parse dates (absolute like "1/15/2025" or relative like "6 months ago", "yesterday", "last week")
- Handle fractions: "half" = 0.5, "quarter" = 0.25, "third" = 0.333, "all" = sellAll: true
- For sells with fractions/all, amount should be calculated from current holdings (if provided)
- Return confidence score (0-1) based on parsing certainty

Respond with ONLY valid JSON in this exact format:
{
  "type": "buy" | "sell",
  "asset": "company name or ticker",
  "amount": number or null,
  "date": "YYYY-MM-DD" or null,
  "fraction": number (0-1) or null,
  "sellAll": boolean,
  "confidence": number (0-1)
}`

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
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 200,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('OpenAI API error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to parse transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // OpenAI with json_object format returns clean JSON
    const parsed: ParsedTransaction = JSON.parse(content)

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
