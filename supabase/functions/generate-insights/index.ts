import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PortfolioAsset {
  name: string;
  ticker: string;
  currentValue: number;
  totalReturn: number;
  totalReturnPct: number;
  annualizedReturn: number;
  maxDrawdown: number;
}

interface RequestBody {
  summary: PortfolioAsset[];
  totalValue: number;
  totalInvested: number;
  totalWithdrawals: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { summary, totalValue, totalInvested, totalWithdrawals }: RequestBody = await req.json();
    
    if (!summary || summary.length === 0) {
      throw new Error('No portfolio data provided');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Build the prompt for insights
    const assetsText = summary
      .map(s => {
        const gainLoss = s.totalReturn;
        const gainLossText = gainLoss >= 0 ? `+$${gainLoss.toFixed(0)}` : `-$${Math.abs(gainLoss).toFixed(0)}`;
        return `- ${s.name} (${s.ticker}): ${gainLossText} gain/loss (${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(1)}%), Current Value $${s.currentValue.toFixed(0)}`;
      })
      .join('\n');

    const overallGainLoss = totalValue + totalWithdrawals - totalInvested;
    const overallGainLossText = overallGainLoss >= 0 ? `+$${overallGainLoss.toFixed(0)}` : `-$${Math.abs(overallGainLoss).toFixed(0)}`;

    const prompt = `You are a financial advisor analyzing an investment portfolio. Provide insights formatted EXACTLY as follows:

Overview:
[One sentence about overall portfolio performance using actual dollar amounts]

[For each asset, use the format below - list them in order of dollar performance (highest $ gain first)]
${summary.map(s => `${s.name}:`).join('\n')}
[One concise sentence about this asset's performance, focusing on actual dollar gains/losses. If an asset made significant dollar gains, it performed well regardless of percentage.]

IMPORTANT: Judge performance by DOLLAR AMOUNTS gained or lost, not percentages. An asset that gained $10,000 performed much better than one that gained $3,000, regardless of percentages.

Portfolio Data:
- Current Total Value: $${totalValue.toFixed(0)}
- Total Invested: $${totalInvested.toFixed(0)}
- Total Withdrawals: $${totalWithdrawals.toFixed(0)}
- Overall Profit: ${overallGainLossText} (${(overallGainLoss / totalInvested * 100).toFixed(1)}%)

Individual Assets:
${assetsText}`;

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a concise financial advisor. Provide brief, actionable portfolio insights in 2-3 sentences.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();
    const insights = data.choices?.[0]?.message?.content?.trim();

    if (!insights) {
      throw new Error('No insights generated');
    }

    return new Response(
      JSON.stringify({ insights }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error generating insights:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Failed to generate insights',
        insights: 'Unable to generate insights at this time. Please try again later.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
