# M8

A simple cron scheduler built with Node.js and node-cron.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

## Usage

Run the scheduler:
```bash
npm start
```

This will start a cron job that runs every minute, logging the current time.

To stop, press `Ctrl+C`.

## Customization

Edit `index.js` to add more cron schedules or tasks. Refer to [node-cron documentation](https://www.npmjs.com/package/node-cron) for cron expression syntax.
