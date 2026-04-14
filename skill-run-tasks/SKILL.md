---
name: veo3-runner
description: >
  Skill for controlling the full VEO3 (Google Flow) pipeline on Windows: scan images → create tasks in Google Sheet → run veo3-full.js per task → update status.
  
  Use this skill for:
  - \"run veo3\", \"generate tasks\", \"run tasks\", single veo3-full.js
  - Check/update status (pending/done/error), .env config, Chrome troubleshooting
  - sunglasses/sunglasses-fitover folders in Tasks/Desktop
  Always trigger on veo3, run-tasks.js, generate-tasks.js, veo3-full.js, kính PNG tasks.

# VEO3 Runner — Skill Guide (Updated 2026-04-07)

## Pipeline

```
Tasks/sunglasses/*.PNG    Tasks/sunglasses-fitover/*.PNG
          │
          ▼
[generate-tasks.js] → Sheet tasks
          │
          ▼
[run-tasks.js] → veo3-full.js/task → UPDATE status
```

## Dir Structure

```
C:\Users\ADMIN\openClawVeo3\
├── .env (config)
├── generate-tasks.js
├── run-tasks.js
├── veo3-full.js (core: 4 images + 16 videos/task)
```

## .env (Current)

```
TASKS_DIR=C:\Users\ADMIN\Desktop\Tasks
SCRIPT_PATH=C:\Users\ADMIN\openClawVeo3\veo3-full.js
WEBHOOK_URL=https://script.google.com/macros/s/AKfycbzxYh83welrm_o-p5j5GNy5nAm0QsFHVMFvmgjN-PsfZjevLEWw0A9FLqS9WslHyh3j_Q/exec
PRODUCT_FOLDERS=sunglasses,sunglasses-fitover
CMD_TIMEOUT_SEC=3600  # Tăng nếu timeout
SLEEP_BETWEEN_SEC=15
```

## 1. Generate Tasks

PS:
```
cd C:\Users\ADMIN\openClawVeo3; node generate-tasks.js
```

Output: `✓ Sheet: X new | ...`

Errors: Check TASKS_DIR, webhook, folders có PNG.

## 2. Run Tasks / Single Task

**Batch**:
```
cd C:\Users\ADMIN\openClawVeo3; node run-tasks.js
```
Options: `--dry-run`, `--from N`, `--limit N`

**Single** (manual, bypass sheet):
```
node \"C:\Users\ADMIN\openClawVeo3\veo3-full.js\" \"C:\Users\ADMIN\Desktop\Tasks\sunglasses\kính 6.PNG\" sunglasses women-ghephu
```
Args: <image> <product> <context>

~5-8p/task. Output videos/ảnh vào folder tương ứng.

## Status Check

```
cd C:\Users\ADMIN\openClawVeo3; node run-tasks.js --dry-run
```
Hoặc fetch:
```
node -e \"fetch('https://script.../exec?mode=get_tasks&status=pending').then(r=>r.json()).then(d=>console.log('Pending:',d.tasks?.length||0))\"  # Repeat for done/error
```

## Chrome Setup (CRITICAL)

1. Kill Chrome cũ: `taskkill /f /im chrome.exe`
2. Mở mới: `chrome --remote-debugging-port=9222 --user-data-dir=C:\temp\chrome-veo`
3. Đi https://labs.google → tab Veo/Imagen3.
4. Giữ mở trước run.

## Common Errors & Fix

| Symptom | Cause/Fix |
|---------|-----------|
| `Tab labs.google not found` | Chrome port/tab sai → Setup lại Chrome |
| Upload stuck `Chờ FLOW_UPLOAD` | Popup không mở/click fail → Manual click upload (614,709), check console |
| SIGKILL/timeout task | CMD_TIMEOUT_SEC thấp → Tăng .env; network chậm |
| undici timeout | Webhook/sheet lag → Retry; check GAS quota |
| No pending | Reset status=pending in Sheet tab \"tasks\" cols: image_path\\|product\\|context\\|command\\|status\\|created_at |
| PS error `&& invalid` | Dùng `;` thay `&&` in PS |

## Full Run BAT (run-all.bat)

```
@echo off
cd /d C:\Users\ADMIN\openClawVeo3
node generate-tasks.js
node run-tasks.js
pause
```

## Notes

- Sheet: doGet (get_tasks/context), doPost (write/update).
- Re-run pending: Set status=pending.
- Current: 3 pending sunglasses-fitover women-incar1 fit5-7.PNG (0 done/error).