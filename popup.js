// Resume Match — popup
//
// The popup is rebuilt from scratch every time it opens: no state survives
// closing it, so storage is the only source of truth. This file reads storage,
// decides which screen to show, and writes back what the user enters.
//
// It deliberately makes no network calls. Those live in the service worker so
// that closing the popup mid-request doesn't throw the response away.

// ---------- Constants ----------

const KEYS = {
  apiKey: "apiKey",
  resume: "resume",
};

// chrome.storage.local caps out around 10MB, and base64 inflates a file by
// roughly a third. 5MB of PDF is far more than any resume needs and leaves
// plenty of headroom.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

// ---------- Elements ----------

const el = {
  // screen 1
  apiKeyInput: document.getElementById("api-key-input"),
  apiKeySave: document.getElementById("api-key-save"),
  apiKeyError: document.getElementById("api-key-error"),

  // screen 2
  resumeFile: document.getElementById("resume-file"),
  resumeText: document.getElementById("resume-text"),
  resumeSave: document.getElementById("resume-save"),
  resumeError: document.getElementById("resume-error"),
  dropzoneLabel: document.getElementById("dropzone-label"),
  changeKey: document.getElementById("change-key"),

  // screen 3
  result: document.getElementById("state-result"),
  errorTitle: document.getElementById("error-title"),
  errorDetail: document.getElementById("error-detail"),
  fixKey: document.getElementById("fix-key"),
  openSettings: document.getElementById("open-settings"),
  rerun: document.getElementById("rerun"),
};

// A pending run older than this is assumed dead — the worker was killed
// before it could write anything, so no timeout of its own ever fired.
const STALE_PENDING_MS = 2 * 60 * 1000;

// The job this popup is showing. Set once extraction succeeds; the storage
// listener uses it to ignore results for other jobs.
let currentJobKey = null;

// ---------- Storage helpers ----------

// chrome.storage.local.get resolves to an object keyed by name, not the bare
// value — these unwrap that so callers can just await a value.
async function read(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function write(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---------- Screen switching ----------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("hidden", screen.id !== id);
  });
}

function showState(id) {
  document.querySelectorAll(".substate").forEach((state) => {
    state.classList.toggle("hidden", state.id !== id);
  });
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove("hidden");
}

function clearError(element) {
  element.textContent = "";
  element.classList.add("hidden");
}

// ---------- Reading the active tab ----------

// Query parameters that actually identify a posting. Everything else —
// LinkedIn's tracking junk especially — changes between visits and would stop
// the same job from ever matching its cached result.
const JOB_ID_PARAMS = ["currentJobId", "jk", "gh_jid", "lever-id"];

function normalizeJobKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const kept = new URLSearchParams();

    for (const name of JOB_ID_PARAMS) {
      const value = url.searchParams.get(name);
      if (value) kept.set(name, value);
    }

    const query = kept.toString();
    return url.origin + url.pathname + (query ? `?${query}` : "");
  } catch (error) {
    return rawUrl;
  }
}

async function getJobFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    // Readability first — it has to exist as a global before the extractor
    // that references it runs.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/readability.js"],
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobDescription,
      args: [SITE_RULES],
    });

    return result ?? null;
  } catch (error) {
    // Injection is blocked on edge://, chrome://, the Web Store, and the
    // built-in PDF viewer. Those aren't job pages, so this is a normal
    // outcome rather than a failure worth surfacing.
    console.warn("Could not read the page:", error.message);
    return null;
  }
}

// ---------- Rendering the result ----------

// Everything here is built with createElement and textContent, never
// innerHTML: these strings come from a stranger's job posting by way of a
// model, and this document holds the user's API key.
function addSkillGroup(heading, skills, modifier) {
  if (!skills || skills.length === 0) return;

  const group = document.createElement("div");
  group.className = "skill-group";

  const title = document.createElement("span");
  title.className = "skill-heading";
  title.textContent = heading;
  group.append(title);

  const pills = document.createElement("div");
  pills.className = "pills";

  for (const skill of skills) {
    const pill = document.createElement("span");
    pill.className = `pill ${modifier}`;
    pill.textContent = skill;
    pills.append(pill);
  }

  group.append(pills);
  el.result.append(group);
}

function renderResult(run) {
  el.result.replaceChildren();

  const score = document.createElement("div");
  score.className = "score";

  const value = document.createElement("span");
  value.className = "score-value";
  value.textContent = `${run.score}%`;

  const label = document.createElement("span");
  label.className = "score-label";
  label.textContent = "match";

  score.append(value, label);
  el.result.append(score);

  addSkillGroup("Matched skills", run.matched, "pill-strong");
  addSkillGroup("Weak skills", run.weak, "pill-weak");
  addSkillGroup("Missing skills", run.missing, "pill-missing");

  el.rerun.classList.remove("hidden");
  showState("state-result");
}

function renderError(message, authFailed = false) {
  el.errorTitle.textContent = authFailed
    ? "That API key was rejected."
    : "Something went wrong.";
  el.errorDetail.textContent = message ?? "";

  // Only offered when the key is actually the problem — the stored key is
  // left alone, since a revoked key or exhausted credit isn't fixed by
  // retyping what was already there.
  el.fixKey.classList.toggle("hidden", !authFailed);

  el.rerun.classList.remove("hidden");
  showState("state-error");
}

function renderRun(run) {
  if (!run) return;
  if (run.status === "done") renderResult(run);
  else if (run.status === "error") renderError(run.error, run.authFailed);
}

// ---------- Running a match ----------

async function startMatch(jobKey, jobText) {
  el.rerun.classList.add("hidden");
  el.fixKey.classList.add("hidden");
  showState("state-loading");

  try {
    await chrome.runtime.sendMessage({ type: "RUN_MATCH", jobKey, jobText });
  } catch (error) {
    // The worker failed to start or died before acknowledging. Nothing will
    // ever write a result, so say so rather than spinning.
    renderError("Couldn't start the check. Try again.");
  }
}

// The worker writes results to storage rather than messaging back, so this
// one listener covers both cases: the popup stayed open, or it was closed and
// reopened while the request was in flight.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.runs || !currentJobKey) return;
  renderRun(changes.runs.newValue?.[currentJobKey]);
});

// ---------- Router ----------

// Which screen to show is derived entirely from what's in storage, so this can
// be re-run after any save and it lands in the right place.
async function route() {
  const [apiKey, resume] = await Promise.all([
    read(KEYS.apiKey),
    read(KEYS.resume),
  ]);

  if (!apiKey) {
    showScreen("screen-apikey");
    return;
  }

  if (!resume) {
    showScreen("screen-resume");
    return;
  }

  showScreen("screen-main");
  showState("state-loading");

  const job = await getJobFromActiveTab();

  if (!job) {
    showState("state-nojob");
    return;
  }

  currentJobKey = normalizeJobKey(job.url);

  const runs = (await read("runs")) ?? {};
  const existing = runs[currentJobKey];

  // A finished result renders straight from cache — no request, no spend.
  if (existing?.status === "done") {
    renderResult(existing);
    return;
  }

  // Already running: sit on the spinner and let the storage listener finish
  // it — unless it's stale, which means the worker died without writing
  // anything and nothing is coming.
  if (existing?.status === "pending") {
    const stale = Date.now() - existing.updatedAt > STALE_PENDING_MS;
    if (!stale) return;
  }

  await startMatch(currentJobKey, job.text);
}

// ---------- Screen 1: API key ----------

async function saveApiKey() {
  clearError(el.apiKeyError);

  const key = el.apiKeyInput.value.trim();
  if (!key) {
    showError(el.apiKeyError, "Enter your API key to continue.");
    return;
  }

  // No validation beyond non-empty: confirming a key actually works costs an
  // API request. A bad key surfaces as a 401 on the first match instead.
  await write(KEYS.apiKey, key);
  el.apiKeyInput.value = "";
  await route();
}

// ---------- Screen 2: resume ----------

// FileReader hands back a data URL — "data:application/pdf;base64,JVBERi0..."
// The API wants only the part after the comma.
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function onFileChosen() {
  clearError(el.resumeError);

  const file = el.resumeFile.files[0];
  if (!file) {
    el.dropzoneLabel.textContent = "Click to upload a PDF";
    return;
  }

  if (file.type !== "application/pdf") {
    el.resumeFile.value = "";
    el.dropzoneLabel.textContent = "Click to upload a PDF";
    showError(el.resumeError, "That's not a PDF. Paste the text instead.");
    return;
  }

  if (file.size > MAX_PDF_BYTES) {
    el.resumeFile.value = "";
    el.dropzoneLabel.textContent = "Click to upload a PDF";
    showError(el.resumeError, "That file is too large. Keep it under 5MB.");
    return;
  }

  el.dropzoneLabel.textContent = file.name;
}

async function saveResume() {
  clearError(el.resumeError);

  const file = el.resumeFile.files[0];
  const text = el.resumeText.value.trim();

  // A chosen file wins over pasted text — the PDF is the better input, and
  // the textarea is the fallback for people whose resume is a .docx.
  if (file) {
    try {
      const data = await readFileAsBase64(file);
      await write(KEYS.resume, {
        kind: "pdf",
        name: file.name,
        mediaType: "application/pdf",
        data,
      });
    } catch (error) {
      // Covers both an unreadable file and a storage write that blew the
      // quota — the second one would otherwise fail silently.
      showError(
        el.resumeError,
        error.name === "QuotaExceededError" || /quota/i.test(error.message)
          ? "That file is too large to store. Try a smaller PDF."
          : error.message
      );
      return;
    }
  } else if (text) {
    await write(KEYS.resume, { kind: "text", text });
  } else {
    showError(el.resumeError, "Upload a PDF or paste your resume text.");
    return;
  }

  await route();
}

// ---------- Wiring ----------

el.apiKeySave.addEventListener("click", saveApiKey);
el.resumeFile.addEventListener("change", onFileChosen);
el.resumeSave.addEventListener("click", saveResume);

// Enter should submit the key — it's a single-field screen.
el.apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveApiKey();
});

el.changeKey.addEventListener("click", () => showScreen("screen-apikey"));
el.fixKey.addEventListener("click", () => showScreen("screen-apikey"));
el.openSettings.addEventListener("click", () => showScreen("screen-resume"));

// Drop the cached result and run the whole flow again, re-reading the page.
el.rerun.addEventListener("click", async () => {
  if (!currentJobKey) return;
  const runs = (await read("runs")) ?? {};
  delete runs[currentJobKey];
  await write("runs", runs);
  await route();
});

route();
