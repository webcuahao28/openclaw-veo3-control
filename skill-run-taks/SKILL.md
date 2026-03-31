---
name: veo3-runner
description: >
  Skill for controlling the full VEO3 (Google Flow) pipeline on Windows:
  scan images → create tasks in Google Sheet → run veo3-full.js per task
  → send stats to Telegram.

  Use this skill when the user wants to:
  - "run veo3", "generate tasks", "run tasks", "create videos from images"
  - "scan hat/sunglasses folder", "update Google Sheet"
  - "send results to Telegram", "veo3 stats"
  - Check task status (pending/done/error)
  - Configure .env for the VEO3 system
  Always use this skill when veo3, openclaw, generate-tasks, run-tasks,
  or any .js files from the VEO3 project are mentioned.
---

# VEO3 Runner — Skill Guide

## Pipeline Overview

```
📁 Tasks/hat/*.jpg          📁 Tasks/sunglasses/*.jpg
          │                           │
          └──────────────┬────────────┘
                         ▼
              [generate-tasks.js]
          Scan images → fetch context from webhook
          → POST tasks to Google Sheet
                         │
                         ▼
              [run-tasks.js]
          GET pending tasks from Sheet
          → execSync veo3-full.js (one task at a time)
          → UPDATE status to done/error
                         │

```

---

## Project Directory Structure

```
C:\Users\ADMIN\openClawVeo3\
├── .env                    ← Configuration (read this first)
├── generate-tasks.js       ← Step 1: Create task list
├── run-tasks.js            ← Step 2: Execute tasks
├── veo3-full.js            ← Core: Phase 1 images + Phase 2 videos

```

---

## .env — Required Configuration

```env
# Directory containing hat/ and sunglasses/ folders
TASKS_DIR=G:\My Drive\ProjectsVeo3\Tasks

# Path to the per-image processing script (absolute path)
SCRIPT_PATH=C:\Users\ADMIN\openClawVeo3\veo3-full.js

# Google Apps Script webhook (must have doPost + doGet deployed)
WEBHOOK_URL=https://script.google.com/macros/s/...../exec

# Product folders to scan (folder names, comma-separated)
PRODUCT_FOLDERS=hat,sunglasses
# Optional
CMD_TIMEOUT_SEC=3600      # Max timeout per task (seconds), default 3600
SLEEP_BETWEEN_SEC=15      # Sleep between tasks (seconds), default 15
```

---

## Step 1 — Generate Tasks

### Command

```bash
cd C:\Users\ADMIN\openClawVeo3
node generate-tasks.js
```

> No argument needed if `TASKS_DIR` is set in `.env`.
> Pass an argument to override: `node generate-tasks.js "G:\Other\Tasks"`

### Expected Output

```
  ✓ Sheet: 8 new | 0 overwritten | 0 skipped (done)
```

### Common Errors — Generate Tasks

| Symptom | Cause | Fix |
|---|---|---|
| `❌ Directory does not exist` | Wrong TASKS_DIR | Check path in .env |
| `⚠️ Webhook failed` | GAS not deployed | Redeploy Script, set access to "Anyone" |
| `0 images found` | hat/ or sunglasses/ folder is empty | Add images to the folder |
| No log file created | No write permission | Run terminal as Administrator |

---

## Step 2 — Run Tasks

### Basic Command

```bash
node run-tasks.js
```

### Command with Options

```bash
# Preview only (no actual execution)
node run-tasks.js --dry-run

# Start from task #3
node run-tasks.js --from 3

# Run at most 5 tasks
node run-tasks.js --limit 5

# Combined
node run-tasks.js --from 2 --limit 3
```

### Expected Output

```
  [01/08] ✅ DONE (285.3s)
  [02/08] ✅ DONE (312.1s)
  ...
  ✅ Done  : 8/8
  ⏱ Total time: 47.2 min
```

### Common Errors — Run Tasks

| Symptom | Cause | Fix |
|---|---|---|
| `❌ Cannot fetch tasks` | Webhook error / network issue | Check WEBHOOK_URL, retry |
| `ℹ️ No pending tasks` | All tasks done/running | Reset rows to pending in Sheet |
| Task timeout | Video generation too slow | Increase CMD_TIMEOUT_SEC in .env |
| `Tab labs.google not found` | Chrome not open with remote debugging | Open Chrome with `--remote-debugging-port=9222` |

---

## Run Full Pipeline in One Command (Windows)

Create `run-all.bat` in the project directory:

```batch
@echo off
cd /d C:\Users\ADMIN\openClawVeo3
echo [VEO3] Step 1: Generating tasks...
node generate-tasks.js
if %errorlevel% neq 0 (
  echo [VEO3] Generate failed! Stopping.
  pause & exit /b 1
)
echo.
echo [VEO3] Step 2: Running tasks...
node run-tasks.js
echo.
echo [VEO3] ALL DONE!
pause
```

Run it: Double-click `run-all.bat` or type `run-all` in the terminal.

---

## Task Status in Google Sheet

| Status | Meaning |
|---|---|
| `pending` | Waiting to run |
| `running` | Currently being processed by run-tasks |
| `done` | Completed successfully |
| `error` | Failed (see error_message column) |

**Re-run a task:** Set `status` → `pending` in the Sheet.
**Skip a task:** Set `status` → `done` or delete the row.

---

## Quick System Health Check

```bash
# Check for pending tasks without running
node run-tasks.js --dry-run

# Test Google Sheet webhook
node -e "fetch(process.env.WEBHOOK_URL + '?mode=get_tasks&status=pending').then(r=>r.json()).then(d=>console.log(d.tasks?.length,'tasks'))"
```

---

## Important Notes

- **Chrome must be open** with a `labs.google` tab and `--remote-debugging-port=9222` before running `run-tasks.js`
- **Each task takes ~5–8 minutes** (4 images + 16 videos)
- **Sheet tab "tasks"** must have exactly these columns: `image_path | product | context | command | status | created_at`
- **Google Apps Script** must support both `doGet` (modes: context, get_tasks) and `doPost` (modes: write_tasks, update_task)