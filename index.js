require('dotenv').config();
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
  // Get all job directories (those containing config.json)
  const allJobs = fs.readdirSync(jobsDir)
    .filter((item) => {
      const fullPath = path.join(jobsDir, item);
      return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'config.json'));
    });
  
  const jobsToLoad = specificJobs.length > 0 ? specificJobs : allJobs;

  jobsToLoad.forEach((jobName) => {
    const jobDir = path.join(jobsDir, jobName);
    const configPath = path.join(jobDir, 'config.json');
    
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      jobs.set(jobName, { config, jobDir });
      cron.schedule(config.schedule, () => {
        logger.info(`Running scheduled job: ${jobName}`);
        runJob(jobName);
      });
      logger.info(`Scheduled job: ${jobName} with schedule: ${config.schedule}`);
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

  // Spawn global job.js with job name as parameter
  const child = spawn('node', [path.join(__dirname, 'job.js'), jobName], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (data) => {
    logger.info(`[${jobName}] ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    logger.error(`[${jobName}] ${data.toString().trim()}`);
  });

  child.on('error', (err) => {
    logger.error(`Error running job ${jobName}: ${err.message}`);
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
    llm: jobs.get(name).config.llm || 'gemini',
  }));
  res.json(jobList);
});

app.get('/jobs/:name', (req, res) => {
  const jobName = req.params.name;
  const job = jobs.get(jobName);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  let instructions = '';
  try {
    const instructionsPath = path.join(job.jobDir, 'Instructions.md');
    if (fs.existsSync(instructionsPath)) {
      instructions = fs.readFileSync(instructionsPath, 'utf8');
    }
  } catch (err) {
    instructions = '';
  }

  res.json({
    name: jobName,
    schedule: job.config.schedule,
    llm: job.config.llm || 'gemini',
    instructions,
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
  const { name, schedule, instructionsContent, llm } = req.body;
  if (!name || !schedule) {
    return res.status(400).json({ error: 'Missing required fields: name, schedule' });
  }
  
  const jobDir = path.join(jobsDir, name);
  const configPath = path.join(jobDir, 'config.json');
  const instructionsPath = path.join(jobDir, 'Instructions.md');
  
  if (fs.existsSync(jobDir)) {
    return res.status(409).json({ error: 'Job already exists' });
  }
  
  // Create job directory
  fs.mkdirSync(jobDir, { recursive: true });
  
  // Write config only (no individual job.js file needed)
  const config = { schedule, llm: llm || 'gemini' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  // Write Instructions.md (use provided content or a template)
  const instr = typeof instructionsContent === 'string' ? instructionsContent : `# ${name} Job\n\nAdd documentation for this job here.\n`;
  fs.writeFileSync(instructionsPath, instr);
  
  jobs.set(name, { config, jobDir });
  cron.schedule(config.schedule, () => {
    logger.info(`Running scheduled job: ${name}`);
    runJob(name);
  });

  res.json({ message: 'Job created successfully' });
});

app.put('/jobs/:name', (req, res) => {
  const jobName = req.params.name;
  const { schedule, instructionsContent, llm } = req.body;
  if (!schedule) {
    return res.status(400).json({ error: 'Missing required fields: schedule' });
  }
  const job = jobs.get(jobName);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const configPath = path.join(job.jobDir, 'config.json');
  const instructionsPath = path.join(job.jobDir, 'Instructions.md');
  const config = { schedule, llm: llm || 'gemini' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  if (typeof instructionsContent === 'string') {
    fs.writeFileSync(instructionsPath, instructionsContent);
  }
  jobs.set(jobName, { config, jobDir: job.jobDir });
  res.json({ message: 'Job updated successfully' });
});

// Get app.log contents
app.get('/logs', (req, res) => {
  const logPath = path.join(logDir, 'app.log');
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    res.json({ logs: content });
  } else {
    res.json({ logs: 'No logs available yet.' });
  }
});

// SSE endpoint for real-time log streaming
let logFilePosition = 0;
const logPath = path.join(logDir, 'app.log');

app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial logs (tail last 50 lines)
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const tailLines = lines.slice(-50);
    tailLines.forEach(line => {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    });
    logFilePosition = content.length;
  }

  // Watch for new lines in log file
  const watcher = fs.watch(logPath, () => {
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const currentLength = content.length;
      
      if (currentLength > logFilePosition) {
        const newContent = content.slice(logFilePosition);
        const newLines = newContent.split('\n').filter(line => line.trim());
        
        newLines.forEach(line => {
          res.write(`data: ${JSON.stringify({ line })}\n\n`);
        });
        
        logFilePosition = currentLength;
      }
    } catch (err) {
      // File might be being rotated or not exist yet
    }
  });

  // Clean up on disconnect
  req.on('close', () => {
    watcher.close();
    res.end();
  });

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
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

// Print ASCII art startup banner
console.log(`
     e    e       d8~~\\  
    d8b  d8b     C88b  | 
   d888bdY88b     Y88b/  
  / Y88Y Y888b    /Y88b  
 /   YY   Y888b  |  Y88D 
/          Y888b  \\__8P  
                         
`);

// Start the server
app.listen(PORT, async () => {
  logger.info(`API server running on port ${PORT}`);
  await setupLocalTunnel(PORT);
});

logger.info(`Cron scheduler started. Loaded ${args.length > 0 ? args.join(', ') : 'all'} jobs from jobs/ directory.`);
logger.info('Press Ctrl+C to stop.');
