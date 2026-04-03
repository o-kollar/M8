#!/usr/bin/env node

const fs = require('fs');
const chalk = require('chalk');
const { intro, outro, text, select, multiselect, confirm, password, isCancel, cancel } = require('@clack/prompts');

const ENV_FILE = '.env';
const EXAMPLE_FILE = '.env.example';

// Helper to handle Ctrl+C gracefully
function checkCancel(value) {
  if (isCancel(value)) {
    cancel('⏭️  Setup cancelled.');
    process.exit(0);
  }
  return value;
}

async function main() {
  console.clear();
  
  intro(chalk.bgBlue.white.bold(' 🚀 M8 Cron Scheduler Setup '));

  // Check if .env already exists
  if (fs.existsSync(ENV_FILE)) {
    const overwrite = checkCancel(await confirm({
      message: 'A .env file already exists. Do you want to overwrite it?',
      initialValue: false,
    }));

    if (!overwrite) {
      cancel('⏭️  Setup cancelled. Existing .env file kept.');
      process.exit(0);
    }
  }

  // 1. Multiple Provider Selection
  const selectedProviders = checkCancel(await multiselect({
    message: 'Select the LLM providers you want to configure:',
    options: [
      { label: 'Google Gemini', value: 'gemini' },
      { label: 'Replicate (Claude/Llama)', value: 'replicate' },
      { label: 'OpenAI (GPT-4/o)', value: 'openai' },
      { label: 'Anthropic (Claude Direct)', value: 'anthropic' },
    ],
    required: false,
  }));

  // General Settings
  const port = checkCancel(await text({
    message: 'Server port:',
    initialValue: '3000',
    validate(value) {
      const p = parseInt(value);
      if (isNaN(p) || p <= 0 || p >= 65536) return 'Please enter a valid port number (1-65535)';
    },
  }));

  const logLevel = checkCancel(await select({
    message: 'Log level:',
    options:[
      { label: 'Info', value: 'info' },
      { label: 'Warn', value: 'warn' },
      { label: 'Error', value: 'error' },
      { label: 'Debug', value: 'debug' },
    ],
    initialValue: 'info',
  }));

  // 2. Collect API Keys for selected providers
  const keys = {
    gemini: '',
    replicate: '',
    openai: '',
    anthropic: ''
  };

  for (const provider of selectedProviders) {
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    keys[provider] = checkCancel(await password({
      message: `Enter your ${label} API key:`,
      mask: '*',
      validate(value) {
        if (!value.trim()) return `API key is required for ${label}`;
      },
    }));
  }

  // Localtunnel settings
  const enableTunnel = checkCancel(await confirm({
    message: 'Enable localtunnel for public access?',
    initialValue: false,
  }));

  let subdomain = '';
  if (enableTunnel) {
    subdomain = checkCancel(await text({
      message: 'Localtunnel subdomain (optional):',
      placeholder: 'my-awesome-app',
    }));
  }

  // 3. Generate .env content dynamically
  const envContent = [
    '# Server',
    `PORT=${port}`,
    `LOG_LEVEL=${logLevel}`,
    '',
    '# LLM API Keys',
    `GEMINI_API_KEY=${keys.gemini}`,
    `REPLICATE_API_TOKEN=${keys.replicate}`,
    `OPENAI_API_KEY=${keys.openai}`,
    `ANTHROPIC_API_KEY=${keys.anthropic}`,
    '',
    '# Localtunnel (optional)',
    `ENABLE_LOCALTUNNEL=${enableTunnel}`,
    `LOCALTUNNEL_SUBDOMAIN=${subdomain}`,
  ].join('\n');

  fs.writeFileSync(ENV_FILE, envContent);

  // Generate .env.example (all keys empty)
  const exampleContent = [
    '# Server',
    'PORT=3000',
    'LOG_LEVEL=info',
    '',
    '# LLM API Keys',
    'GEMINI_API_KEY=',
    'REPLICATE_API_TOKEN=',
    'OPENAI_API_KEY=',
    'ANTHROPIC_API_KEY=',
    '',
    '# Localtunnel (optional)',
    'ENABLE_LOCALTUNNEL=false',
    'LOCALTUNNEL_SUBDOMAIN=',
  ].join('\n');
  
  fs.writeFileSync(EXAMPLE_FILE, exampleContent);

  outro(`✅ ${chalk.green('Setup complete!')}\n📄 Created ${chalk.cyan(ENV_FILE)} with ${selectedProviders.length > 0 ? selectedProviders.join(', ') : 'no'} providers.\n🚀 Run ${chalk.blue('npm start')} to begin.`);
}

main().catch((error) => {
  console.error(chalk.red('❌ Setup failed:'), error.message);
  process.exit(1);
});