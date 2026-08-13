# Store listing copy

Paste-ready text for the Chrome Web Store and Microsoft Edge Add-ons
dashboards. Both ask for the same things under slightly different names.

Not part of the extension. Kept here so the wording stays consistent between
the two stores and matches the privacy policy — reviewers compare them.

---

## Name

```
Resume Match
```

## Short description / summary

Chrome allows 132 characters, Edge allows 200. This fits both.

```
See how well your resume fits the job posting you're looking at. Runs on your own Claude API key. Nothing leaves your device.
```

## Detailed description

```
Resume Match tells you how well your resume fits the job you're looking at.

Open a job posting, click the icon, and it reads the posting from the page and compares it against your resume. You get a match score and three lists: the requirements you clearly meet, the ones where your experience is thin, and the ones you're missing. Hover any item to see which requirement it came from and what in your resume decided it.

WHAT MAKES IT DIFFERENT

Most resume tools count keywords. This one reads the posting requirement by requirement, notes what in your resume supports each one, and judges on substance — so building REST APIs in .NET counts as C# backend experience even if the posting's exact words never appear in your resume.

YOUR DATA STAYS YOURS

There is no account, no sign-up, and no server of ours. Your resume and API key are stored on your own device. When you check a job, your resume and that job's description are sent to Anthropic to produce the match, and nowhere else. No analytics, no tracking. The Reset button erases everything the extension has saved.

WHAT YOU NEED

An API key from Anthropic, the company that makes Claude. You can create one at console.anthropic.com. The minimum credit purchase is $5.

Each check costs roughly two to four cents on your own key. Checking several jobs in a row costs less, and reopening a job you've already checked costs nothing.

WHERE IT WORKS

Works best on LinkedIn, including when you click between jobs without the page reloading. Also tested on Indeed and Dice, where you may need to press "Check again" after moving to a different posting — those sites often keep the same web address when you switch jobs.

Results are most reliable on a page showing one job. On a page listing many jobs side by side, open the individual posting first.

OPEN SOURCE

The full source is at github.com/RizikH/ResumeChecker, including the privacy policy.
```

## Category

Chrome: **Productivity** → Workflow & Planning
Edge: **Productivity**

## Language

English

---

## Single purpose

Chrome requires this and rejects listings whose stated purpose is broad or
covers several unrelated things. Keep it to one sentence.

```
Resume Match has one purpose: comparing the user's saved resume against the job posting on the page they are viewing, and showing how well they match.
```

---

## Permission justifications

Both stores ask why each permission is needed. Keep these short and literal;
they are checked against what the code actually does.

**storage**
```
Saves the user's API key, resume, and recent match results on their own device. Nothing is stored anywhere else.
```

**activeTab**
```
Reads the job description from the page the user is on, only at the moment they click the extension icon. The extension has no access to any page until that click.
```

**scripting**
```
Runs the code that reads the job description from the current page. Used together with activeTab, only after the user clicks the icon.
```

**Host permission: https://api.anthropic.com/**
```
Sends the resume and job description to Anthropic's API to produce the match, using the user's own API key. This is the only external address the extension can contact.
```

**Remote code**
```
No. All code is included in the package. The only third-party library, Mozilla's Readability, ships as a local file.
```

---

## Data handling disclosures

Answer these consistently with PRIVACY.md. Reviewers do compare them.

| Category | Tick? | Why |
|---|---|---|
| Personally identifiable information | **Yes** | The resume — name, email, phone, address |
| Authentication information | **Yes** | The Anthropic API key is a credential |
| Website content | **Yes** | The job description, read only when the icon is clicked |
| Health, financial, personal communications, location, user activity | No | None are touched |
| Web history | No — but see below | |

| Certification | Answer |
|---|---|
| Sold to third parties | **No** |
| Used or transferred for purposes unrelated to the core function | **No** |
| Used to determine creditworthiness or for lending | **No** |

Under-declaring is the most common reason a listing is rejected, and
over-declaring costs nothing. The resume is plainly personal information, and
the API key is plainly a credential — an extension that asks for one on its
first screen and declares no authentication data reads as an inconsistency.

**Web history is arguable.** The result cache holds up to 20 job posting
addresses with timestamps. It never leaves the device, and it only covers
pages where the user deliberately clicked the icon, so it is a result cache
rather than a record of browsing — which is why it is left unticked. Ticking
it is the safer call if a reviewer ever queries it.

Privacy policy URL — must return a real page, not a 404. Either works:

Direct file on GitHub, no setup needed:
```
https://github.com/RizikH/ResumeChecker/blob/main/PRIVACY.md
```

GitHub Pages, tidier but needs enabling first (repo Settings → Pages →
Deploy from a branch → main → / root):
```
https://rizikh.github.io/ResumeChecker/PRIVACY
```

---

## Screenshots

Both stores want 1280x800 or 640x400. Three are enough:

1. A match result with a good score — the one that sells it
2. The API key screen — shows setup is one step
3. A result with the tooltip visible — shows the reasoning, which is the
   differentiator

The popup is 350px wide, so don't upload a raw capture. Place it on a plain
background at the required size, or screenshot it over a real job posting so
the context is visible.

---

## Before uploading

- Zip the extension folder's **contents**, not the folder itself — manifest.json
  must sit at the root of the archive
- Exclude `.git`, `docs`, `tools`, `README.md`, `PRIVACY.md`, `LICENSE`
- Confirm the version in manifest.json is what you intend; store versions can
  never be reused or rolled back

---

## Search terms (Edge only)

Up to 7, max 30 characters each. Chrome has no equivalent field.

```
resume
job search
resume match
job application
skills gap
resume analyzer
job posting
```

"ATS" is deliberately absent. It is heavily searched, but this extension does
not simulate applicant tracking system parsing — it compares a resume to one
posting. Attracting people expecting something else earns bad reviews faster
than obscurity does. Edge also rejects listings for keyword stuffing and
irrelevant terms.

---

## Edge Add-ons differences

Same package and the same copy, with four differences from Chrome:

- **Registration is free** — no $5 fee.
- **Store logo must be 300x300**: `docs/store/store-logo-300.png`. Chrome takes
  the 128px icon from the package; Edge asks for this separately.
- **Permissions are justified in one field**, not one box per permission. Paste
  the four justifications above as a single block.
- **Visibility is Public or Hidden** — Hidden is Edge's equivalent of Chrome's
  Unlisted.

Screenshots are the same 1280x800 files. Privacy policy URL, single purpose,
description and category are all unchanged.

Dashboard: partner.microsoft.com/dashboard/microsoftedge
