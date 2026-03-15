const csvFileInput = document.querySelector("#csvFile");
const fileStatus = document.querySelector("#fileStatus");
const wordCount = document.querySelector("#wordCount");
const startPracticeButton = document.querySelector("#startPracticeButton");
const flashCardButton = document.querySelector("#flashCardButton");
const practiceTitle = document.querySelector("#practiceTitle");
const practiceStatus = document.querySelector("#practiceStatus");
const modePlaceholder = document.querySelector("#modePlaceholder");
const modePlaceholderTitle = document.querySelector("#modePlaceholderTitle");
const modePlaceholderText = document.querySelector("#modePlaceholderText");
const flashcardMode = document.querySelector("#flashcardMode");
const progressFill = document.querySelector("#progressFill");
const progressLabel = document.querySelector("#progressLabel");
const deckStatus = document.querySelector("#deckStatus");
const flashcard = document.querySelector("#flashcard");
const cardWord = document.querySelector("#cardWord");
const cardDate = document.querySelector("#cardDate");
const cardHint = document.querySelector("#cardHint");
const cardMeaning = document.querySelector("#cardMeaning");
const cardExample = document.querySelector("#cardExample");
const shuffleButton = document.querySelector("#shuffleButton");
const prevButton = document.querySelector("#prevButton");
const flipButton = document.querySelector("#flipButton");
const nextButton = document.querySelector("#nextButton");
const resetButton = document.querySelector("#resetButton");
const quizMode = document.querySelector("#quizMode");
const quizProgressLabel = document.querySelector("#quizProgressLabel");
const quizScoreLabel = document.querySelector("#quizScoreLabel");
const quizAccuracyLabel = document.querySelector("#quizAccuracyLabel");
const quizTimerLabel = document.querySelector("#quizTimerLabel");
const quizTimerFill = document.querySelector("#quizTimerFill");
const quizWord = document.querySelector("#quizWord");
const quizPrompt = document.querySelector("#quizPrompt");
const quizInstruction = document.querySelector("#quizInstruction");
const quizOptions = document.querySelector("#quizOptions");
const quizFeedback = document.querySelector("#quizFeedback");
const quizFeedbackTitle = document.querySelector("#quizFeedbackTitle");
const quizFeedbackBody = document.querySelector("#quizFeedbackBody");
const quizHint = document.querySelector("#quizHint");
const submitAnswerButton = document.querySelector("#submitAnswerButton");
const nextQuestionButton = document.querySelector("#nextQuestionButton");
const resultsMode = document.querySelector("#resultsMode");
const resultsHeadline = document.querySelector("#resultsHeadline");
const resultsSummary = document.querySelector("#resultsSummary");
const resultsScore = document.querySelector("#resultsScore");
const resultsAccuracy = document.querySelector("#resultsAccuracy");
const resultsCorrect = document.querySelector("#resultsCorrect");
const resultsIncorrect = document.querySelector("#resultsIncorrect");
const restartQuizButton = document.querySelector("#restartQuizButton");
const resultsFlashCardButton = document.querySelector("#resultsFlashCardButton");
const resultsList = document.querySelector("#resultsList");
const balloonBurst = document.querySelector("#balloonBurst");
const themeToggleButton = document.querySelector("#themeToggleButton");
const themeToggleIcon = document.querySelector("#themeToggleIcon");
const themeToggleLabel = document.querySelector("#themeToggleLabel");

const THEME_STORAGE_KEY = "membean-master-theme";
const QUIZ_DURATION_SECONDS = 20;
const QUIZ_API_ENDPOINT = "/api/generate-quiz-question";
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
const COMMON_PREFIXES = [
  "contra", "trans", "super", "under", "inter", "circum", "micro", "macro", "multi",
  "photo", "tele", "sub", "pre", "pro", "con", "com", "dis", "mis", "anti", "post",
  "fore", "over", "re", "de", "ob", "ab", "ad", "in", "im", "ir", "il", "non", "un",
  "bi", "tri", "mono", "auto", "geo",
];
const COMMON_SUFFIXES = [
  "ation", "ition", "ingly", "ology", "ically", "ously", "ment", "ness", "able", "ible",
  "tion", "sion", "ious", "less", "ship", "ance", "ence", "ally", "edly", "ward", "wise",
  "ing", "est", "ous", "ive", "ity", "ify", "ize", "ise", "ate", "ant", "ent", "ary",
  "ory", "al", "ly", "ed", "er", "or", "ic", "y", "s",
];

let words = [];
let currentMode = "placeholder";
let flashcardIndex = 0;
let quizOrder = [];
let quizPointer = 0;
let quizHistory = [];
let currentQuestion = null;
let selectedOptionIds = new Set();
let quizTimeRemaining = QUIZ_DURATION_SECONDS;
let quizTimerId = null;
let questionStartedAt = 0;
let balloonCleanupId = null;
let quizSessionId = 0;

const quizQuestionCache = new Map();
const quizQuestionRequests = new Map();

initializeTheme();
bindEvents();
resetToEmptyState();

function bindEvents() {
  csvFileInput.addEventListener("change", handleFileUpload);
  startPracticeButton.addEventListener("click", () => {
    void startQuizMode();
  });
  flashCardButton.addEventListener("click", startFlashCardMode);
  shuffleButton.addEventListener("click", shuffleFlashCards);
  prevButton.addEventListener("click", () => moveFlashCard(-1));
  flipButton.addEventListener("click", toggleCardFlip);
  nextButton.addEventListener("click", () => moveFlashCard(1));
  resetButton.addEventListener("click", resetFlashCards);
  submitAnswerButton.addEventListener("click", submitCurrentAnswer);
  nextQuestionButton.addEventListener("click", () => {
    void advanceQuiz();
  });
  restartQuizButton.addEventListener("click", () => {
    void startQuizMode();
  });
  resultsFlashCardButton.addEventListener("click", startFlashCardMode);
  themeToggleButton.addEventListener("click", toggleTheme);

  if (typeof systemThemeQuery.addEventListener === "function") {
    systemThemeQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof systemThemeQuery.addListener === "function") {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }

  flashcard.addEventListener("click", toggleCardFlip);
  flashcard.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCardFlip();
    }
  });
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsedWords = parseCsv(text).map((entry, index) => ({
      ...entry,
      id: `${entry.word}-${index}`,
      answerParts: splitMeaningIntoAnswerParts(entry.meaning),
      rootHint: deriveRootHint(entry.word),
    }));

    if (!parsedWords.length) {
      throw new Error("No valid rows were found in that CSV.");
    }

    words = parsedWords;
    flashcardIndex = 0;
    quizSessionId += 1;
    resetQuizState();
    quizQuestionCache.clear();
    quizQuestionRequests.clear();
    fileStatus.textContent = `${file.name} uploaded successfully.`;
    wordCount.textContent = `${words.length} ${words.length === 1 ? "word" : "words"} loaded`;
    renderDeckReadyState();
  } catch (error) {
    words = [];
    flashcardIndex = 0;
    resetQuizState();
    quizQuestionCache.clear();
    quizQuestionRequests.clear();
    fileStatus.textContent = "That file could not be read. Please check the CSV format.";
    wordCount.textContent = "0 words loaded";
    alert(error.message);
    resetToEmptyState();
  }
}

function parseCsv(text) {
  const trimmedText = text.trim();
  const delimiter = detectDelimiter(trimmedText);
  const rows = delimitedTextToRows(trimmedText, delimiter);
  if (!rows.length) {
    return [];
  }

  const headerRow = rows[0].map((value) => value.trim().toLowerCase());
  const expectedHeaders = ["date", "word", "meaning", "example"];
  const hasExpectedHeaders = expectedHeaders.every((header, index) => headerRow[index] === header);

  if (!hasExpectedHeaders) {
    throw new Error("Expected headers: Date, Word, Meaning, Example");
  }

  return rows
    .slice(1)
    .map((columns) => ({
      date: columns[0]?.trim() || "",
      word: columns[1]?.trim() || "",
      meaning: columns[2]?.trim() || "",
      example: columns[3]?.trim() || "",
    }))
    .filter((entry) => entry.word && entry.meaning);
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  return firstLine.includes("\t") ? "\t" : ",";
}

function delimitedTextToRows(text, delimiter) {
  const rows = [];
  let currentValue = "";
  let currentRow = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentValue += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function renderDeckReadyState() {
  practiceTitle.textContent = `Deck ready with ${words.length} ${words.length === 1 ? "word" : "words"}`;
  practiceStatus.textContent = "Choose Flash Card for review or Start Practice for an LLM-powered timed quiz.";
  modePlaceholderTitle.textContent = `Your ${words.length}-word deck is ready`;
  modePlaceholderText.textContent =
    "Flash Card opens the deck. Start Practice generates Membean-style questions, runs a 20-second timer, and tracks your score.";
  updateFlashCard();
  renderQuizIdleState();
  showMode("placeholder");
  syncControls();
}

function resetToEmptyState() {
  clearQuizTimer();
  clearBalloons();
  quizSessionId += 1;
  currentMode = "placeholder";
  practiceTitle.textContent = "Upload a file to unlock your review deck";
  practiceStatus.textContent = "Your words, meanings, and examples will stay organized here.";
  modePlaceholderTitle.textContent = "Upload a file to unlock your review deck";
  modePlaceholderText.textContent =
    "Once your CSV is loaded, use Flash Card for card review or Start Practice for a timed quiz.";
  updateFlashCard();
  renderQuizIdleState();
  renderResults([]);
  showMode("placeholder");
  syncControls();
}

function showMode(mode) {
  currentMode = mode;
  modePlaceholder.hidden = mode !== "placeholder";
  flashcardMode.hidden = mode !== "flashcard";
  quizMode.hidden = mode !== "quiz";
  resultsMode.hidden = mode !== "results";
}

function startFlashCardMode() {
  if (!words.length) {
    return;
  }

  clearQuizTimer();
  clearBalloons();
  quizSessionId += 1;
  flashcardIndex = 0;
  showMode("flashcard");
  practiceTitle.textContent = `Flash Cards for ${words.length} ${words.length === 1 ? "word" : "words"}`;
  practiceStatus.textContent = "Flip each card to reveal the meaning and example, then move through the full deck.";
  updateFlashCard();
  syncControls();
  flashcard.focus();
}

function updateFlashCard() {
  flashcard.classList.remove("is-flipped");

  if (!words.length) {
    cardWord.textContent = "Upload a file to begin";
    cardDate.textContent = "";
    cardHint.textContent = "Your first word will appear here after you upload a CSV.";
    cardMeaning.textContent = "Your definition will appear here.";
    cardExample.textContent = "The example sentence from your file will appear here.";
    progressFill.style.width = "0%";
    progressLabel.textContent = "Card 0 of 0";
    deckStatus.textContent = "Upload your CSV to begin.";
    return;
  }

  const currentWord = words[flashcardIndex];
  const progress = ((flashcardIndex + 1) / words.length) * 100;

  cardWord.textContent = currentWord.word;
  cardDate.textContent = currentWord.date ? `Missed on: ${currentWord.date}` : "";
  cardHint.textContent = "Click the card or use Flip Card to reveal the meaning and example.";
  cardMeaning.textContent = currentWord.meaning;
  cardExample.textContent = currentWord.example || "No example sentence was included in this row.";
  progressFill.style.width = `${progress}%`;
  progressLabel.textContent = `Card ${flashcardIndex + 1} of ${words.length}`;
  deckStatus.textContent = `${currentWord.word} is ready to review`;
}

function toggleCardFlip() {
  if (!words.length || currentMode !== "flashcard") {
    return;
  }

  flashcard.classList.toggle("is-flipped");
}

function moveFlashCard(direction) {
  if (!words.length || currentMode !== "flashcard") {
    return;
  }

  flashcardIndex = (flashcardIndex + direction + words.length) % words.length;
  updateFlashCard();
}

function shuffleFlashCards() {
  if (words.length < 2 || currentMode !== "flashcard") {
    return;
  }

  words = shuffleArray(words);
  flashcardIndex = 0;
  quizQuestionCache.clear();
  quizQuestionRequests.clear();
  updateFlashCard();
}

function resetFlashCards() {
  if (!words.length || currentMode !== "flashcard") {
    return;
  }

  flashcardIndex = 0;
  updateFlashCard();
}

async function startQuizMode() {
  if (!words.length) {
    return;
  }

  clearBalloons();
  clearQuizTimer();
  quizSessionId += 1;
  const sessionId = quizSessionId;
  quizOrder = shuffleArray(words.map((_, index) => index));
  quizPointer = 0;
  quizHistory = [];
  selectedOptionIds = new Set();
  currentQuestion = null;
  showMode("quiz");
  practiceTitle.textContent = `Timed Practice for ${words.length} ${words.length === 1 ? "word" : "words"}`;
  practiceStatus.textContent = "Generating your first Membean-style question...";
  renderQuizLoadingState(words[quizOrder[0]]?.word || "Loading");
  updateQuizSummary();
  syncControls();
  await loadCurrentQuizQuestion(sessionId);
}

function renderQuizIdleState() {
  quizWord.textContent = "Ready";
  quizPrompt.textContent = "Your timed definition question will appear here.";
  quizInstruction.textContent = "Choose one answer.";
  quizProgressLabel.textContent = "0 of 0";
  quizScoreLabel.textContent = "0 correct";
  quizAccuracyLabel.textContent = "0%";
  quizTimerLabel.textContent = `${QUIZ_DURATION_SECONDS}s`;
  quizTimerFill.style.width = "100%";
  quizOptions.replaceChildren();
  quizFeedback.hidden = true;
  submitAnswerButton.disabled = true;
  submitAnswerButton.hidden = false;
  submitAnswerButton.textContent = "Submit Answer";
  nextQuestionButton.hidden = true;
}

function renderQuizLoadingState(wordLabel) {
  quizWord.textContent = wordLabel;
  quizPrompt.textContent = `Generating a Membean-style question for "${wordLabel}"...`;
  quizInstruction.textContent = "Please wait a moment.";
  quizTimerLabel.textContent = "--";
  quizTimerFill.style.width = "0%";
  quizFeedback.hidden = true;
  submitAnswerButton.disabled = true;
  submitAnswerButton.hidden = false;
  submitAnswerButton.textContent = "Loading Question...";
  nextQuestionButton.hidden = true;
  quizOptions.replaceChildren();

  const loadingState = document.createElement("div");
  loadingState.className = "quiz-loading";
  loadingState.textContent = "Generating better distractors and a cleaner prompt...";
  quizOptions.append(loadingState);
}

async function loadCurrentQuizQuestion(sessionId = quizSessionId) {
  clearQuizTimer();
  clearBalloons();

  if (quizPointer >= quizOrder.length) {
    showQuizResults();
    return;
  }

  const entry = words[quizOrder[quizPointer]];
  selectedOptionIds = new Set();
  renderQuizLoadingState(entry.word);
  updateQuizSummary();

  let quizItem;
  try {
    quizItem = await getQuizQuestionForWord(entry);
  } catch (error) {
    quizItem = createLocalQuizQuestion(entry, "Question generation failed.");
  }

  if (sessionId !== quizSessionId) {
    return;
  }

  currentQuestion = {
    entry,
    word: entry.word,
    prompt: quizItem.question,
    multiple: quizItem.selectionMode === "multi",
    options: quizItem.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: quizItem.correctOptionIds.includes(option.id),
    })),
    rootHint: quizItem.rootHint || entry.rootHint,
    source: quizItem.source,
    locked: false,
  };

  questionStartedAt = Date.now();
  quizTimeRemaining = QUIZ_DURATION_SECONDS;
  updateQuizSummary();
  updateQuizTimerUi();

  quizWord.textContent = currentQuestion.word;
  quizPrompt.textContent = currentQuestion.prompt;
  quizInstruction.textContent = currentQuestion.multiple
    ? "Select all correct answers, then submit."
    : "Choose the best answer, then submit.";
  quizFeedback.hidden = true;
  quizFeedback.className = "quiz-feedback";
  submitAnswerButton.disabled = true;
  submitAnswerButton.hidden = false;
  submitAnswerButton.textContent = "Submit Answer";
  nextQuestionButton.hidden = true;
  nextQuestionButton.textContent = quizPointer + 1 >= quizOrder.length ? "See Results" : "Next Question";
  renderQuizOptions();
  startQuizTimer();
  prefetchNextQuizQuestion(quizPointer + 1);

  if (quizItem.source === "llm") {
    practiceStatus.textContent = "Answer each definition question before the 20 second timer runs out.";
  } else {
    practiceStatus.textContent =
      "LLM question generation is not available yet, so this round is using a local fallback question.";
  }
}

async function getQuizQuestionForWord(entry) {
  if (quizQuestionCache.has(entry.id)) {
    return quizQuestionCache.get(entry.id);
  }

  if (quizQuestionRequests.has(entry.id)) {
    return quizQuestionRequests.get(entry.id);
  }

  const requestPromise = fetch(QUIZ_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      word: entry.word,
      meaning: entry.meaning,
      example: entry.example,
    }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Request failed with ${response.status}`);
      }

      const payload = await response.json();
      return normalizeApiQuizPayload(payload, entry);
    })
    .catch(() => createLocalQuizQuestion(entry, "API request failed."))
    .finally(() => {
      quizQuestionRequests.delete(entry.id);
    });

  quizQuestionRequests.set(entry.id, requestPromise);
  const question = await requestPromise;
  quizQuestionCache.set(entry.id, question);
  return question;
}

function normalizeApiQuizPayload(payload, entry) {
  const question = String(payload.question || "").trim();
  const selectionMode = String(payload.selection_mode || "single").trim().toLowerCase();
  const options = Array.isArray(payload.options) ? payload.options : [];
  const correctOptionIds = Array.isArray(payload.correct_option_ids) ? payload.correct_option_ids : [];
  const rootHint = String(payload.root_hint || "").trim() || entry.rootHint;
  const source = payload.source === "llm" ? "llm" : "fallback";

  if (!question || options.length !== 4 || !correctOptionIds.length) {
    return createLocalQuizQuestion(entry, "API payload was incomplete.");
  }

  const seen = new Set();
  const normalizedWord = normalizeText(entry.word);
  const normalizedOptions = options.map((option, index) => {
    const id = String(option.id || String.fromCharCode(65 + index)).trim() || String.fromCharCode(65 + index);
    const text = String(option.text || "").trim();
    const normalized = normalizeText(text);

    if (!text || normalized.includes(normalizedWord) || seen.has(normalized)) {
      throw new Error("Generated option failed validation.");
    }

    seen.add(normalized);
    return { id, text };
  });

  const validOptionIds = new Set(normalizedOptions.map((option) => option.id));
  const cleanedCorrectIds = correctOptionIds
    .map((optionId) => String(optionId).trim())
    .filter((optionId) => validOptionIds.has(optionId));

  if (!cleanedCorrectIds.length) {
    return createLocalQuizQuestion(entry, "API returned invalid correct answers.");
  }

  return {
    question,
    selectionMode: selectionMode === "multi" ? "multi" : "single",
    options: normalizedOptions,
    correctOptionIds: cleanedCorrectIds,
    rootHint,
    source,
  };
}

function createLocalQuizQuestion(entry, reason = "") {
  const correctAnswers = entry.answerParts.length ? entry.answerParts : [entry.meaning];
  const distractorPool = words
    .filter((word) => word.id !== entry.id)
    .flatMap((word) => (word.answerParts.length ? word.answerParts : [word.meaning]))
    .filter((text) => !correctAnswers.some((answer) => normalizeText(answer) === normalizeText(text)));

  const uniqueDistractors = dedupeStrings(distractorPool);
  const neededDistractors = correctAnswers.length > 1 ? 3 : 4;
  const selectedDistractors = shuffleArray(uniqueDistractors).slice(0, neededDistractors);

  while (selectedDistractors.length < neededDistractors) {
    const fallbackText = [
      "show a different behavior entirely",
      "describe an unrelated quality",
      "point to a different kind of action",
      "mean something else in context",
    ].find((text) => !selectedDistractors.includes(text));

    if (!fallbackText) {
      break;
    }

    selectedDistractors.push(fallbackText);
  }

  const options = [
    ...correctAnswers.map((text, index) => ({
      id: `A${index}`,
      text,
    })),
    ...selectedDistractors.slice(0, neededDistractors).map((text, index) => ({
      id: `D${index}`,
      text,
    })),
  ];

  const shuffledOptions = shuffleArray(options).map((option, index) => ({
    id: String.fromCharCode(65 + index),
    text: option.text,
    isOriginallyCorrect: option.id.startsWith("A"),
  }));

  return {
    question: `Which definition best matches "${entry.word}"?`,
    selectionMode: correctAnswers.length > 1 ? "multi" : "single",
    options: shuffledOptions.map((option) => ({ id: option.id, text: option.text })),
    correctOptionIds: shuffledOptions.filter((option) => option.isOriginallyCorrect).map((option) => option.id),
    rootHint: entry.rootHint,
    source: "fallback",
    reason,
  };
}

function renderQuizOptions() {
  quizOptions.replaceChildren();

  currentQuestion.options.forEach((option, index) => {
    const optionButton = document.createElement("button");
    optionButton.type = "button";
    optionButton.className = "quiz-option";
    optionButton.dataset.optionId = option.id;

    const marker = document.createElement("span");
    marker.className = "quiz-option__marker";
    marker.textContent = String.fromCharCode(97 + index);

    const text = document.createElement("span");
    text.className = "quiz-option__text";
    text.textContent = option.text;

    optionButton.append(marker, text);
    optionButton.addEventListener("click", () => handleOptionSelect(option.id));
    quizOptions.append(optionButton);
  });
}

function handleOptionSelect(optionId) {
  if (!currentQuestion || currentQuestion.locked) {
    return;
  }

  if (currentQuestion.multiple) {
    if (selectedOptionIds.has(optionId)) {
      selectedOptionIds.delete(optionId);
    } else {
      selectedOptionIds.add(optionId);
    }
  } else {
    selectedOptionIds = new Set([optionId]);
  }

  submitAnswerButton.disabled = selectedOptionIds.size === 0;
  updateQuizOptionSelection();
}

function updateQuizOptionSelection() {
  quizOptions.querySelectorAll(".quiz-option").forEach((button) => {
    button.classList.toggle("is-selected", selectedOptionIds.has(button.dataset.optionId));
  });
}

function startQuizTimer() {
  clearQuizTimer();
  quizTimerId = window.setInterval(() => {
    quizTimeRemaining -= 1;
    updateQuizTimerUi();

    if (quizTimeRemaining <= 0) {
      finalizeQuestion(true);
    }
  }, 1000);
}

function clearQuizTimer() {
  if (quizTimerId !== null) {
    window.clearInterval(quizTimerId);
    quizTimerId = null;
  }
}

function updateQuizTimerUi() {
  const ratio = Math.max(0, quizTimeRemaining / QUIZ_DURATION_SECONDS);
  quizTimerLabel.textContent = `${Math.max(0, quizTimeRemaining)}s`;
  quizTimerFill.style.width = `${ratio * 100}%`;
}

function submitCurrentAnswer() {
  finalizeQuestion(false);
}

function finalizeQuestion(timedOut) {
  if (!currentQuestion || currentQuestion.locked) {
    return;
  }

  clearQuizTimer();
  currentQuestion.locked = true;

  const correctIds = currentQuestion.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id)
    .sort();
  const selectedIds = Array.from(selectedOptionIds).sort();
  const isCorrect = arraysEqual(correctIds, selectedIds);
  const correctOptions = currentQuestion.options.filter((option) => option.isCorrect);
  const selectedOptions = currentQuestion.options.filter((option) => selectedOptionIds.has(option.id));
  const correctText = correctOptions.map((option) => option.text).join(" | ");
  const selectedText = selectedOptions.length
    ? selectedOptions.map((option) => option.text).join(" | ")
    : timedOut
      ? "No answer before time expired."
      : "No answer selected.";
  const timeTaken = Math.min(
    QUIZ_DURATION_SECONDS,
    Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)),
  );

  quizHistory.push({
    word: currentQuestion.word,
    isCorrect,
    timedOut,
    selectedText,
    correctText,
    timeTaken,
    rootHint: currentQuestion.rootHint,
    questionNumber: quizPointer + 1,
    source: currentQuestion.source,
  });

  updateQuizSummary();
  updateQuizOptionFeedback();
  showQuizFeedback({
    isCorrect,
    timedOut,
    correctText,
    rootHint: currentQuestion.rootHint,
  });

  submitAnswerButton.hidden = true;
  submitAnswerButton.disabled = true;
  nextQuestionButton.hidden = false;
}

function updateQuizOptionFeedback() {
  const correctOptionIds = new Set(
    currentQuestion.options.filter((option) => option.isCorrect).map((option) => option.id),
  );

  quizOptions.querySelectorAll(".quiz-option").forEach((button) => {
    const optionId = button.dataset.optionId;
    button.disabled = true;
    button.classList.remove("is-selected");

    if (correctOptionIds.has(optionId)) {
      button.classList.add("is-correct");
    } else if (selectedOptionIds.has(optionId)) {
      button.classList.add("is-wrong");
    }
  });
}

function showQuizFeedback(record) {
  quizFeedback.hidden = false;
  quizHint.hidden = true;

  if (record.isCorrect) {
    quizFeedback.className = "quiz-feedback quiz-feedback--success";
    quizFeedbackTitle.textContent = "Success";
    quizFeedbackBody.textContent = `Nice work. ${record.correctText} was the right definition.`;
    quizHint.textContent = "";
    launchBalloons();
    return;
  }

  quizFeedback.className = "quiz-feedback quiz-feedback--error";
  quizFeedbackTitle.textContent = record.timedOut ? "Time's up" : "Not quite";
  quizFeedbackBody.textContent = `Correct answer: ${record.correctText}`;
  quizHint.hidden = false;
  quizHint.textContent = `Hint: likely root/stem: ${record.rootHint}`;
}

async function advanceQuiz() {
  if (quizPointer + 1 >= quizOrder.length) {
    showQuizResults();
    return;
  }

  quizPointer += 1;
  await loadCurrentQuizQuestion();
}

function updateQuizSummary() {
  const answered = quizHistory.length;
  const correct = quizHistory.filter((record) => record.isCorrect).length;
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const currentQuestionNumber = quizOrder.length ? Math.min(quizPointer + 1, quizOrder.length) : 0;

  quizProgressLabel.textContent = `${currentQuestionNumber} of ${quizOrder.length}`;
  quizScoreLabel.textContent = `${correct} correct`;
  quizAccuracyLabel.textContent = `${accuracy}%`;
}

function showQuizResults() {
  clearQuizTimer();
  clearBalloons();
  showMode("results");
  practiceTitle.textContent = "Quiz results";
  practiceStatus.textContent = "Here is the full record of your timed quiz run.";
  renderResults(quizHistory);
  syncControls();
}

function renderResults(records) {
  const total = records.length;
  const correct = records.filter((record) => record.isCorrect).length;
  const incorrect = total - correct;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;

  resultsHeadline.textContent = total
    ? `You finished ${total} ${total === 1 ? "question" : "questions"}`
    : "You finished the deck";
  resultsSummary.textContent = total
    ? `Final score: ${correct} correct out of ${total}, for ${accuracy}% accuracy.`
    : "Your final score and every answered question will appear here.";
  resultsScore.textContent = `${correct} / ${total}`;
  resultsAccuracy.textContent = `${accuracy}%`;
  resultsCorrect.textContent = `${correct}`;
  resultsIncorrect.textContent = `${incorrect}`;
  resultsList.replaceChildren();

  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = `result-row ${record.isCorrect ? "is-correct" : "is-incorrect"}`;

    const topLine = document.createElement("div");
    topLine.className = "result-row__top";

    const wordBlock = document.createElement("div");
    wordBlock.className = "result-row__word";

    const label = document.createElement("p");
    label.className = "summary-label";
    label.textContent = `Question ${record.questionNumber}`;

    const word = document.createElement("h4");
    word.textContent = record.word;

    wordBlock.append(label, word);

    const status = document.createElement("span");
    status.className = `result-row__status ${record.isCorrect ? "is-correct" : "is-incorrect"}`;
    status.textContent = record.isCorrect ? "Correct" : record.timedOut ? "Timed Out" : "Incorrect";

    topLine.append(wordBlock, status);

    const yourAnswer = document.createElement("p");
    yourAnswer.className = "result-row__detail";
    yourAnswer.textContent = `Your answer: ${record.selectedText}`;

    const correctAnswer = document.createElement("p");
    correctAnswer.className = "result-row__detail";
    correctAnswer.textContent = `Correct answer: ${record.correctText}`;

    const meta = document.createElement("p");
    meta.className = "result-row__meta";
    meta.textContent = `Time used: ${record.timeTaken}s`;

    item.append(topLine, yourAnswer, correctAnswer, meta);

    if (!record.isCorrect) {
      const hint = document.createElement("p");
      hint.className = "result-row__hint";
      hint.textContent = `Hint shown: likely root/stem ${record.rootHint}`;
      item.append(hint);
    }

    resultsList.append(item);
  });
}

function resetQuizState() {
  clearQuizTimer();
  quizOrder = [];
  quizPointer = 0;
  quizHistory = [];
  currentQuestion = null;
  selectedOptionIds = new Set();
  quizTimeRemaining = QUIZ_DURATION_SECONDS;
  renderQuizIdleState();
}

function syncControls() {
  const hasWords = words.length > 0;
  const flashcardsActive = hasWords && currentMode === "flashcard";

  startPracticeButton.hidden = !hasWords;
  flashCardButton.hidden = !hasWords;
  startPracticeButton.disabled = !hasWords;
  flashCardButton.disabled = !hasWords;
  shuffleButton.disabled = !flashcardsActive || words.length < 2;
  prevButton.disabled = !flashcardsActive;
  flipButton.disabled = !flashcardsActive;
  nextButton.disabled = !flashcardsActive;
  resetButton.disabled = !flashcardsActive;
}

function splitMeaningIntoAnswerParts(meaning) {
  const cleaned = meaning.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const delimiterPatterns = [/\s*;\s*/, /\s*\|\s*/, /\s+\/\s+/];

  for (const pattern of delimiterPatterns) {
    if (pattern.test(cleaned)) {
      const parts = cleaned.split(pattern).map((part) => part.trim()).filter(Boolean);
      const uniqueParts = dedupeStrings(parts);
      if (uniqueParts.length > 1 && uniqueParts.length <= 3) {
        return uniqueParts;
      }
    }
  }

  return [cleaned];
}

function dedupeStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value);
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function normalizeText(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function shuffleArray(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function arraysEqual(first, second) {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((value, index) => value === second[index]);
}

function deriveRootHint(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) {
    return word;
  }

  const prefix = COMMON_PREFIXES.find(
    (candidate) => cleaned.startsWith(candidate) && cleaned.length - candidate.length >= 3,
  );
  const withoutPrefix = prefix ? cleaned.slice(prefix.length) : cleaned;
  const suffix = COMMON_SUFFIXES.find(
    (candidate) => withoutPrefix.endsWith(candidate) && withoutPrefix.length - candidate.length >= 3,
  );
  const stem = suffix ? withoutPrefix.slice(0, -suffix.length) : withoutPrefix;
  const stableStem = stem.length >= 3 ? stem : cleaned.slice(0, Math.min(cleaned.length, 6));
  return [prefix, stableStem, suffix].filter(Boolean).join(" + ");
}

function prefetchNextQuizQuestion(index) {
  if (index >= quizOrder.length) {
    return;
  }

  const nextEntry = words[quizOrder[index]];
  if (!nextEntry || quizQuestionCache.has(nextEntry.id) || quizQuestionRequests.has(nextEntry.id)) {
    return;
  }

  void getQuizQuestionForWord(nextEntry);
}

function launchBalloons() {
  clearBalloons();
  balloonBurst.replaceChildren();

  for (let index = 0; index < 14; index += 1) {
    const balloon = document.createElement("span");
    balloon.className = "balloon";
    balloon.style.setProperty("--x", `${Math.random() * 100}%`);
    balloon.style.setProperty("--delay", `${Math.random() * 0.35}s`);
    balloon.style.setProperty("--duration", `${2.4 + Math.random() * 1.1}s`);
    balloon.style.setProperty("--size", `${34 + Math.random() * 28}px`);
    balloon.style.setProperty("--drift", `${-60 + Math.random() * 120}px`);
    balloon.style.setProperty("--hue", `${Math.floor(Math.random() * 360)}`);
    balloonBurst.append(balloon);
  }

  balloonBurst.hidden = false;
  balloonBurst.classList.add("is-active");
  balloonCleanupId = window.setTimeout(clearBalloons, 2600);
}

function clearBalloons() {
  if (balloonCleanupId !== null) {
    window.clearTimeout(balloonCleanupId);
    balloonCleanupId = null;
  }

  balloonBurst.classList.remove("is-active");
  balloonBurst.hidden = true;
  balloonBurst.replaceChildren();
}

function initializeTheme() {
  const savedTheme = getStoredTheme();
  const theme = savedTheme || (systemThemeQuery.matches ? "dark" : "light");
  applyTheme(theme, false);
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme, true);
}

function handleSystemThemeChange(event) {
  if (getStoredTheme()) {
    return;
  }

  applyTheme(event.matches ? "dark" : "light", false);
}

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  themeToggleButton.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  themeToggleIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggleLabel.textContent = theme === "dark" ? "Light" : "Dark";

  if (persist) {
    setStoredTheme(theme);
  }
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn("Theme preference could not be saved.", error);
  }
}
