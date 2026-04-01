const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const jobsDir = path.join(__dirname, 'jobs');

// Function to load and schedule jobs
function loadJobs() {
  fs.readdirSync(jobsDir).forEach(file => {
    if (file.endsWith('.config.json')) {
      const configPath = path.join(jobsDir, file);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const scriptPath = path.join(jobsDir, config.script);

      if (fs.existsSync(scriptPath)) {
        cron.schedule(config.schedule, () => {
          console.log(`Running job: ${config.script}`);
          const child = spawn('node', [scriptPath], { stdio: 'inherit' });
          child.on('error', (err) => {
            console.error(`Error running ${config.script}:`, err);
          });
        });
        console.log(`Scheduled job: ${config.script} with schedule: ${config.schedule}`);
      } else {
        console.error(`Script file not found: ${scriptPath}`);
      }
    }
  });
}

// Load jobs on startup
loadJobs();

// Keep the script running
console.log('Cron scheduler started. Jobs loaded from jobs/ directory.');
console.log('Press Ctrl+C to stop.');