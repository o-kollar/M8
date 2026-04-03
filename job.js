/**
 * Global job runner
 * Invoked as: node job.js <jobName>
 * Reads instructions from jobs/<jobName>/Instructions.md
 * Calls LLM with those instructions
 */
const fs   = require('fs');
const path = require('path');
const { log, spinner, note, outro, isCancel } = require('@clack/prompts');
const pc   = require('picocolors');
const { marked }         = require('marked');
const { markedTerminal } = require('marked-terminal');

marked.use(markedTerminal());

const { callLLM } = require(path.join(__dirname, 'lib', 'llm.js'));

// ─── Args ─────────────────────────────────────────────────────────────────────
const jobName = process.argv[2];
if (!jobName) {
  log.error(`Usage: ${pc.dim('node job.js')} ${pc.cyan('<jobName>')}`);
  process.exit(1);
}

const jobDir          = path.join(__dirname, 'jobs', jobName);
const instructionsPath = path.join(jobDir, 'Instructions.md');
const configPath       = path.join(jobDir, 'config.json');

if (!fs.existsSync(jobDir)) {
  log.error(`Job folder not found: ${pc.red(jobDir)}`);
  process.exit(1);
}

// ─── Load files ───────────────────────────────────────────────────────────────
const instructions = fs.existsSync(instructionsPath)
  ? fs.readFileSync(instructionsPath, 'utf8')
  : '';

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    log.warn(`Malformed config.json at: ${pc.dim(configPath)} — using defaults`);
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────
(async () => {
  log.step(
    `${pc.cyan(pc.bold(jobName))}  ${pc.dim(new Date().toISOString())}`
  );

  if (!instructions) {
    log.warn('No Instructions.md found for this job — nothing to do.');
    outro(pc.dim('done'));
    return;
  }

  const modelName = config.model || 'gemini-2.0-flash-lite';
  log.info(`Model: ${pc.cyan(modelName)}`);

  const s = spinner();
  s.start('Calling LLM…');

  let result;
  try {
    result = await callLLM(instructions, modelName);
  } catch (err) {
    s.stop('LLM call failed');
    log.error(pc.red(err.message));
    process.exit(1);
  }

  if (!result) {
    s.stop('No response from LLM');
    log.warn('The model returned an empty response.');
    outro(pc.dim('done'));
    return;
  }

  s.stop(`${pc.green('Response received')}`);

  // Print rendered markdown directly — note() wraps in a box that breaks
  // when this process's stdout is buffered and replayed by the parent.
  console.log(marked.parse(result));

  outro(pc.dim('done'));
})();