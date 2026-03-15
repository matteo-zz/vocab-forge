# Membean Master ✨

> Turn your Membean mistakes into mastery — AI-powered flashcards and timed quizzes that make vocabulary stick.

Upload your Membean CSV export and practice the words you missed with a beautiful flashcard deck or a GLM-powered timed quiz that generates Membean-style questions on the fly.

## Features

- 📚 **Flashcard Mode** — Flip through words, meanings, and examples at your own pace
- ⏱️ **Timed Quiz Mode** — AI-generated multiple-choice questions with a 20-second timer
- 🤖 **GLM-Powered** — Uses the GLM-4 API to create realistic Membean-style distractors
- 🌙 **Dark Mode** — Toggle between light and dark themes
- 📊 **Score Tracking** — See your accuracy and review missed words after each session

## Quick Start

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/<your-username>/membean-master.git
cd membean-master
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and add your GLM API key:

```env
GLM_API_KEY=your_glm_api_key_here
```

3. Start the server:

```bash
python3 server.py
```

4. Open `http://127.0.0.1:8000` and upload your CSV!

> If no API key is set, quizzes still work using a local fallback question generator.

## CSV Format

Use a CSV with these headers:

```csv
Date,Word,Meaning,Example
2026-03-14,resilient,able to recover quickly,She stayed resilient after the setback.
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GLM_API_KEY` | — | Required for AI-generated quiz questions |
| `GLM_MODEL` | `glm-4.7` | Model to use for question generation |
| `GLM_API_BASE` | `https://api.z.ai/api/coding/paas/v4/chat/completions` | API endpoint |
| `PORT` | `8000` | Server port |

## Deploy

Deploy to any Python-friendly host:

- [Render](https://render.com) — easiest, free tier available
- [Railway](https://railway.app) — $5 free credits/month
- [Fly.io](https://fly.io) — 3 free shared VMs
- Any VM or container running `python3 server.py`

## License

MIT
