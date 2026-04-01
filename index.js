const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const morgan = require('morgan');
const winston = require('winston');

let localtunnel;
try {
  localtunnel = require('localtunnel');
} catch (err) {
  // This is optional; if missing, we log later and continue.
  localtunnel = null;
}

const jobsDir = path.join(__dirname, 'jobs');
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logDir, 'app.log') })
  ],
});

const app = express();
const PORT = process.env.PORT || 3000;

// Request logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store jobs in a map for easy access
const jobs = new Map();

// Function to load jobs
function loadJobs(specificJobs = []) {
  const allJobs = fs.readdirSync(jobsDir)
    .filter((file) => file.endsWith('.config.json'))
    .map((file) => file.replace('.config.json', ''));
  const jobsToLoad = specificJobs.length > 0 ? specificJobs : allJobs;

  jobsToLoad.forEach((jobName) => {
    const configFile = `${jobName}.config.json`;
    const configPath = path.join(jobsDir, configFile);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const scriptPath = path.join(jobsDir, config.script);

      if (fs.existsSync(scriptPath)) {
        jobs.set(jobName, { config, scriptPath });
        cron.schedule(config.schedule, () => {
          logger.info(`Running scheduled job: ${jobName} (${config.script})`);
          runJob(jobName);
        });
        logger.info(`Scheduled job: ${jobName} (${config.script}) with schedule: ${config.schedule}`);
      } else {
        logger.error(`Script file not found: ${scriptPath}`);
      }
    } else {
      logger.error(`Config file not found: ${configPath}`);
    }
  });
}

// Function to run a job
function runJob(jobName) {
  const job = jobs.get(jobName);
  if (!job) {
    logger.error(`Job not found: ${jobName}`);
    return;
  }

  const child = spawn('node', [job.scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (data) => {
    logger.info(`[${jobName}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    logger.error(`[${jobName}] ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    logger.error(`Error running ${job.config.script}: ${err.message}`);
  });

  child.on('close', (code) => {
    logger.info(`Job ${jobName} finished with exit code ${code}`);
  });
}

// API Routes
app.get('/jobs', (req, res) => {
  const jobList = Array.from(jobs.keys()).map((name) => ({
    name,
    schedule: jobs.get(name).config.schedule,
    script: jobs.get(name).config.script,
  }));
  res.json(jobList);
});

app.get('/jobs/:name', (req, res) => {
  const jobName = req.params.name;
  const job = jobs.get(jobName);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const scriptContent = fs.readFileSync(job.scriptPath, 'utf8');
  res.json({
    name: jobName,
    schedule: job.config.schedule,
    script: job.config.script,
    scriptContent,
  });
});

app.post('/run/:jobname', (req, res) => {
  const jobName = req.params.jobname;
  if (jobs.has(jobName)) {
    runJob(jobName);
    res.json({ message: `Job ${jobName} triggered successfully.` });
  } else {
    res.status(404).json({ error: `Job ${jobName} not found.` });
  }
});

app.post('/jobs', (req, res) => {
  const { name, schedule, script, scriptContent } = req.body;
  if (!name || !schedule || !script || !scriptContent) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const configPath = path.join(jobsDir, `${name}.config.json`);
  const scriptPath = path.join(jobsDir, script);
  if (fs.existsSync(configPath)) {
    return res.status(409).json({ error: 'Job already exists' });
  }

  const config = { schedule, script };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(scriptPath, scriptContent);
  jobs.set(name, { config, scriptPath });
  cron.schedule(config.schedule, () => {
    logger.info(`Running scheduled job: ${name} (${script})`);
    runJob(name);
  });

  res.json({ message: 'Job created successfully' });
});

app.put('/jobs/:name', (req, res) => {
  const jobName = req.params.name;
  const { schedule, script, scriptContent } = req.body;
  if (!schedule || !script || !scriptContent) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const job = jobs.get(jobName);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const configPath = path.join(jobsDir, `${jobName}.config.json`);
  const scriptPath = path.join(jobsDir, script);
  const config = { schedule, script };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.writeFileSync(scriptPath, scriptContent);
  jobs.set(jobName, { config, scriptPath });
  res.json({ message: 'Job updated successfully' });
});

async function setupLocalTunnel(port) {
  if (process.env.ENABLE_LOCALTUNNEL !== 'true') return;

  if (!localtunnel) {
    logger.warn('ENABLE_LOCALTUNNEL=true but localtunnel module is not installed. Please npm install localtunnel or disable localtunnel.');
    return;
  }

  try {
    const tunnel = await localtunnel({
      port,
      subdomain: process.env.LOCALTUNNEL_SUBDOMAIN,
    });

    logger.info(`Localtunnel running at ${tunnel.url}`);
    tunnel.on('close', () => logger.warn('Localtunnel connection closed'));

    const shutdown = async () => {
      logger.info('Shutting down localtunnel and server');
      tunnel.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.error(`Failed to initialize localtunnel: ${err.message}`);
  }
}

// Get command line arguments (skip 'node' and 'index.js')
const args = process.argv.slice(2);

// Load jobs based on arguments
loadJobs(args);

// Start the server
app.listen(PORT, async () => {
  logger.info(`API server running on port ${PORT}`);
  await setupLocalTunnel(PORT);
});

logger.info(`Cron scheduler started. Loaded ${args.length > 0 ? args.join(', ') : 'all'} jobs from jobs/ directory.`);
logger.info('Press Ctrl+C to stop.');
