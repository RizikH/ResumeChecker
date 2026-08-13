// Resume Match — service worker
//
// The only place that talks to api.anthropic.com. It runs independently of the
// popup, so closing the popup mid-request doesn't lose the response — the
// result goes to storage and the popup picks it up whenever it next opens.
//
// The worker is killed when idle, so nothing may live in a module-level
// variable between messages. Anything that matters goes to storage.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const MAX_SKILLS = 8;
const MAX_RUNS = 20;

// A pending run older than this is assumed dead (worker killed, browser
// closed) and may be retried.
const PENDING_TIMEOUT_MS = 2 * 60 * 1000;

// Ceiling on a single request. Generous — adaptive thinking on a long posting
// is not fast — but finite, so a hung connection can't spin forever.
const REQUEST_TIMEOUT_MS = 60 * 1000;

const INSTRUCTION = `Compare the resume against the job description above.

Score 0-100 as an experienced recruiter would judge overall fit for this specific role. Weight requirements the posting treats as essential well above nice-to-haves, and account for seniority and domain. A candidate missing a core requirement should not score highly just because they match many minor ones.

Sort each skill or requirement drawn from the posting into exactly one tier. The tiers measure strength of evidence, nothing else:
- matched: the resume satisfies it. Anything plainly met belongs here, however briefly it is stated.
- weak: partially met — thin, dated, adjacent experience, or short of a stated threshold.
- missing: no support anywhere in the resume, stated or implied.

Requirements are not only skills. Degrees, certifications, years of experience, work authorization, and location are requirements too, and they are usually met outright or not at all. A stated requirement the resume plainly satisfies — a Computer Science degree against "Bachelor's in Computer Science or related field" — is matched. Do not put it in weak merely because it is a credential rather than a skill, or because the resume mentions it in one line. Weak is for genuinely partial evidence: three years against a five-year requirement, or a related degree where a specific one was asked for.

Judge on substance, not keywords. Resumes describe outcomes and leave the obvious unsaid, so infer what the work self-evidently required. Two patterns carry most of this in any field: a named tool implies its category and the skills needed to operate it, and a described responsibility implies the competencies required to discharge it.

Identify the candidate's field first and apply that reasoning using its own conventions. The examples below are illustrations of the principle, not a list of the cases it covers:
- Shipping full-stack web applications means HTML and CSS, listed or not; React or Angular means JavaScript; Postgres means SQL and relational modelling.
- Running a monthly close means reconciliations, journal entries, and working in Excel and a general ledger system.
- Charting in Epic on a hospital floor means EHR documentation, HIPAA handling, and clinical assessment at that unit's acuity.
- Managing a classroom means lesson planning, differentiated instruction, and assessment.
- Owning a campaign end to end means budgeting, analytics, and coordinating the people who executed it.

Treat an inference as matched only when the stated work could not have been done without it. Where something is merely likely rather than necessary — a backend developer probably having touched Docker — put it in weak, not matched, and never in missing. Reserve missing for requirements with no support anywhere in the resume, explicit or implied.

Do not lower the score because the resume omits a term the work plainly demonstrates.

Some requirements are baseline professional literacy rather than specialist skills: Microsoft Office or Google Workspace, email, general computer use, communication, teamwork, time management. Any professional resume implies these, so classify them matched and never missing. The exception is a posting that treats one as specialist — advanced Excel modelling for an analyst role, say — where it is judged on evidence like any other requirement.

Weigh evidence by where it appears, strongest first:
1. Used in described work — a project or role that plainly relied on it. Matched.
2. Necessarily implied by that work, per the inferences above. Matched.
3. Listed in a skills section and consistent with the described work. Matched.
4. Listed in a skills section but absent from every project and role, especially where the work visibly used something else instead. Weak — a claim is not a demonstration, and this is the single most common way a resume overstates.

A technology that is central to the posting and appears only as a skills-list entry is weak, however prominently it is listed.

Cover the posting's required qualifications first, and classify every one of them into a tier — including credentials, degrees, and "familiarity with X" lines. Never silently drop a requirement because it is unremarkable; an unmentioned requirement reads as an oversight. Only once every required qualification is placed should you spend remaining slots on preferred qualifications and responsibilities, in order of importance.

Where an item could reasonably sit in two tiers, choose the one with stronger evidence, and never place something in missing when any support exists — stated, implied, or baseline. Missing means a real gap worth acting on; anything short of that belongs in weak. Apply the same standard to every item in a single run, and to the same requirement across different postings.

Each requirement appears exactly once across all three tiers. If the posting states one requirement several ways, or lists related things in a single line, treat it as one item and place it once. Never let two phrasings of the same requirement land in different tiers.

Return at most ${MAX_SKILLS} items per tier. Use the posting's own terms, kept short enough to read as a tag.`;

const RESULT_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      description: "Overall fit, 0 to 100.",
    },
    matched: {
      type: "array",
      items: { type: "string" },
      description: `Skills clearly demonstrated. At most ${MAX_SKILLS}.`,
    },
    weak: {
      type: "array",
      items: { type: "string" },
      description: `Skills present but thin or adjacent. At most ${MAX_SKILLS}.`,
    },
    missing: {
      type: "array",
      items: { type: "string" },
      description: `Required skills absent from the resume. At most ${MAX_SKILLS}.`,
    },
  },
  required: ["score", "matched", "weak", "missing"],
  additionalProperties: false,
};

// ---------- Storage ----------

async function readRuns() {
  const { runs } = await chrome.storage.local.get("runs");
  return runs ?? {};
}

async function writeRun(jobKey, entry) {
  const runs = await readRuns();
  runs[jobKey] = { ...entry, updatedAt: Date.now() };

  // Evict oldest first so storage doesn't grow without bound.
  const keys = Object.keys(runs);
  if (keys.length > MAX_RUNS) {
    keys
      .sort((a, b) => runs[a].updatedAt - runs[b].updatedAt)
      .slice(0, keys.length - MAX_RUNS)
      .forEach((key) => delete runs[key]);
  }

  try {
    await chrome.storage.local.set({ runs });
  } catch (error) {
    // Quota exceeded, most likely. Drop the cache and keep just this entry
    // rather than losing the result the user is waiting on.
    console.warn("Could not write runs, resetting cache:", error);
    await chrome.storage.local.set({ runs: { [jobKey]: runs[jobKey] } });
  }
}

// ---------- Request building ----------

// The resume is sent as-is: a PDF document block preserves layout, which
// matters because two-column resumes lose their structure when flattened to
// text. Pasted text is the fallback for people whose resume is a .docx.
//
// cache_control goes here and nowhere else. Caching matches on a prefix, and
// the resume is the only part of the request that's byte-identical every
// time — the job description obviously isn't. Checking several postings in
// one sitting reads the cached resume at ~10% of input price instead of
// resending the whole PDF.
//
// Do NOT switch this to the top-level cache_control shorthand: that
// auto-places the breakpoint on the LAST cacheable block, which here is the
// instruction sitting after the job description. Every request would write a
// fresh entry and none would ever be read — strictly worse than no caching.
function resumeBlock(resume) {
  // Default 5-minute TTL, which covers a browsing session. `ttl: "1h"` is
  // available but doubles the write premium, so it only pays off past
  // roughly three checks.
  const cache_control = { type: "ephemeral" };

  if (resume.kind === "pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: resume.mediaType || "application/pdf",
        data: resume.data,
      },
      cache_control,
    };
  }

  return { type: "text", text: `RESUME:\n\n${resume.text}`, cache_control };
}

function buildRequest(resume, jobText) {
  return {
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: RESULT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          resumeBlock(resume),
          { type: "text", text: `JOB DESCRIPTION:\n\n${jobText}` },
          { type: "text", text: INSTRUCTION },
        ],
      },
    ],
  };
}

function describeError(status, body) {
  if (status === 401) return "That API key was rejected. Check it and try again.";
  if (status === 429) return "Rate limited by the API. Wait a moment and try again.";
  if (status === 529) return "The API is overloaded right now. Try again shortly.";
  if (status >= 500) return "The API had a server error. Try again shortly.";
  if (status === 400) {
    console.error("Bad request:", body);
    return "The request was rejected. See the service worker console.";
  }
  return `Request failed (${status}).`;
}

// ---------- The match ----------

async function runMatch(jobKey, jobText) {
  await writeRun(jobKey, { status: "pending" });

  const { apiKey, resume } = await chrome.storage.local.get(["apiKey", "resume"]);

  if (!apiKey || !resume) {
    await writeRun(jobKey, {
      status: "error",
      error: "Missing API key or resume.",
    });
    return;
  }

  // A request that never returns would otherwise leave this run pending
  // forever, and the popup spinning on every open.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Anthropic blocks browser-origin requests unless you opt in. The
        // risk it guards against — shipping a key in a web page — is the
        // tradeoff this extension already made deliberately.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(buildRequest(resume, jobText)),
    });
  } catch (error) {
    await writeRun(jobKey, {
      status: "error",
      error:
        error.name === "AbortError"
          ? "That took too long and was cancelled. Try again."
          : "Couldn't reach the API. Check your connection.",
    });
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text();
    await writeRun(jobKey, {
      status: "error",
      error: describeError(response.status, body),
      // Flagged rather than string-matched, so the popup can offer the key
      // screen without parsing the message.
      authFailed: response.status === 401,
    });
    return;
  }

  const payload = await response.json();

  // cache_read > 0 on the second check of a session means caching is working.
  // If it stays 0 across back-to-back checks, the prefix is being invalidated
  // or the resume is below the model's minimum cacheable size.
  const usage = payload.usage ?? {};
  console.log(
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s — ` +
      `input: ${usage.input_tokens}, ` +
      `cache write: ${usage.cache_creation_input_tokens ?? 0}, ` +
      `cache read: ${usage.cache_read_input_tokens ?? 0}, ` +
      `output: ${usage.output_tokens}`
  );

  // The schema guarantees the shape, but the model still chose the values —
  // clamp and slice rather than trusting the range and length instructions.
  try {
    const block = payload.content.find((item) => item.type === "text");
    const data = JSON.parse(block.text);
    const list = (value) =>
      Array.isArray(value) ? value.slice(0, MAX_SKILLS) : [];

    await writeRun(jobKey, {
      status: "done",
      score: Math.max(0, Math.min(100, Math.round(data.score))),
      matched: list(data.matched),
      weak: list(data.weak),
      missing: list(data.missing),
    });
  } catch (error) {
    console.error("Could not parse response:", payload);
    await writeRun(jobKey, {
      status: "error",
      error: "The response wasn't in the expected format.",
    });
  }
}

// ---------- Messages ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "RUN_MATCH") return;

  (async () => {
    const runs = await readRuns();
    const existing = runs[message.jobKey];

    // A match already in flight shouldn't be fired twice just because the
    // user reopened the popup — that's a second billable request.
    const stillRunning =
      existing?.status === "pending" &&
      Date.now() - existing.updatedAt < PENDING_TIMEOUT_MS;

    if (!stillRunning) {
      await runMatch(message.jobKey, message.jobText);
    }

    sendResponse({ ok: true });
  })();

  // Keeps the message channel open for the async work above.
  return true;
});
