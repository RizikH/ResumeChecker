// Resume Match — popup window
//
// The popup is built again from nothing every time it opens, so anything the
// user typed a moment ago is already gone. Storage is the only memory. This
// file reads it, picks a screen, and saves what the user enters.
//
// It never contacts Anthropic itself. That happens in background.js, so a
// check that is still running survives the popup being closed.

// ---------- Constants ----------

const KEYS = {
  apiKey: "apiKey",
  resume: "resume",
};

// Storing a file makes it about a third larger, and the browser allows the
// extension roughly 10MB in total. 5MB is far more than a resume needs.
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
  resumeSaved: document.getElementById("resume-saved"),
  changeKey: document.getElementById("change-key"),

  // screen 3
  result: document.getElementById("state-result"),
  errorTitle: document.getElementById("error-title"),
  errorDetail: document.getElementById("error-detail"),
  fixKey: document.getElementById("fix-key"),
  openSettings: document.getElementById("open-settings"),
  rerun: document.getElementById("rerun"),
  reset: document.getElementById("reset"),
};

// A check still marked "running" after this long was interrupted before it
// could save anything, so waiting on it would mean waiting forever.
const STALE_PENDING_MS = 2 * 60 * 1000;

// Which job this popup is showing, so results for other jobs are ignored.
let currentJobKey = null;

// ---------- Storage helpers ----------

// Storage hands back an object with the name inside it rather than the value
// on its own. These two unwrap that.
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

// The parts of a web address that actually name a job. Everything else in a
// job site's address changes from visit to visit, so keeping it would stop a
// saved result from ever being recognised again.
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

async function getJobFromActiveTab(tab) {
  try {
    if (!tab?.id) return null;

    // Readability has to be loaded into the page before the reader that
    // uses it runs.
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
    // Browsers block extensions from reading their own settings pages, the
    // add-on store, and the built-in PDF viewer. None of those are job
    // pages, so this is expected rather than a real failure.
    console.warn("Could not read the page:", error.message);
    return null;
  }
}

// ---------- Rendering the result ----------

// The result is built one element at a time and inserted as plain text,
// never as markup. The wording comes from a stranger's job posting, and this
// page holds the user's API key.
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

  // Only offered when the key is the actual problem. The saved key is left
  // alone either way: a cancelled key or an empty account isn't fixed by
  // making someone retype what they already had.
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

  // Not waited on: the answer arrives through storage, and waiting here would
  // only report a failure if the connection dropped while the check was
  // running perfectly well.
  chrome.runtime.sendMessage({ type: "RUN_MATCH", jobKey, jobText }).catch(() => {
    renderError("Couldn't start the check. Try again.");
  });
}

// Results are saved to storage rather than sent back directly, so watching
// storage covers both cases with one piece of code: the popup stayed open, or
// it was closed and reopened while the check was still running.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.runs || !currentJobKey) return;
  renderRun(changes.runs.newValue?.[currentJobKey]);
});

// ---------- Screen 2 helpers ----------

// Shown on first run and again from Settings. Coming from Settings the user
// needs to see what is already saved, or the empty fields look like nothing
// was ever stored.
function showResumeScreen(resume) {
  if (resume?.kind === "pdf") {
    el.resumeSaved.textContent = `Saved: ${resume.name}. Upload or paste to replace it.`;
    el.resumeSaved.classList.remove("hidden");
  } else if (resume?.kind === "text") {
    el.resumeSaved.textContent = "Saved as pasted text. Edit below to replace it.";
    el.resumeSaved.classList.remove("hidden");
    el.resumeText.value = resume.text;
  } else {
    el.resumeSaved.classList.add("hidden");
  }

  showScreen("screen-resume");
}

// ---------- Router ----------

// The screen shown depends only on what is saved, so calling this again after
// any change always lands on the right one.
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
    showResumeScreen(null);
    return;
  }

  showScreen("screen-main");
  showState("state-loading");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const runs = (await read("runs")) ?? {};

  // The web address alone is enough to name the job, so a saved result can be
  // shown without reading the page at all — which is what happens whenever
  // someone reopens a posting they already checked.
  if (tab?.url) {
    const cached = runs[normalizeJobKey(tab.url)];
    if (cached?.status === "done") {
      currentJobKey = normalizeJobKey(tab.url);
      renderResult(cached);
      return;
    }
  }

  const job = await getJobFromActiveTab(tab);

  if (!job) {
    showState("state-nojob");
    return;
  }

  currentJobKey = normalizeJobKey(job.url);
  const existing = runs[currentJobKey];

  // On sites that swap jobs without reloading, the address the browser
  // reports can lag behind the job actually on screen — so this is checked
  // again using the address the page itself reported.
  if (existing?.status === "done") {
    renderResult(existing);
    return;
  }

  // Already running, so wait for it to finish — unless it was interrupted,
  // in which case no answer is coming and it has to start again.
  if (existing?.status === "pending") {
    const stale = Date.now() - existing.updatedAt > STALE_PENDING_MS;
    if (!stale) return;
  }

  startMatch(currentJobKey, job.text);
}

// ---------- Screen 1: API key ----------

async function saveApiKey() {
  clearError(el.apiKeyError);

  const key = el.apiKeyInput.value.trim();
  if (!key) {
    showError(el.apiKeyError, "Enter your API key to continue.");
    return;
  }

  // Nothing beyond "not empty" is checked, because proving a key works means
  // spending a request. A bad one is caught on the first check instead.
  await write(KEYS.apiKey, key);
  el.apiKeyInput.value = "";
  await route();
}

// ---------- Screen 2: resume ----------

// Reading a file gives back a string that starts with a short prefix
// describing it. Only the part after the first comma is the file itself.
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      if (base64) resolve(base64);
      else reject(new Error("That file couldn't be read."));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

const DROPZONE_PROMPT = "Click to upload a PDF";

function rejectFile(message) {
  el.resumeFile.value = "";
  el.dropzoneLabel.textContent = DROPZONE_PROMPT;
  showError(el.resumeError, message);
}

function onFileChosen() {
  clearError(el.resumeError);

  const file = el.resumeFile.files[0];
  if (!file) {
    el.dropzoneLabel.textContent = DROPZONE_PROMPT;
    return;
  }

  // Depending on the computer and how the file was made, a PDF sometimes
  // arrives with no type attached. Falling back to the file name avoids
  // telling someone their PDF isn't a PDF.
  const looksLikePdf =
    file.type === "application/pdf" ||
    (!file.type && file.name.toLowerCase().endsWith(".pdf"));

  if (!looksLikePdf) {
    rejectFile("That's not a PDF. Paste the text instead.");
    return;
  }

  // An empty file saves fine and then fails much later, as a confusing
  // error no one would connect back to the upload.
  if (file.size === 0) {
    rejectFile("That file is empty.");
    return;
  }

  if (file.size > MAX_PDF_BYTES) {
    rejectFile("That file is too large. Keep it under 5MB.");
    return;
  }

  el.dropzoneLabel.textContent = file.name;
}

async function saveResume() {
  clearError(el.resumeError);

  const file = el.resumeFile.files[0];
  const text = el.resumeText.value.trim();

  // A chosen file wins over pasted text, because the PDF keeps its layout
  // and gives a better match.
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
      // Catches an unreadable file and a full storage area alike. The second
      // would otherwise fail with nothing shown at all.
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
el.openSettings.addEventListener("click", async () => {
  showResumeScreen(await read(KEYS.resume));
});

// Forget the saved result and check the page again. The clearing is asked of
// background.js rather than done here, so that every change to saved results
// happens in one place and two of them can't collide.
el.rerun.addEventListener("click", async () => {
  if (!currentJobKey) return;

  try {
    await chrome.runtime.sendMessage({
      type: "CLEAR_RUN",
      jobKey: currentJobKey,
    });
  } catch (error) {
    renderError("Couldn't start the check. Try again.");
    return;
  }

  await route();
});

// ---------- Reset ----------

// Erasing the key and resume is the one thing here that cannot be undone, and
// the button sits beside two that get pressed all the time. So the first
// click only readies it; waiting a few seconds cancels.
const RESET_CONFIRM_MS = 4000;
let resetTimer = null;

function disarmReset() {
  clearTimeout(resetTimer);
  resetTimer = null;
  el.reset.textContent = "Reset";
  el.reset.classList.remove("confirming");
}

el.reset.addEventListener("click", async () => {
  if (!resetTimer) {
    el.reset.textContent = "Tap again to erase everything";
    el.reset.classList.add("confirming");
    resetTimer = setTimeout(disarmReset, RESET_CONFIRM_MS);
    return;
  }

  disarmReset();
  await chrome.storage.local.clear();

  // Without this, a result still arriving for the job that was open a moment
  // ago would be drawn onto a freshly cleared popup.
  currentJobKey = null;

  // Nothing is saved now, so this lands on the API key screen on its own.
  await route();
});

route();
