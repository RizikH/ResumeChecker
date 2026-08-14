// Resume Match — reading the job description off the page
//
// extractJobDescription runs inside the web page, not in the popup. The
// browser copies the function across and rebuilds it there, so it cannot see
// anything else in this file — everything it needs is passed in as an
// argument, and only plain data can make the trip.
//
// Readability is loaded into the page just before this runs, which is why it
// can be used here without being imported.

// Sites where the exact part of the page holding the description is known.
// Anything not listed falls back to reading the whole page.
const SITE_RULES = [
  { match: "linkedin.com", selector: '[id^="JobDetails_AboutTheJob_"]' },
];

function extractJobDescription(rules) {
  // Anything shorter than this isn't a job description.
  const MIN_CHARS = 200;
  // Postings run long, and every character here is paid for later.
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

  // Any long page passes a length check — a README, a documentation page, a
  // news article. Job postings are recognisable by the language they use, so
  // pages that read like something else are turned away before a paid check
  // is started.
  //
  // Each group is one idea worded several ways; two different groups have to
  // appear, so a single stray word is not enough.
  function looksLikeJob(text) {
    const groups = [
      /\b(responsibilit|what you.ll do|day to day|in this role)/i,
      /\b(qualification|requirement|must have|nice to have|you.ll need)/i,
      /\b(years? of experience|experience (with|in)|proficien|familiarity with)/i,
      /\b(salary|compensation|pay range|benefits|401\(?k\)?|paid time off)/i,
      /\b(apply|application|candidate|applicant|hiring|recruit)/i,
      /\b(full[- ]time|part[- ]time|contract|internship|remote|hybrid|on[- ]site)/i,
      /\b(we are looking|we're looking|join (our|the) team|about (the|this) role)/i,
      /\b(equal opportunity|eeo|visa|work authorization)/i,
    ];

    return groups.filter((re) => re.test(text)).length >= 2;
  }

  // Readability takes the page apart as it works. It must always be given a
  // copy, never the real page, or the user watches their page fall apart in
  // front of them.
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
    // Start from the known part of the page, then let Readability clear the
    // buttons and layout out of it.
    const scratch = document.implementation.createHTMLDocument("");
    scratch.body.innerHTML = element.innerHTML;
    text = runReadability(scratch);

    // On a short posting Readability sometimes removes too much. The right
    // part of the page was already found, so its plain text will do.
    if (!usable(text)) text = element.innerText;
  } else {
    // Copying and reading the whole page is the slow path, and on a very
    // large page it can freeze the tab. A page that big is not a job
    // posting anyway.
    const MAX_NODES = 15000;
    if (document.getElementsByTagName("*").length > MAX_NODES) return null;

    text = runReadability(document.cloneNode(true));
  }

  if (!usable(text)) return null;

  // A site rule means the exact part of the page holding a job description was
  // found, so the content is trusted. Everything else came from reading a
  // whole page and has to look like a posting before it costs anything.
  if (!element && !looksLikeJob(text)) return null;

  return {
    text: tidy(text).slice(0, MAX_CHARS),
    title: document.title,
    url: location.href,
  };
}
