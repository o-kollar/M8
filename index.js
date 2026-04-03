// 1. Force color output globally
process.env.FORCE_COLOR = '1';

require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const morgan = require('morgan');
const winston = require('winston');
const chalk = require('chalk');

let localtunnel;
try {
  localtunnel = require('localtunnel');
} catch (err) {
  localtunnel = null;
}

const jobsDir = path.join(__dirname, 'jobs');
const logDir = path.join(__dirname, 'logs');
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir, { recursive: true });
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// Configure Winston Logger with Chalk for console and clean text for file
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports:[
    // Console Transport (Colorful)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          let colorLevel = level.toUpperCase();
          if (level === 'info') colorLevel = chalk.green.bold(colorLevel);
          if (level === 'warn') colorLevel = chalk.yellow.bold(colorLevel);
          if (level === 'error') colorLevel = chalk.red.bold(colorLevel);
          
          return `${chalk.gray(timestamp)}[${colorLevel}] ${message}`;
        })
      )
    }),
    // File Transport (Plain text - Strips Chalk colors)
    new winston.transports.File({ 
      filename: path.join(logDir, 'app.log'),
      format: winston.format.combine(
        winston.format.uncolorize(), // Removes ANSI color codes for the file
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp}[${level.toUpperCase()}] ${message}`)
      )
    })
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
function loadJobs(specificJobs =[]) {
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
        logger.info(`Running scheduled job: ${chalk.cyan(jobName)}`);
        runJob(jobName);
      });
      logger.info(`Scheduled job: ${chalk.cyan.bold(jobName)} with schedule: ${chalk.yellow(config.schedule)}`);
    } else {
      logger.error(`Config file not found: ${chalk.red(configPath)}`);
    }
  });
}

// Function to run a job
function runJob(jobName) {
  const job = jobs.get(jobName);
  if (!job) {
    logger.error(`Job not found: ${chalk.cyan(jobName)}`);
    return;
  }

  // 2. Spawn with FORCE_COLOR environment variable injected!
  const child = spawn('node', [path.join(__dirname, 'job.js'), jobName], { 
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' } 
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // Keep partial line in buffer
    lines.forEach(line => {
      // Only log if the line has content to avoid metadata-only lines in logs
      if (line.trim()) {
        logger.info(line.replace(/\r/g, ''));
      }
    });
  });

  let stderrBuffer = '';
  child.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();
    lines.forEach(line => {
      if (line.trim()) {
        logger.error(chalk.red(line.replace(/\r/g, '')));
      }
    });
  });

  child.on('error', (err) => {
    logger.error(`Error running job ${chalk.cyan(jobName)}: ${chalk.red(err.message)}`);
  });

  child.on('close', (code) => {
    // Flush any remaining partial lines
    if (stdoutBuffer.trim()) {
      logger.info(stdoutBuffer.replace(/\r/g, ''));
    }
    if (stderrBuffer.trim()) {
      logger.error(chalk.red(stderrBuffer.replace(/\r/g, '')));
    }

    const codeColor = code === 0 ? chalk.green(code) : chalk.red(code);
    logger.info(`Job ${chalk.cyan(jobName)} finished with exit code ${codeColor}`);
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
  
  fs.mkdirSync(jobDir, { recursive: true });
  
  const config = { schedule, llm: llm || 'gemini' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  const instr = typeof instructionsContent === 'string' ? instructionsContent : `# ${name} Job\n\nAdd documentation for this job here.\n`;
  fs.writeFileSync(instructionsPath, instr);
  
  jobs.set(name, { config, jobDir });
  cron.schedule(config.schedule, () => {
    logger.info(`Running scheduled job: ${chalk.cyan(name)}`);
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

app.get('/logs', (req, res) => {
  const logPath = path.join(logDir, 'app.log');
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    res.json({ logs: content });
  } else {
    res.json({ logs: 'No logs available yet.' });
  }
});

const logPath = path.join(logDir, 'app.log');

app.get('/logs/stream', (req, res) => {
  let currentPosition = 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const tailLines = lines.slice(-50);
    tailLines.forEach(line => {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    });
    currentPosition = content.length;
  }

  const watcher = fs.watch(logPath, () => {
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const currentLength = content.length;
      
      if (currentLength > currentPosition) {
        const newContent = content.slice(currentPosition);
        const newLines = newContent.split('\n').filter(line => line.trim());
        
        newLines.forEach(line => {
          res.write(`data: ${JSON.stringify({ line })}\n\n`);
        });
        
        currentPosition = currentLength;
      }
    } catch (err) {}
  });

  req.on('close', () => {
    watcher.close();
    res.end();
  });

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
    logger.warn(chalk.yellow('ENABLE_LOCALTUNNEL=true but localtunnel module is not installed. Please npm install localtunnel or disable localtunnel.'));
    return;
  }

  try {
    const tunnel = await localtunnel({
      port,
      subdomain: process.env.LOCALTUNNEL_SUBDOMAIN,
    });

    logger.info(`Localtunnel running at ${chalk.blue.underline(tunnel.url)}`);
    tunnel.on('close', () => logger.warn(chalk.yellow('Localtunnel connection closed')));

    const shutdown = async () => {
      logger.info(chalk.magenta.bold('Shutting down localtunnel and server'));
      tunnel.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.error(`Failed to initialize localtunnel: ${chalk.red(err.message)}`);
  }
}

const args = process.argv.slice(2);
loadJobs(args);

console.log(chalk.yellowBright.bold(`
     e    e       d8~~\\  
    d8b  d8b     C88b  | 
   d888bdY88b     Y88b/  
  / Y88Y Y888b    /Y88b  
 /   YY   Y888b  |  Y88D 
/          Y888b  \\__8P  
                         
`));

app.listen(PORT, async () => {
  logger.info(`API server running on port ${chalk.yellow.bold(PORT)}`);
  await setupLocalTunnel(PORT);
});

const loadedJobsText = args.length > 0 ? args.join(', ') : 'all';
logger.info(`Cron scheduler started. Loaded ${chalk.cyan.bold(loadedJobsText)} jobs from jobs/ directory.`);
logger.info(chalk.gray.italic('Press Ctrl+C to stop.'));