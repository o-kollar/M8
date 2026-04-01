# M8

A simple cron scheduler built with Node.js and node-cron that executes JavaScript files as jobs.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

## Usage

Run the scheduler with all jobs:
```bash
npm start
```

Run specific jobs by name (the name is the config file base name without `.config.json`):
```bash
npm start hello
npm start job1 job2
```

This will load the specified jobs from the `jobs/` directory and schedule them according to their config files. If no job names are provided, all jobs are loaded.

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

## API

The scheduler also provides an HTTP API for managing jobs.

### Endpoints

- **GET /jobs**: List all loaded jobs with their schedules and scripts.
- **POST /run/:jobname**: Trigger a specific job to run immediately.

### Examples

List jobs:
```bash
curl http://localhost:3000/jobs
```

Run a job:
```bash
curl -X POST http://localhost:3000/run/hello
```

## GUI

A simple web-based GUI is available at `http://localhost:3000` (or your configured port). It allows you to:
- Load and view all jobs
- Run jobs manually with a click

Open your browser to the API URL to access the interface.

Refer to [node-cron documentation](https://www.npmjs.com/package/node-cron) for cron expression syntax.

## Customization

You can modify `index.js` to add more features, such as reloading jobs dynamically or handling job dependencies.
