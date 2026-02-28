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
  netWorth: number;
  stockValue: number;
  stockInvested: number;
  stockSold: number;
  stockReturn: number;
  bankBalance: number;
  bankDeposited: number;
  bankWithdrawn: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { summary, netWorth, stockValue, stockInvested, stockSold, stockReturn, bankBalance, bankDeposited, bankWithdrawn }: RequestBody = await req.json();
    
    if (!summary) {
      throw new Error('No portfolio data provided');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Build the prompt for insights
    const hasStocks = summary.length > 0;
    const hasBank = bankBalance > 0 || bankDeposited > 0;
    const cashPct = netWorth > 0 ? (bankBalance / netWorth * 100) : 0;
    const stockPct = netWorth > 0 ? (stockValue / netWorth * 100) : 0;
    const stockReturnPct = stockInvested > 0 ? (stockReturn / stockInvested * 100) : 0;

    const assetsText = summary
      .map(s => {
        const gainLoss = s.totalReturn;
        const gainLossText = gainLoss >= 0 ? `+$${gainLoss.toFixed(0)}` : `-$${Math.abs(gainLoss).toFixed(0)}`;
        return `- ${s.name} (${s.ticker}): ${gainLossText} gain/loss (${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(1)}%), Current Value $${s.currentValue.toFixed(0)}`;
      })
      .join('\n');

    const assetHeaders = summary.map(s => `${s.name}:\n[One concise sentence about this stock's performance]`).join('\n');

    const prompt = `You are a financial advisor analyzing a personal investment portfolio. Provide insights formatted EXACTLY as follows:

Overview:
[One sentence about overall financial position. Focus on NET WORTH ($${netWorth.toFixed(0)}), asset allocation (${cashPct.toFixed(0)}% cash, ${stockPct.toFixed(0)}% stocks), and financial health. A large cash position is a STRENGTH providing stability and optionality.]
${hasBank ? `\nBank Account:\nCurrent Balance $${bankBalance.toFixed(0)}; ${bankBalance > stockValue ? 'the largest portion of net worth, providing strong financial stability and dry powder for future opportunities' : 'providing a cash buffer alongside investments'}.` : ''}
${hasStocks ? `\n${assetHeaders}` : ''}

IMPORTANT GUIDELINES:
- Assess OVERALL FINANCIAL HEALTH, not just stock performance. A portfolio with substantial cash is financially strong even if stocks are down.
- Cash/bank balance is a STRENGTH — it provides stability, reduces risk, and offers optionality to buy during dips.
- If stocks are down but the overall net worth is high due to cash reserves, the portfolio is in a GOOD position.
- Judge stock performance by DOLLAR AMOUNTS, not percentages.
- Be balanced and constructive. Do NOT catastrophize stock losses if they are a small portion of net worth.

Portfolio Data:
- Net Worth: $${netWorth.toFixed(0)}
- Cash/Bank Balance: $${bankBalance.toFixed(0)} (${cashPct.toFixed(0)}% of net worth)${bankWithdrawn > 0 ? `\n- Total Deposited: $${bankDeposited.toFixed(0)}, Withdrawn: $${bankWithdrawn.toFixed(0)}` : ''}
${hasStocks ? `- Stocks Current Value: $${stockValue.toFixed(0)} (${stockPct.toFixed(0)}% of net worth)
- Total Invested in Stocks: $${stockInvested.toFixed(0)}${stockSold > 0 ? `, Sold: $${stockSold.toFixed(0)}` : ''}
- Stock Return: ${stockReturn >= 0 ? '+' : '-'}$${Math.abs(stockReturn).toFixed(0)} (${stockReturnPct >= 0 ? '+' : ''}${stockReturnPct.toFixed(1)}%)

Individual Stocks:
${assetsText}` : ''}`;

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
            content: 'You are a concise, balanced financial advisor. Assess the overall financial position holistically — cash reserves are a major strength. Provide brief insights, one sentence per section.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 250,
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
