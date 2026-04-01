const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const jobsDir = path.join(__dirname, 'jobs');
const app = express();
const PORT = process.env.PORT || 3000;

// Store jobs in a map for easy access
const jobs = new Map();

// Function to load jobs
function loadJobs(specificJobs = []) {
  const allJobs = fs.readdirSync(jobsDir).filter(file => file.endsWith('.config.json')).map(file => file.replace('.config.json', ''));
  const jobsToLoad = specificJobs.length > 0 ? specificJobs : allJobs;

  jobsToLoad.forEach(jobName => {
    const configFile = `${jobName}.config.json`;
    const configPath = path.join(jobsDir, configFile);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const scriptPath = path.join(jobsDir, config.script);

      if (fs.existsSync(scriptPath)) {
        // Store in map
        jobs.set(jobName, { config, scriptPath });

        // Schedule the cron job
        cron.schedule(config.schedule, () => {
          console.log(`Running scheduled job: ${config.script}`);
          runJob(jobName);
        });
        console.log(`Scheduled job: ${config.script} with schedule: ${config.schedule}`);
      } else {
        console.error(`Script file not found: ${scriptPath}`);
      }
    } else {
      console.error(`Config file not found: ${configPath}`);
    }
  });
}

// Function to run a job
function runJob(jobName) {
  const job = jobs.get(jobName);
  if (!job) {
    console.error(`Job not found: ${jobName}`);
    return;
  }
  const child = spawn('node', [job.scriptPath], { stdio: 'inherit' });
  child.on('error', (err) => {
    console.error(`Error running ${job.config.script}:`, err);
  });
}

// API Routes
app.get('/jobs', (req, res) => {
  const jobList = Array.from(jobs.keys()).map(name => ({
    name,
    schedule: jobs.get(name).config.schedule,
    script: jobs.get(name).config.script
  }));
  res.json(jobList);
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

// Get command line arguments (skip 'node' and 'index.js')
const args = process.argv.slice(2);

// Load jobs based on arguments
loadJobs(args);

// Start the server
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

// Keep the script running
console.log(`Cron scheduler started. Loaded ${args.length > 0 ? args.join(', ') : 'all'} jobs from jobs/ directory.`);
console.log('Press Ctrl+C to stop.');