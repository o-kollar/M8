process.env.FORCE_COLOR = '1';

require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const morgan = require('morgan');
const { intro, outro, log, spinner, note, text, select, isCancel } = require('@clack/prompts');
const { marked }         = require('marked');
const { markedTerminal } = require('marked-terminal');
const { callLLM }        = require(path.join(__dirname, 'lib', 'llm.js'));

marked.use(markedTerminal());
const pc = require('picocolors'); // clack's peer dep — zero-cost, already installed

let localtunnel;
try {
  localtunnel = require('localtunnel');
} catch {
  localtunnel = null;
}

// ─── Directories ─────────────────────────────────────────────────────────────
const jobsDir  = path.join(__dirname, 'jobs');
const logDir   = path.join(__dirname, 'logs');
const publicDir = path.join(__dirname, 'public');
for (const dir of [jobsDir, logDir, publicDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── File-only logger (no ANSI codes) ────────────────────────────────────────
const logFilePath = path.join(logDir, 'app.log');

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function writeToFile(level, message) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts}[${level.toUpperCase()}] ${stripAnsi(message)}\n`;
  fs.appendFileSync(logFilePath, line);
}

// ─── Thin logger that routes to clack + file ─────────────────────────────────
const logger = {
  info:  (msg) => { log.info(msg);             writeToFile('info',  msg); },
  warn:  (msg) => { log.warn(msg);             writeToFile('warn',  msg); },
  error: (msg) => { log.error(msg);            writeToFile('error', msg); },
  step:  (msg) => { log.step(msg);             writeToFile('info',  msg); },
  success:(msg) => { log.success(msg);          writeToFile('info',  msg); },
  // raw line — no clack chrome, just console + file
  line:  (msg) => { console.log(msg);          writeToFile('info',  msg); },
};

// ─── Express ──────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('combined', {
  stream: { write: (message) => writeToFile('http', message.trim()) },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Job registry ─────────────────────────────────────────────────────────────
const jobs = new Map();

// ─── Load jobs ────────────────────────────────────────────────────────────────
function loadJobs(specificJobs = []) {
  const allJobs = fs.readdirSync(jobsDir).filter((item) => {
    const fullPath = path.join(jobsDir, item);
    return (
      fs.statSync(fullPath).isDirectory() &&
      fs.existsSync(path.join(fullPath, 'config.json'))
    );
  });

  const toLoad = specificJobs.length > 0 ? specificJobs : allJobs;

  toLoad.forEach((jobName) => {
    const jobDir    = path.join(jobsDir, jobName);
    const configPath = path.join(jobDir, 'config.json');

    if (!fs.existsSync(configPath)) {
      logger.error(`Config not found: ${pc.red(configPath)}`);
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    jobs.set(jobName, { config, jobDir });

    cron.schedule(config.schedule, () => {
      logger.step(`Running scheduled job: ${pc.cyan(jobName)}`);
      runJob(jobName);
    });

    logger.success(
      `Scheduled ${pc.cyan(pc.bold(jobName))}  ${pc.dim(config.schedule)}`
    );
  });
}

// ─── Run a job ────────────────────────────────────────────────────────────────
function runJob(jobName) {
  const job = jobs.get(jobName);
  if (!job) {
    logger.error(`Job not found: ${pc.cyan(jobName)}`);
    return;
  }

  const s = spinner();
  s.start(`${pc.cyan(jobName)} — running`);

  const child = spawn('node', [path.join(__dirname, 'job.js'), jobName], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  // Collect the full output — piping lines into s.message() causes them to
  // flash and disappear. We flush everything AFTER the spinner resolves.
  let fullStdout = '';
  let fullStderr = '';

  child.stdout.on('data', (data) => { fullStdout += data.toString(); });
  child.stderr.on('data', (data) => { fullStderr += data.toString(); });

  child.on('error', (err) => {
    s.stop(`${pc.cyan(jobName)} — spawn error`);
    logger.error(`${pc.cyan(jobName)}: ${pc.red(err.message)}`);
  });

  child.on('close', (code) => {
    if (code === 0) {
      s.stop(`${pc.cyan(jobName)} — ${pc.green('done')} ${pc.dim('(exit 0)')}`);
    } else {
      s.stop(`${pc.cyan(jobName)} — ${pc.red('failed')} ${pc.dim(`(exit ${code})`)}`);
    }

    // Print buffered output AFTER spinner is gone so it renders properly
    if (fullStdout.trim()) {
      process.stdout.write(fullStdout);
      writeToFile('info', fullStdout);
    }
    if (fullStderr.trim()) {
      process.stderr.write(fullStderr);
      writeToFile('error', fullStderr);
    }
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/jobs', (_req, res) => {
  res.json(
    Array.from(jobs.keys()).map((name) => ({
      name,
      schedule: jobs.get(name).config.schedule,
      llm:      jobs.get(name).config.llm || 'gemini',
    }))
  );
});

app.get('/jobs/:name', (req, res) => {
  const job = jobs.get(req.params.name);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let instructions = '';
  const instrPath = path.join(job.jobDir, 'Instructions.md');
  if (fs.existsSync(instrPath)) instructions = fs.readFileSync(instrPath, 'utf8');

  res.json({
    name:         req.params.name,
    schedule:     job.config.schedule,
    llm:          job.config.llm || 'gemini',
    instructions,
  });
});

app.post('/run/:jobname', (req, res) => {
  const jobName = req.params.jobname;
  if (!jobs.has(jobName)) return res.status(404).json({ error: `Job ${jobName} not found.` });
  runJob(jobName);
  res.json({ message: `Job ${jobName} triggered successfully.` });
});

app.post('/jobs', (req, res) => {
  const { name, schedule, instructionsContent, llm } = req.body;
  if (!name || !schedule)
    return res.status(400).json({ error: 'Missing required fields: name, schedule' });

  const jobDir      = path.join(jobsDir, name);
  const configPath  = path.join(jobDir, 'config.json');
  const instrPath   = path.join(jobDir, 'Instructions.md');

  if (fs.existsSync(jobDir)) return res.status(409).json({ error: 'Job already exists' });

  fs.mkdirSync(jobDir, { recursive: true });
  const config = { schedule, llm: llm || 'gemini' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(
    instrPath,
    typeof instructionsContent === 'string'
      ? instructionsContent
      : `# ${name} Job\n\nAdd documentation for this job here.\n`
  );

  jobs.set(name, { config, jobDir });
  cron.schedule(config.schedule, () => {
    logger.step(`Running scheduled job: ${pc.cyan(name)}`);
    runJob(name);
  });

  logger.success(`Created job ${pc.cyan(pc.bold(name))}`);
  res.json({ message: 'Job created successfully' });
});

app.put('/jobs/:name', (req, res) => {
  const jobName = req.params.name;
  const { schedule, instructionsContent, llm } = req.body;
  if (!schedule) return res.status(400).json({ error: 'Missing required fields: schedule' });

  const job = jobs.get(jobName);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const config = { schedule, llm: llm || 'gemini' };
  fs.writeFileSync(path.join(job.jobDir, 'config.json'), JSON.stringify(config, null, 2));
  if (typeof instructionsContent === 'string')
    fs.writeFileSync(path.join(job.jobDir, 'Instructions.md'), instructionsContent);

  jobs.set(jobName, { config, jobDir: job.jobDir });
  logger.success(`Updated job ${pc.cyan(pc.bold(jobName))}`);
  res.json({ message: 'Job updated successfully' });
});

// ─── Log routes ───────────────────────────────────────────────────────────────
app.get('/logs', (_req, res) => {
  if (fs.existsSync(logFilePath)) {
    res.json({ logs: fs.readFileSync(logFilePath, 'utf8') });
  } else {
    res.json({ logs: 'No logs available yet.' });
  }
});

app.get('/logs/stream', (req, res) => {
  let currentPosition = 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (fs.existsSync(logFilePath)) {
    const content = fs.readFileSync(logFilePath, 'utf8');
    const tail    = content.split('\n').filter(Boolean).slice(-50);
    tail.forEach((line) => res.write(`data: ${JSON.stringify({ line })}\n\n`));
    currentPosition = content.length;
  }

  const watcher = fs.watch(logFilePath, () => {
    try {
      const content = fs.readFileSync(logFilePath, 'utf8');
      if (content.length > currentPosition) {
        const newLines = content.slice(currentPosition).split('\n').filter(Boolean);
        newLines.forEach((line) => res.write(`data: ${JSON.stringify({ line })}\n\n`));
        currentPosition = content.length;
      }
    } catch { /* ignore */ }
  });

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  req.on('close', () => {
    watcher.close();
    clearInterval(heartbeat);
    res.end();
  });
});

// ─── Localtunnel ──────────────────────────────────────────────────────────────
async function setupLocalTunnel(port) {
  if (process.env.ENABLE_LOCALTUNNEL !== 'true') return;
  if (!localtunnel) {
    logger.warn('ENABLE_LOCALTUNNEL=true but localtunnel is not installed.');
    return;
  }

  const s = spinner();
  s.start('Opening localtunnel…');
  try {
    const tunnel = await localtunnel({
      port,
      subdomain: process.env.LOCALTUNNEL_SUBDOMAIN,
    });
    s.stop(`Localtunnel → ${pc.cyan(pc.underline(tunnel.url))}`);
    tunnel.on('close', () => logger.warn('Localtunnel connection closed'));

    const shutdown = async () => {
      outro(pc.magenta('Shutting down'));
      tunnel.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    s.stop('Localtunnel failed');
    logger.error(`localtunnel: ${pc.red(err.message)}`);
  }
}

// ─── Direct Chat ──────────────────────────────────────────────────────────────
async function startChat() {
  const DEFAULT_MODEL = process.env.CHAT_MODEL || 'gemini-2.0-flash-lite';

  // ── Pick an optional system context from a loaded job ──────────────────────
  const jobNames = Array.from(jobs.keys());
  let systemPrompt = '';

  if (jobNames.length > 0) {
    const choice = await select({
      message: 'Ground chat in a job\'s instructions?',
      options: [
        { value: '__none__', label: pc.dim('None — free chat') },
        ...jobNames.map((n) => ({
          value: n,
          label: `${pc.cyan(n)}  ${pc.dim(jobs.get(n).config.schedule)}`,
        })),
      ],
    });

    if (isCancel(choice)) { outro(pc.dim('Chat cancelled.')); return; }

    if (choice !== '__none__') {
      const instrPath = path.join(jobs.get(choice).jobDir, 'Instructions.md');
      if (fs.existsSync(instrPath)) {
        systemPrompt = fs.readFileSync(instrPath, 'utf8');
        log.success(`Loaded instructions from ${pc.cyan(choice)}`);
      }
    }
  }

  note(
    [
      `Model  ${pc.cyan(DEFAULT_MODEL)}`,
      `${pc.dim('/clear')}  reset history    ${pc.dim('/run <job>')}  trigger a job`,
      `${pc.dim('/jobs')}   list jobs        ${pc.dim('Ctrl+C')}      exit chat`,
    ].join('\n'),
    'Chat ready'
  );

  // ── Conversation history ────────────────────────────────────────────────────
  // Stored as plain objects; serialised into a prompt string each turn so
  // callLLM (single-turn) gets the full context without needing refactoring.
  const history = [];

  function buildPrompt(userMessage) {
    const parts = [];
    if (systemPrompt) parts.push(`<system>\n${systemPrompt}\n</system>\n`);
    history.forEach(({ role, content }) => {
      parts.push(`${role === 'user' ? 'User' : 'Assistant'}: ${content}`);
    });
    parts.push(`User: ${userMessage}`);
    parts.push('Assistant:');
    return parts.join('\n\n');
  }

  // ── Chat loop ───────────────────────────────────────────────────────────────
  while (true) {
    const input = await text({
      message: pc.cyan('›'),
      placeholder: 'Message…',
    });

    if (isCancel(input)) break;

    const message = (input ?? '').trim();
    if (!message) continue;

    // ── Slash commands ──────────────────────────────────────────────────────
    if (message === '/clear') {
      history.length = 0;
      log.success('History cleared.');
      continue;
    }

    if (message === '/jobs') {
      if (jobs.size === 0) {
        log.warn('No jobs loaded.');
      } else {
        note(
          Array.from(jobs.entries())
            .map(([n, j]) => `${pc.cyan(n)}  ${pc.dim(j.config.schedule)}`)
            .join('\n'),
          'Loaded jobs'
        );
      }
      continue;
    }

    if (message.startsWith('/run ')) {
      const jobName = message.slice(5).trim();
      if (!jobs.has(jobName)) {
        log.error(`Job not found: ${pc.cyan(jobName)}`);
      } else {
        log.step(`Triggering ${pc.cyan(jobName)}…`);
        runJob(jobName);
      }
      continue;
    }

    if (message.startsWith('/')) {
      log.warn(`Unknown command ${pc.dim(message)} — try /clear, /jobs, /run <job>`);
      continue;
    }

    // ── LLM call ───────────────────────────────────────────────────────────
    const s = spinner();
    s.start('Thinking…');

    let reply;
    try {
      reply = await callLLM(buildPrompt(message), DEFAULT_MODEL);
    } catch (err) {
      s.stop(pc.red('Error'));
      log.error(err.message);
      continue;
    }

    s.stop(pc.dim('↓'));

    if (!reply) {
      log.warn('Empty response from model.');
      continue;
    }

    // Trim any leading "Assistant:" the model may echo back
    const clean = reply.replace(/^Assistant:\s*/i, '').trimStart();

    console.log(marked.parse(clean));
    writeToFile('chat', `user: ${message}\nassistant: ${clean}`);

    history.push({ role: 'user',      content: message });
    history.push({ role: 'assistant', content: clean   });
  }

  outro(pc.dim('Chat ended. Server still running.'));
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

intro(pc.bgCyan(pc.black(' aS ')) + pc.cyan('  async scheduler'));

loadJobs(args);

const loadedText = args.length > 0 ? args.join(', ') : 'all';

app.listen(PORT, async () => {
  note(
    [
      `${pc.dim('API')}   http://localhost:${pc.bold(PORT)}`,
      `${pc.dim('Logs')}  http://localhost:${PORT}/logs/stream`,
      `${pc.dim('Jobs')}  ${pc.cyan(loadedText)}`,
    ].join('\n'),
    'Server ready'
  );

  await setupLocalTunnel(PORT);
  await startChat();
});

logger.step(pc.dim('Press Ctrl+C to stop.'));

process.on('SIGINT', () => {
  outro(pc.dim('Stopped.'));
  process.exit(0);
});