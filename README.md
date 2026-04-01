# M8

A simple cron scheduler built with Node.js and node-cron that executes JavaScript files as jobs.

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

This will load all jobs from the `jobs/` directory and schedule them according to their config files.

To stop, press `Ctrl+C`.

## Adding Jobs

1. Create a JavaScript file in the `jobs/` directory (e.g., `myjob.js`).
2. Create a corresponding config file named `myjob.config.json` in the same directory.

### Config File Format

The config file should be a JSON object with:
- `schedule`: A cron expression (e.g., `"* * * * *"` for every minute).
- `script`: The filename of the JavaScript file to execute (e.g., `"myjob.js"`).

### Example

**jobs/hello.js**:
```javascript
console.log('Hello from the scheduled job at', new Date().toISOString());
```

**jobs/hello.config.json**:
```json
{
  "schedule": "* * * * *",
  "script": "hello.js"
}
```

## Cron Expression Syntax

Refer to [node-cron documentation](https://www.npmjs.com/package/node-cron) for cron expression syntax.

## Customization

You can modify `index.js` to add more features, such as reloading jobs dynamically or handling job dependencies.
