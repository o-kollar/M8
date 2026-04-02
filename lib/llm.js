/**
 * LLM module - Expose clean functions for LLM API interactions
 */

async function callLLM(text, thinkingLevel = 'low') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY not set; skipping LLM call');
    return null;
  }
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`LLM API error ${res.status}: ${txt}`);
    }
    const result = await res.json();
    return result.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('LLM call failed:', err);
    return null;
  }
}

async function callReplicate(prompt, imageUrl = null) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    console.warn('REPLICATE_API_TOKEN not set; skipping Replicate call');
    return null;
  }

  try {
    // Step 1: Create prediction with stream enabled
    const predictionRes = await fetch(
      'https://api.replicate.com/v1/models/anthropic/claude-4.5-haiku/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stream: true,
          input: {
            ...(imageUrl ? { image: imageUrl } : {}),
            prompt
          }
        })
      }
    );

    if (!predictionRes.ok) {
      const txt = await predictionRes.text();
      throw new Error(`Replicate prediction error ${predictionRes.status}: ${txt}`);
    }

    const prediction = await predictionRes.json();
    const streamUrl = prediction.urls?.stream;

    if (!streamUrl) {
      throw new Error('No stream URL returned from Replicate prediction');
    }

    // Step 2: Stream from the stream URL and collect output
    const streamRes = await fetch(streamUrl, {
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-store'
      }
    });

    if (!streamRes.ok) {
      const txt = await streamRes.text();
      throw new Error(`Replicate stream error ${streamRes.status}: ${txt}`);
    }

    // Parse event-stream format and extract text
    const text = await streamRes.text();
    const lines = text.split('\n').filter(line => line.startsWith('data: '));
    const output = lines
      .map(line => line.replace('data: ', '').trim())
      .filter(Boolean)
      .join('');

    return output;
  } catch (err) {
    console.error('Replicate call failed:', err);
    return null;
  }
}

module.exports = { callLLM, callReplicate };
