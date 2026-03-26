import json
import logging
import os
import random
import re
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional

from dotenv import dotenv_values
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request, urlopen

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("vocab-forge")


ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8000
DEFAULT_LLM_API_BASE = "https://api.z.ai/api/coding/paas/v4/chat/completions"
DEFAULT_LLM_MODEL = "glm-4.7"
PUBLIC_FILES = {
    "/": ROOT / "index.html",
    "/index.html": ROOT / "index.html",
    "/app.js": ROOT / "app.js",
    "/styles.css": ROOT / "styles.css",
}


@dataclass
class QuizItem:
    question: str
    question_type: str
    selection_mode: str
    options: List[Dict[str, str]]
    correct_option_ids: List[str]
    root_hint: str
    source: str


class MembeanHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        request_path = unquote(urlsplit(self.path).path)
        normalized_path = normalize_request_path(request_path)
        if normalized_path is None:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        static_file = PUBLIC_FILES.get(normalized_path)
        if static_file is None:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        try:
            file_handle = static_file.open("rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        file_stat = os.fstat(file_handle.fileno())
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", self.guess_type(str(static_file)))
        self.send_header("Content-Length", str(file_stat.st_size))
        self.send_header("Last-Modified", self.date_time_string(file_stat.st_mtime))
        self.end_headers()
        return file_handle

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
            "LLM_API_KEY"
        )

        api_base = first_env(env, os.environ, "LLM_API_BASE") or DEFAULT_LLM_API_BASE
        model = first_env(env, os.environ, "LLM_MODEL") or DEFAULT_LLM_MODEL
        log.info("LLM request — word=%r, model=%s, api_base=%s", word, model, api_base)

        if api_key:
            try:
                quiz_item = generate_with_llm(
                    word=word,
                    meaning=meaning,
                    example=example,
                    api_key=api_key,
                    api_base=api_base,
                    model=model,
                )
            except Exception as error:
                log.error("LLM API failed for word=%r: %s", word, error, exc_info=True)
                quiz_item = create_fallback_quiz_item(
                    word=word,
                    meaning=meaning,
                    example=example,
                    reason=str(error),
                )
        else:
            log.warning("LLM_API_KEY not found in .env or environment — using fallback question generator")
            quiz_item = create_fallback_quiz_item(
                word=word,
                meaning=meaning,
                example=example,
                reason="LLM_API_KEY not found in .env or environment.",
            )

        self.send_json(HTTPStatus.OK, {
            "question": quiz_item.question,
            "question_type": quiz_item.question_type,
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


def normalize_request_path(request_path: str) -> Optional[str]:
    parts = []
    for part in PurePosixPath(request_path or "/").parts:
        if part == "/":
            continue
        if part in {".", ".."} or part.startswith("."):
            return None
        parts.append(part)

    return "/" if not parts else "/" + "/".join(parts)


def generate_with_llm(
    *,
    word: str,
    meaning: str,
    example: str,
    api_key: str,
    api_base: str,
    model: str,
) -> QuizItem:
    question_type = random.choice(["definition", "fill_in_the_blank"])
    prompt = build_llm_prompt(word=word, meaning=meaning, example=example, question_type=question_type)
    
    system_content = (
        "You create high-quality vocabulary quiz items in the style of Membean. "
        "Return strict JSON only. Favor short behavioral or scenario-based choices instead "
        "of dictionary sentences."
    )
    if question_type == "definition":
        system_content = (
            "You create high-quality vocabulary quiz items in the style of Membean. "
            "Return strict JSON only. Avoid repeating the target word or its obvious family "
            "inside answer options. Favor short behavioral or scenario-based choices instead "
            "of dictionary sentences."
        )

    request_body = {
        "model": model,
        "stream": False,
        "temperature": 0.0,
        "max_tokens": 4096,
        "messages": [
            {
                "role": "system",
                "content": system_content,
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
    }

    log.debug("LLM request body:\n%s", json.dumps(request_body, indent=2, ensure_ascii=False))

    request = Request(
        api_base,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        method="POST",
    )

    t0 = time.monotonic()
    try:
        with urlopen(request, timeout=90) as response:
            raw_response = response.read().decode("utf-8")
    except TimeoutError as error:
        elapsed = time.monotonic() - t0
        log.error("LLM connection timed out after %.2fs", elapsed)
        raise RuntimeError("LLM API request timed out") from error
    except HTTPError as error:
        elapsed = time.monotonic() - t0
        error_body = error.read().decode("utf-8", errors="ignore")
        log.error("LLM HTTP %d after %.2fs: %s", error.code, elapsed, error_body)
        raise RuntimeError(f"LLM API HTTP {error.code}: {error_body}") from error
    except URLError as error:
        elapsed = time.monotonic() - t0
        log.error("LLM connection failed after %.2fs: %s", elapsed, error.reason)
        raise RuntimeError(f"LLM API request failed: {error.reason}") from error

    elapsed = time.monotonic() - t0
    log.info("LLM response received in %.2fs (%d bytes)", elapsed, len(raw_response))
    log.debug("LLM raw response: %s", raw_response)

    data = json.loads(raw_response)
    usage = data.get("usage", {})
    if usage:
        log.info(
            "LLM token usage — prompt=%s, completion=%s, total=%s",
            usage.get("prompt_tokens", "?"),
            usage.get("completion_tokens", "?"),
            usage.get("total_tokens", "?"),
        )

    content = data["choices"][0]["message"]["content"]
    log.debug("LLM content: %s", content[:1000])
    parsed = extract_json_object(content)
    log.debug("LLM parsed JSON: %s", json.dumps(parsed, indent=2, ensure_ascii=False))
    quiz_item = validate_quiz_item(parsed, word=word, meaning=meaning, question_type=question_type)
    log.info(
        "LLM quiz item — word=%r, type=%s, question=%r, source=%s, correct=%s",
        word, quiz_item.question_type, quiz_item.question[:80], quiz_item.source, quiz_item.correct_option_ids,
    )
    return quiz_item


def build_llm_prompt(*, word: str, meaning: str, example: str, question_type: str) -> str:
    example_text = example or "No example sentence was provided."
    if question_type == "fill_in_the_blank":
        return f"""
Create a Membean-style multiple choice vocabulary question.

Target word: {word}
Reference meaning: {meaning}
Reference example: {example_text}

Requirements:
1. Write the question stem as a natural sentence with a blank (represented by "______") where the target word should go. The sentence must provide enough context clues to figure out the missing word.
2. The correct option MUST be exactly the target word ("{word}").
3. Distractors must be other English vocabulary words that are plausible but clearly wrong in the context of the sentence. Do not use close morphological variants of the target word for distractors.
4. Produce 4 answer options total.
5. Use "single" selection_mode.
6. Give a short root/stem hint for the target word. If unsure, give the most likely stem and say it is likely.
7. Keep option text concise (just words or short phrases).
8. The sentence stem should NOT contain the target word.

Return strict JSON with this schema:
{{
  "question": "string",
  "selection_mode": "single",
  "options": [
    {{"id": "A", "text": "target word"}},
    {{"id": "B", "text": "distractor word"}},
    {{"id": "C", "text": "distractor word"}},
    {{"id": "D", "text": "distractor word"}}
  ],
  "correct_option_ids": ["A"],
  "root_hint": "string",
  "question_type": "fill_in_the_blank"
}}
""".strip()

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
10. The correct option MUST strictly match the question logically and be an accurate paraphrase of the reference meaning.

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
  "root_hint": "string",
  "question_type": "definition"
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
        raise ValueError("LLM response did not contain a JSON object")

    return json.loads(stripped[start:end + 1])


def validate_quiz_item(payload: Dict[str, object], *, word: str, meaning: str, question_type: str = "definition") -> QuizItem:
    question = str(payload.get("question", "")).strip()
    selection_mode = str(payload.get("selection_mode", "single")).strip().lower()
    raw_options = payload.get("options", [])
    raw_correct_ids = payload.get("correct_option_ids", [])
    root_hint = str(payload.get("root_hint", "")).strip() or derive_root_hint(word)

    if selection_mode not in {"single", "multi"}:
        selection_mode = "single"

    if not question or not isinstance(raw_options, list) or len(raw_options) != 4:
        raise ValueError("LLM quiz payload did not return four options")

    options: List[Dict[str, str]] = []
    seen_text = set()
    normalized_word = normalize_text(word)

    for index, option in enumerate(raw_options):
        option_id = str(option.get("id", chr(65 + index))).strip() or chr(65 + index)
        option_text = str(option.get("text", "")).strip()

        if not option_text:
            raise ValueError("LLM returned an empty answer option")

        normalized_option = normalize_text(option_text)
        if question_type != "fill_in_the_blank" and normalized_word in normalized_option:
            raise ValueError("LLM returned an answer option containing the target word")
        if normalized_option in seen_text:
            raise ValueError("LLM returned duplicate answer options")

        seen_text.add(normalized_option)
        options.append({"id": option_id, "text": option_text})

    correct_option_ids = [str(value).strip() for value in raw_correct_ids if str(value).strip()]
    if not correct_option_ids:
        raise ValueError("LLM returned no correct option ids")

    valid_ids = {option["id"] for option in options}
    if any(option_id not in valid_ids for option_id in correct_option_ids):
        raise ValueError("LLM returned invalid correct option ids")

    if selection_mode == "single" and len(correct_option_ids) != 1:
        raise ValueError("LLM single-select question had multiple correct answers")

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
        question_type=question_type,
        selection_mode=selection_mode,
        options=options,
        correct_option_ids=correct_option_ids,
        root_hint=root_hint,
        source="llm",
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
        question_type="definition",
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
        "LLM_API_KEY",
    )

    if not api_key:
        log.warning("LLM_API_KEY not found — quiz questions will use fallback generator")

    port = int(os.environ.get("PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer((DEFAULT_HOST, port), MembeanHandler)
    log.info("Membean Master running at http://%s:%d", DEFAULT_HOST, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
