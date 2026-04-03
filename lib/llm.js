/**
 * LLM module - Expose clean functions for LLM API interactions
 */

const fs = require('fs');
const path = require('path');

// M8 System Instructions - Defines the "personality" and rules for the AI
const M8_SYSTEM_PROMPT = `
You are M8, an autonomous, 
`.trim();

// Load model catalogue
let modelCatalogue = null;
function loadModelCatalogue() {
  if (!modelCatalogue) {
    const cataloguePath = path.join(__dirname, '..', 'model-catalogue.json');
    if (fs.existsSync(cataloguePath)) {
      modelCatalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf8'));
    } else {
      throw new Error('model-catalogue.json not found');
    }
  }
  return modelCatalogue;
}

// Get model info by name
function getModelInfo(modelName) {
  const catalogue = loadModelCatalogue();
  return catalogue.models.find(model => model.name === modelName);
}

// Get provider info by name
function getProviderInfo(providerName) {
  const catalogue = loadModelCatalogue();
  return catalogue.providers.find(provider => provider.name === providerName);
}

async function callLLM(text, modelName = 'gemini-3.1-flash-lite-preview') {
  const modelInfo = getModelInfo(modelName);
  if (!modelInfo) {
    throw new Error(`Model ${modelName} not found in catalogue`);
  }

  const providerInfo = getProviderInfo(modelInfo.provider);
  if (!providerInfo) {
    throw new Error(`Provider ${modelInfo.provider} not found in catalogue`);
  }

  const apiKey = process.env[providerInfo.apiKeyName];
  if (!apiKey) {
    console.warn(`${providerInfo.apiKeyName} not set; skipping LLM call`);
    return null;
  }

  if (modelInfo.provider === 'gemini') {
    return await callGemini(text, modelName, apiKey);
  } else if (modelInfo.provider === 'replicate') {
    return await callReplicateModel(text, modelName, apiKey);
  } else {
    throw new Error(`Unsupported provider: ${modelInfo.provider}`);
  }
}

async function callGemini(text, modelName, apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Inject System Instructions
        systemInstruction: {
          parts: [{ text: M8_SYSTEM_PROMPT }]
        },
        contents: [{ parts: [{ text }] }],
      })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${txt}`);
    }
    const result = await res.json();
    return result.candidates[0].content.parts[0].text;
  } catch (err) {
    console.error('Gemini call failed:', err);
    return null;
  }
}

async function callReplicateModel(prompt, modelName, apiToken) {
  try {
    // Step 1: Create prediction
    const predictionRes = await fetch(
      'https://api.replicate.com/v1/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          version: modelName,
          input: {
            prompt,
            // Inject System Instructions (Standard for Claude/Llama models on Replicate)
            system_prompt: M8_SYSTEM_PROMPT 
          }
        })
      }
    );

    if (!predictionRes.ok) {
      const txt = await predictionRes.text();
      throw new Error(`Replicate prediction error ${predictionRes.status}: ${txt}`);
    }

    const prediction = await predictionRes.json();
    const predictionId = prediction.id;

    // Step 2: Poll for completion
    let result;
    while (true) {
      const statusRes = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!statusRes.ok) {
        throw new Error(`Replicate status error ${statusRes.status}`);
      }

      result = await statusRes.json();

      if (result.status === 'succeeded') {
        break;
      } else if (result.status === 'failed') {
        throw new Error('Replicate prediction failed');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Replicate output is usually an array of strings for LLMs
    return Array.isArray(result.output) ? result.output.join('') : (result.output || '');
  } catch (err) {
    console.error('Replicate call failed:', err);
    return null;
  }
}

// Legacy functions for backward compatibility
async function callReplicate(prompt, imageUrl = null) {
  // Default to Claude 4.5 Haiku for backward compatibility
  return await callLLM(prompt, 'anthropic/claude-4.5-haiku');
}

module.exports = { callLLM, callReplicate, getModelInfo, getProviderInfo };