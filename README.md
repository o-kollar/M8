# M8

A simple cron scheduler built with Node.js, node-cron, and Express. It runs folder-based jobs from `jobs/`, and supports optional LLM-driven instructions per job.

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (interactive TUI):
   ```bash
   npm run setup
   ```

3. Or create a local `.env` file manually based on `.env.example`:
   ```ini
   PORT=3000
   LOG_LEVEL=info
   GEMINI_API_KEY=
   REPLICATE_API_TOKEN=
   ENABLE_LOCALTUNNEL=false
   LOCALTUNNEL_SUBDOMAIN=
   ```

## Usage

Run all jobs:
```bash
npm start
```

Run specific job(s) by folder name:
```bash
npm start hello
npm start job1 job2
```

This loads jobs from `jobs/` and schedules them as defined in each job's `config.json`.

Run with localtunnel exposure (optional):
```bash
npm run start:local
# or custom subdomain
ENABLE_LOCALTUNNEL=true LOCALTUNNEL_SUBDOMAIN=myapp node index.js
```

Stop with `Ctrl+C`.

## Job Structure

Jobs are directory-based under `jobs/`:

- `jobs/<jobName>/config.json` (required)
- `jobs/<jobName>/Instructions.md` (optional, for LLM calls)

### `config.json`

Typical structure:
```json
{
  "schedule": "* * * * *",
  "model": "gemini-3.1-flash-lite-preview"
}
```

- `schedule`: cron expression, or `false` to disable auto scheduling
- `model`: model name from `model-catalogue.json` (e.g., `"gemini-3.1-flash-lite-preview"`, `"anthropic/claude-4.5-haiku"`)

### Colored Terminal Output

Job execution provides color-coded terminal output for better readability:
- 🔵 **Blue**: General information and job status
- 🟢 **Green**: Successful results and responses
- 🟡 **Yellow**: Warnings and missing files
- 🔴 **Red**: Errors and failures
- ⚪ **White/Gray**: Content and timestamps

### `Instructions.md`

- Text passed to the LLM when the job runs.
- Provide clear prompt wording, desired output format, and context data references.

## API

`index.js` provides a REST API for job control.

### Endpoints

- `GET /jobs` — list loaded jobs and schedules
- `GET /jobs/:name` — job details
- `POST /run/:jobname` — run job immediately
- `POST /jobs` — create job payload + config (if implemented)
- `PUT /jobs/:name` — update job config (if implemented)

### Example

Trigger immediate run:
```bash
curl -X POST http://localhost:3000/run/hello
```

## LLM Support

`lib/llm.js` exposes:
- `callLLM(text)` → Gemini
- `callReplicate(prompt)` → Replicate

API keys are read from `.env`:
- `GEMINI_API_KEY`
- `REPLICATE_API_TOKEN`

If missing, LLM call is skipped but app continues.

## Logging

Uses Winston + morgan.
- Log path: `logs/app.log`
- `LOG_LEVEL` from env (`info` default)

## Contributing

- Add a new job folder in `jobs/`.
- Ensure `config.json` follows the format above.
- Add `Instructions.md` for LLM-enabled jobs.
- Test with `npm start <jobName>` and/or `curl` to call API.

## Useful Links

- [node-cron](https://www.npmjs.com/package/node-cron)
- [Express](https://www.npmjs.com/package/express)
- [winston](https://www.npmjs.com/package/winston)
- [localtunnel](https://www.npmjs.com/package/localtunnel)

---

For more guidance, see `.github/instructions/m8.instructions.md`.
