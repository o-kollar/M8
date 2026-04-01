const cron = require('node-cron');

// Schedule a task to run every minute
cron.schedule('* * * * *', () => {
  console.log('Running a task every minute at:', new Date().toISOString());
});

// Keep the script running
console.log('Cron scheduler started. Tasks will run every minute.');
console.log('Press Ctrl+C to stop.');