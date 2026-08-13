# Privacy Policy — Resume Match

**Last updated: 13 August 2026**

Resume Match compares your resume against the job posting on the page you're
looking at. It has no servers, no accounts, and no analytics. This policy
describes every piece of data it touches.

## What is stored, and where

Three things are saved in your browser's local extension storage, on your own
device:

- **Your Anthropic API key**, so you don't have to enter it for every check.
- **Your resume**, either as the PDF file you uploaded or as the text you
  pasted.
- **Recent match results** — the score and skill lists for each job you've
  checked, along with the address of that job posting. The most recent 20 are
  kept so that reopening a posting you've already checked doesn't cost you a
  second request.

None of this is transmitted to the developer of this extension. There is no
server operated by this extension to transmit it to.

This data is stored unencrypted, which is standard for browser extensions.
Anyone with access to your computer and your browser profile could read it.
Treat it the way you would treat a password saved in your browser.

## What is sent, and to whom

When you click the extension icon on a job posting, the extension reads the
job description from that page. It then sends **your resume and that job
description** to Anthropic's API, using your API key, and receives the match
result back.

That is the only network request this extension makes, and Anthropic is the
only party it is made to. The extension is technically restricted to that one
destination: it holds permission to contact `api.anthropic.com` and no other
site.

Your API key is sent to Anthropic to authenticate the request, which is its
purpose. It is not sent anywhere else.

### Anthropic's handling of that data

Anthropic processes the request and returns the result. Their treatment of it
is governed by their own policies, not this one:

- Privacy policy: https://www.anthropic.com/legal/privacy
- Commercial terms: https://www.anthropic.com/legal/commercial-terms

One detail worth stating plainly: to reduce cost, the extension asks Anthropic
to temporarily cache your resume so that checking several jobs in a row does
not re-send it each time. This means your resume is held briefly on Anthropic's
systems, for about five minutes after each check, under their policies.

## What is not collected

- No analytics, telemetry, crash reporting, or usage statistics.
- No accounts, sign-ups, or identifiers of any kind.
- No advertising, and no data shared with or sold to third parties.
- No browsing history. The extension can only read a page at the moment you
  click its icon on that page, and it reads nothing until you do.
- Pages you visit without clicking the icon are never read or recorded.

The job description itself is not stored — only the resulting score and skill
lists, and the address of the posting they belong to.

## Keeping and deleting your data

Everything is kept until you remove it. You can:

- **Press Reset** in the extension, which erases the stored API key, resume,
  and all saved results immediately.
- **Uninstall the extension**, which removes all of its stored data.

There is nothing to request from the developer, because the developer never
receives any of it.

## Permissions, and why each is needed

- **Storage** — to save your API key, resume, and recent results on your device.
- **activeTab** — to read the job description from the page you are on, only at
  the moment you click the extension icon.
- **Scripting** — to run the code that reads the job description from that page.
- **Access to `api.anthropic.com`** — to send the match request.

## Children

This extension is intended for job seekers and is not directed at children
under 13.

## Changes

If this policy changes, the updated version will be published at this address
and the date at the top will change.

## Contact

Questions about this policy or the extension: **rhcorelabs@gmail.com**
