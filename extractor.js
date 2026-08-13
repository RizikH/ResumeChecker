// Resume Match — job description extraction
//
// extractJobDescription runs INSIDE the page, not in the popup. Chrome
// serializes it, ships it across, and rebuilds it there — so it cannot see
// anything declared in this file or in popup.js. Everything it needs arrives
// through arguments, and those must be JSON-serializable.
//
// Readability is injected separately as a file just before this runs, which
// is why it can reference the global without importing it.

// Sites where we know exactly which element holds the description. Anything
// not listed here falls through to whole-page Readability.
const SITE_RULES = [
  { match: "linkedin.com", selector: '[id^="JobDetails_AboutTheJob_"]' },
];

function extractJobDescription(rules) {
  // Below this, whatever we got isn't a job description.
  const MIN_CHARS = 200;
  // Job posts run long and this becomes input tokens later.
  const MAX_CHARS = 15000;

  function tidy(text) {
    return text
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function usable(text) {
    return typeof text === "string" && tidy(text).length >= MIN_CHARS;
  }

  // Readability MUTATES the document it's given — it strips the DOM apart as
  // it works. Callers must hand it a clone or a detached document, never the
  // live page, or the user watches their page disintegrate.
  function runReadability(doc) {
    try {
      if (typeof Readability === "undefined") return null;
      const article = new Readability(doc).parse();
      return article ? article.textContent : null;
    } catch (error) {
      return null;
    }
  }

  const rule = rules.find((entry) => location.hostname.includes(entry.match));
  const element = rule ? document.querySelector(rule.selector) : null;

  let text = null;

  if (element) {
    // Narrow to the known container first, then let Readability strip the
    // buttons and nested spans out of it.
    const scratch = document.implementation.createHTMLDocument("");
    scratch.body.innerHTML = element.innerHTML;
    text = runReadability(scratch);

    // Readability can over-prune a short posting. The selector already got us
    // to the right element, so its plain text is a safe fallback.
    if (!usable(text)) text = element.innerText;
  } else {
    text = runReadability(document.cloneNode(true));
  }

  if (!usable(text)) return null;

  return {
    text: tidy(text).slice(0, MAX_CHARS),
    title: document.title,
    url: location.href,
  };
}
