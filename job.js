/**
 * Global job runner
 * Invoked as: node job.js <jobName>
 * Reads instructions from jobs/<jobName>/Instructions.md
 * Calls LLM with those instructions
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// 1. Require marked and marked-terminal
const { marked } = require('marked');
const { markedTerminal } = require('marked-terminal');

// 2. Tell marked to format the output for the terminal
marked.use(markedTerminal());

const { callLLM, callReplicate } = require(path.join(__dirname, 'lib', 'llm.js'));

chalk.level = 1; 
const jobName = process.argv[2];
if (!jobName) {
  console.error(chalk.red('❌ Usage: node job.js <jobName>'));
  process.exit(1);
}

const jobDir = path.join(__dirname, 'jobs', jobName);
const instructionsPath = path.join(jobDir, 'Instructions.md');
const configPath = path.join(jobDir, 'config.json');

// Check job folder exists
if (!fs.existsSync(jobDir)) {
  console.error(chalk.red(`❌ Job folder not found: ${jobDir}`));
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
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`❌ Malformed config.json at: ${configPath}`));
  }
}

console.log(chalk.blue(`🚀 Running job: ${chalk.bold(jobName)}`));
console.log(chalk.gray(`📅 Timestamp: ${new Date().toISOString()}`));

// Call LLM with instructions (if available)
(async () => {
  if (instructions) {
    const modelName = config.model || 'gemini-3.1-flash-lite-preview'; // Default model
    console.log(chalk.cyan(`🤖 Using model: ${chalk.bold(modelName)}`));
    
    const result = await callLLM(instructions, modelName);
    
    if (result) {
      console.log(chalk.green('\n______________\n'));
      
      // 3. Parse and print the markdown beautifully!
      console.log(marked.parse(result)); 
      
    } else {
      console.log(chalk.yellow('⚠️  No response from LLM'));
    }
  } else {
    console.warn(chalk.yellow('⚠️  No instructions.md found for this job'));
  }
})();