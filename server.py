import json
import os
import random
import re
from dataclasses import dataclass
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import dotenv_values
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_GLM_API_BASE = "https://api.z.ai/api/coding/paas/v4/chat/completions"
DEFAULT_GLM_MODEL = "glm-4.7"


@dataclass
class QuizItem:
    question: str
    selection_mode: str
    options: List[Dict[str, str]]
    correct_option_ids: List[str]
    root_hint: str
    source: str


class MembeanHandler(SimpleHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/api/generate-quiz-question":
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API route")
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length header")
            return

        try:
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Request body must be valid JSON")
            return

        word = str(payload.get("word", "")).strip()
        meaning = str(payload.get("meaning", "")).strip()
        example = str(payload.get("example", "")).strip()

        if not word or not meaning:
            self.send_error(HTTPStatus.BAD_REQUEST, "word and meaning are required")
            return

        env = dotenv_values(ROOT / ".env")
        api_key = first_env(
            env,
            os.environ,
            "GLM_API_KEY",
            "ZHIPU_API_KEY",
            "ZHIPUAI_API_KEY",
        )

        api_base = first_env(env, os.environ, "GLM_API_BASE") or DEFAULT_GLM_API_BASE
        model = first_env(env, os.environ, "GLM_MODEL") or DEFAULT_GLM_MODEL

        if api_key:
            try:
                quiz_item = generate_with_glm(
                    word=word,
                    meaning=meaning,
                    example=example,
                    api_key=api_key,
                    api_base=api_base,
                    model=model,
                )
            except Exception as error:
                print(f"[DEBUG] GLM API failed: {error}")
                quiz_item = create_fallback_quiz_item(
                    word=word,
                    meaning=meaning,
                    example=example,
                    reason=str(error),
                )
        else:
            quiz_item = create_fallback_quiz_item(
                word=word,
                meaning=meaning,
                example=example,
                reason="GLM_API_KEY not found in .env or environment.",
            )

        self.send_json(HTTPStatus.OK, {
            "question": quiz_item.question,
            "selection_mode": quiz_item.selection_mode,
            "options": quiz_item.options,
            "correct_option_ids": quiz_item.correct_option_ids,
            "root_hint": quiz_item.root_hint,
            "source": quiz_item.source,
        })

    def send_json(self, status: int, payload: Dict[str, object]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)




def first_env(dotenv_values: Dict[str, str], environ: Dict[str, str], *keys: str) -> Optional[str]:
    for key in keys:
        if key in environ and environ[key].strip():
            return environ[key].strip()
        if key in dotenv_values and dotenv_values[key].strip():
            return dotenv_values[key].strip()
    return None


def generate_with_glm(
    *,
    word: str,
    meaning: str,
    example: str,
    api_key: str,
    api_base: str,
    model: str,
) -> QuizItem:
    prompt = build_glm_prompt(word=word, meaning=meaning, example=example)
    request_body = {
        "model": model,
        "stream": False,
        "temperature": 0.4,
        "max_tokens": 4096,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You create high-quality vocabulary quiz items in the style of Membean. "
                    "Return strict JSON only. Avoid repeating the target word or its obvious family "
                    "inside answer options. Favor short behavioral or scenario-based choices instead "
                    "of dictionary sentences."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
    }

    request = Request(
        api_base,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=45) as response:
            raw_response = response.read().decode("utf-8")
    except HTTPError as error:
        error_body = error.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"GLM API HTTP {error.code}: {error_body}") from error
    except URLError as error:
        raise RuntimeError(f"GLM API request failed: {error.reason}") from error

    print(f"[DEBUG] GLM raw response: {raw_response[:1000]}")
    data = json.loads(raw_response)
    content = data["choices"][0]["message"]["content"]
    print(f"[DEBUG] GLM raw content: {content[:500]}")
    parsed = extract_json_object(content)
    return validate_quiz_item(parsed, word=word, meaning=meaning)


def build_glm_prompt(*, word: str, meaning: str, example: str) -> str:
    example_text = example or "No example sentence was provided."
    return f"""
Create a Membean-style multiple choice vocabulary question.

Target word: {word}
Reference meaning: {meaning}
Reference example: {example_text}

Requirements:
1. Write the question stem in natural style, like:
   - "If a person is obstinate, then they:"
   - "If there is a barrage of criticism, then it:"
   - "When someone supplements something, they:"
2. Make the correct option a paraphrase, not a copy of the reference meaning.
3. Do not use the target word in any option.
4. Do not use close morphological variants of the target word in any option.
5. Produce 4 answer options.
6. Use "single" selection_mode unless the reference meaning truly has multiple distinct correct senses.
7. Distractors should be plausible but clearly wrong.
8. Give a short root/stem hint for the word. If unsure, give the most likely stem and say it is likely.
9. Keep option text concise and readable.

Return strict JSON with this schema:
{{
  "question": "string",
  "selection_mode": "single or multi",
  "options": [
    {{"id": "A", "text": "string"}},
    {{"id": "B", "text": "string"}},
    {{"id": "C", "text": "string"}},
    {{"id": "D", "text": "string"}}
  ],
  "correct_option_ids": ["A"],
  "root_hint": "string"
}}
""".strip()


def extract_json_object(text: str) -> Dict[str, object]:
    stripped = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, re.DOTALL)
    if fence_match:
        stripped = fence_match.group(1)

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("GLM response did not contain a JSON object")

    return json.loads(stripped[start:end + 1])


def validate_quiz_item(payload: Dict[str, object], *, word: str, meaning: str) -> QuizItem:
    question = str(payload.get("question", "")).strip()
    selection_mode = str(payload.get("selection_mode", "single")).strip().lower()
    raw_options = payload.get("options", [])
    raw_correct_ids = payload.get("correct_option_ids", [])
    root_hint = str(payload.get("root_hint", "")).strip() or derive_root_hint(word)

    if selection_mode not in {"single", "multi"}:
        selection_mode = "single"

    if not question or not isinstance(raw_options, list) or len(raw_options) != 4:
        raise ValueError("GLM quiz payload did not return four options")

    options: List[Dict[str, str]] = []
    seen_text = set()
    normalized_word = normalize_text(word)

    for index, option in enumerate(raw_options):
        option_id = str(option.get("id", chr(65 + index))).strip() or chr(65 + index)
        option_text = str(option.get("text", "")).strip()

        if not option_text:
            raise ValueError("GLM returned an empty answer option")

        normalized_option = normalize_text(option_text)
        if normalized_word in normalized_option:
            raise ValueError("GLM returned an answer option containing the target word")
        if normalized_option in seen_text:
            raise ValueError("GLM returned duplicate answer options")

        seen_text.add(normalized_option)
        options.append({"id": option_id, "text": option_text})

    correct_option_ids = [str(value).strip() for value in raw_correct_ids if str(value).strip()]
    if not correct_option_ids:
        raise ValueError("GLM returned no correct option ids")

    valid_ids = {option["id"] for option in options}
    if any(option_id not in valid_ids for option_id in correct_option_ids):
        raise ValueError("GLM returned invalid correct option ids")

    if selection_mode == "single" and len(correct_option_ids) != 1:
        raise ValueError("GLM single-select question had multiple correct answers")

    correct_set = set(correct_option_ids)
    random.shuffle(options)
    old_to_new = {}
    for index, option in enumerate(options):
        new_id = chr(65 + index)
        old_to_new[option["id"]] = new_id
        option["id"] = new_id
    correct_option_ids = [old_to_new[old_id] for old_id in correct_option_ids if old_id in old_to_new]

    return QuizItem(
        question=question,
        selection_mode=selection_mode,
        options=options,
        correct_option_ids=correct_option_ids,
        root_hint=root_hint,
        source="glm",
    )


def create_fallback_quiz_item(*, word: str, meaning: str, example: str, reason: str) -> QuizItem:
    del example, reason
    distractors = [
        "show a different behavior entirely",
        "describe an unrelated quality",
        "point to a different kind of action",
    ]
    options = [
        {"id": "A", "text": meaning},
        {"id": "B", "text": distractors[0]},
        {"id": "C", "text": distractors[1]},
        {"id": "D", "text": distractors[2]},
    ]

    return QuizItem(
        question=f'Which definition best matches "{word}"?',
        selection_mode="single",
        options=options,
        correct_option_ids=["A"],
        root_hint=derive_root_hint(word),
        source="fallback",
    )


def derive_root_hint(word: str) -> str:
    cleaned = re.sub(r"[^a-z]", "", word.lower())
    if not cleaned:
        return word

    prefixes = [
        "contra", "trans", "super", "inter", "circum", "micro", "macro", "multi",
        "photo", "tele", "under", "anti", "post", "fore", "over", "sub", "pre",
        "pro", "con", "com", "dis", "mis", "re", "de", "ob", "ab", "ad", "in",
        "im", "ir", "il", "non", "un", "bi", "tri", "mono", "auto", "geo",
    ]
    suffixes = [
        "ation", "ition", "ingly", "ology", "ically", "ously", "ment", "ness",
        "able", "ible", "tion", "sion", "ious", "less", "ship", "ance", "ence",
        "ally", "edly", "ward", "wise", "ing", "est", "ous", "ive", "ity", "ify",
        "ize", "ise", "ate", "ant", "ent", "ary", "ory", "al", "ly", "ed", "er",
        "or", "ic", "y", "s",
    ]

    prefix = next((candidate for candidate in prefixes if cleaned.startswith(candidate) and len(cleaned) - len(candidate) >= 3), "")
    without_prefix = cleaned[len(prefix):] if prefix else cleaned
    suffix = next((candidate for candidate in suffixes if without_prefix.endswith(candidate) and len(without_prefix) - len(candidate) >= 3), "")
    stem = without_prefix[:-len(suffix)] if suffix else without_prefix
    if len(stem) < 3:
        stem = cleaned[: min(len(cleaned), 6)]

    parts = [part for part in [prefix, stem, suffix] if part]
    return " + ".join(parts) if parts else word


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def main() -> None:
    env = dotenv_values(ROOT / ".env")
    api_key = first_env(
        env,
        os.environ,
        "GLM_API_KEY",
        "ZHIPU_API_KEY",
        "ZHIPUAI_API_KEY",
    )
    print(f"[DEBUG] GLM_API_KEY = {api_key}")

    port = int(os.environ.get("PORT", DEFAULT_PORT))
    handler = partial(MembeanHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((DEFAULT_HOST, port), handler)
    print(f"Membean Master running at http://{DEFAULT_HOST}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
