/**
 * Global job runner
 * Invoked as: node job.js <jobName>
 * Reads instructions from jobs/<jobName>/Instructions.md
 * Calls LLM with those instructions
 */

const fs = require('fs');
const path = require('path');
const { callLLM, callReplicate } = require(path.join(__dirname, 'lib', 'llm.js'));

const jobName = process.argv[2];
if (!jobName) {
  console.error('Usage: node job.js <jobName>');
  process.exit(1);
}

const jobDir = path.join(__dirname, 'jobs', jobName);
const instructionsPath = path.join(jobDir, 'Instructions.md');
const configPath = path.join(jobDir, 'config.json');

// Check job folder exists
if (!fs.existsSync(jobDir)) {
  console.error(`Job folder not found: ${jobDir}`);
  process.exit(1);
}

// Load instructions
let instructions = '';
if (fs.existsSync(instructionsPath)) {
  instructions = fs.readFileSync(instructionsPath, 'utf8');
}

// Load config (optional, for future use)
let config = {};
if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

console.log(`Running job: ${jobName}`);
console.log(`Timestamp: ${new Date().toISOString()}`);

// Call LLM with instructions (if available)
(async () => {
  if (instructions) {
    const llmType = config.llm || 'gemini'; // Default to gemini
    let result;
    
    if (llmType === 'replicate') {
      result = await callReplicate(instructions);
    } else {
      result = await callLLM(instructions);
    }
    
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    console.warn('No instructions.md found for this job');
  }
})();
