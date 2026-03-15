# Membean Master

A lightweight web app for practicing Membean vocabulary words from a CSV export, with both flashcards and a timed quiz mode.

## Run locally on your Mac

Use the local Python server so the app can safely read `.env` values and call the GLM API without exposing your key in browser code.

1. Copy `.env.example` to `.env`
2. Add your GLM API key to `.env`
3. Start the app:

```bash
python3 server.py
```

Then visit `http://127.0.0.1:8000`.

If `.env` is missing, the quiz still works, but it falls back to a simpler local question generator.

## CSV format

Use a CSV with these headers:

```csv
Date,Word,Meaning,Example
2026-03-14,resilient,able to recover quickly,She stayed resilient after the setback.
```

## Environment variables

```env
GLM_API_KEY=your_glm_api_key_here
GLM_MODEL=glm-4.6
GLM_API_BASE=https://open.bigmodel.cn/api/paas/v4/chat/completions
```

## Deploy

Because the app now includes a small Python backend for secure GLM calls, deploy it to a host that supports Python apps, such as:

- Render
- Railway
- Fly.io
- Any VM or container running `python3 server.py`
