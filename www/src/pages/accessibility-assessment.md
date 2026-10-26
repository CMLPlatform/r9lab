---
layout: ../layouts/ContentLayout.astro
title: WCAG 2.2 self-assessment
description: The criterion-by-criterion check of the R9lab website, documentation site and web app behind the accessibility statement.
intro: >-
  This is the check behind the accessibility statement. It covers every level A and AA success criterion of WCAG 2.2 on the website, the documentation site and the web app, and follows the four steps of WCAG-EM, the W3C evaluation method: set the scope, pick a sample, judge each criterion on it, report.
---

<!-- One row per WCAG 2.2 level A and AA criterion; accessibility-statement.spec.ts checks
there are 55. When a row changes, update the totals under "Summary", and the status sentence in
accessibility.md if the change affects it, in the same pull request. -->

- **Date:** 26 October 2026, on production builds of the commit that added this page.
- **Who:** the developer. This is not an external audit.
- **Browser:** Chromium (Playwright’s desktop Chrome profile) at 1280, 640 and 320 px wide, in the light and dark themes.
- **Not done yet:** a screen-reader pass, and Firefox and Safari. Rows that only a screen reader can settle say “Needs screen reader”.

## Sample

- Website: the landing page (with and without live data), the accessibility statement, the privacy and terms pages, and the not-found page.
- Documentation site: the home page, the getting-started and data-collection guides, the system-design page with its diagrams, the public API page around Scalar’s viewer, and the search dialog.
- Web app, against a seeded test backend: sign-in, the first step of creating an account, choosing a username after the first sign-in, the product list with its filters, a product page with its photo viewer and export menu, and the account screen.

## How each criterion was judged

Each verdict rests on something seen in the browser, not on reading the code alone:

- axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules, colour contrast included, in both themes;
- a forward Tab walk of every sampled page, recording each stop’s focus outline and whether anything covered it;
- keyboard-only runs of the app’s tasks: signing in, a sign-up step, filtering, the export menu, the photo viewer and the shortcuts dialog;
- contrast measured by hand where axe could not decide, over the real backgrounds;
- reflow at 320 px, text at 200% (640 px), and the WCAG 1.4.12 text spacing, checking every text box for clipping;
- target sizes measured from bounding boxes, with the spacing and inline exceptions;
- reduced motion emulated, then every running animation listed;
- error messages triggered on purpose in the app’s forms.

Where a failure was found and fixed, the Evidence column names the test that now guards it. Each of those tests failed before its fix.

## Results

Pass: no failure found after a real check. Fail: at least one failure in the sample. N/A: the sample has no content the criterion applies to. Needs screen reader: the parts a browser check can see pass, but the verdict depends on what a screen reader announces. Not tested: not checked yet.

Content from other suppliers is judged in the statement, not here: Scalar’s API viewer on the documentation site and videos embedded from YouTube.

### Perceivable

<div class="table-scroll" role="region" aria-label="Perceivable results" tabindex="0">

| Criterion | Website | Docs | App | Evidence |
| --- | --- | --- | --- | --- |
| 1.1.1 Non-text Content (A) | Pass | Pass | Pass | axe finds no image without a text alternative. Website photographs and the activity chart are described, docs diagrams are drawn in real text, and app photographs are named after the product. Whether each description reads well is for the screen-reader pass. |
| 1.2.1 Audio-only and Video-only (A) | N/A | N/A | N/A | No audio or video of our own. |
| 1.2.2 Captions (Prerecorded) (A) | N/A | N/A | N/A | No video of our own. YouTube videos are covered in the statement. |
| 1.2.3 Audio Description or Media Alternative (A) | N/A | N/A | N/A | No video of our own. |
| 1.2.4 Captions (Live) (AA) | N/A | N/A | N/A | Camera live streams play on YouTube, outside the sample. |
| 1.2.5 Audio Description (AA) | N/A | N/A | N/A | No video of our own. |
| 1.3.1 Info and Relationships (A) | Pass | Pass | Needs screen reader | Landmarks, one level-1 heading per page, ordered heading levels, real lists and labelled fields. Fixed: the app’s sign-up steps drew their question as a headline that was not a heading (`new-account.integration.test.tsx`). |
| 1.3.2 Meaningful Sequence (A) | Pass | Pass | Needs screen reader | Page order matches the visual order and the Tab order follows it. The app’s reading order on the product page needs a screen reader to confirm. |
| 1.3.3 Sensory Characteristics (A) | Pass | Pass | Pass | Instructions name controls by their text, not by shape, colour or place. |
| 1.3.4 Orientation (AA) | Pass | Pass | Pass | Nothing locks the orientation on the web. The portrait lock in the app’s configuration applies to the phone builds only. |
| 1.3.5 Identify Input Purpose (AA) | N/A | N/A | Pass | Fixed: the username field after the first sign-in had no `autocomplete="username"` (`onboarding.test.tsx`). Sign-in and sign-up fields carry username, email and password tokens. The website has no form; the docs only a search box. |
| 1.4.1 Use of Color (A) | Pass | Pass | Pass | Links in running text are underlined in both themes; app errors and filter states are in words. |
| 1.4.2 Audio Control (A) | N/A | N/A | N/A | Nothing plays sound on its own. |
| 1.4.3 Contrast (Minimum) (AA) | Pass | Pass | Pass | axe reports no contrast failure in either theme. Where it could not decide, measured by hand: website hero text over its grid lines at least 5.1:1, diagram labels at least 7.8:1, app sign-up text over the photo backdrop at least 11.3:1. |
| 1.4.4 Resize Text (AA) | Pass | Pass | Pass | At 640 px wide, the width of a 1280 px screen at 200%, nothing is cut off and no page scrolls sideways. |
| 1.4.5 Images of Text (AA) | Pass | Pass | Pass | The only image of text is the R9lab wordmark, a logotype. |
| 1.4.10 Reflow (AA) | Pass | Pass | Pass | At 320 px no sampled page scrolls sideways; on the docs, code blocks scroll inside their own box. Fixed: the statement page was 349 px wide, because a long path in code did not wrap (`responsive.spec.ts`). |
| 1.4.11 Non-text Contrast (AA) | Pass | Pass | Pass | Focus outlines measure 8.0:1 or more in both themes on all three. App text-field borders measure 4.0:1 or more. |
| 1.4.12 Text Spacing (AA) | Pass | Pass | Pass | With the 1.4.12 spacing applied, no text box clips its text. |
| 1.4.13 Content on Hover or Focus (AA) | Pass | N/A | Pass | Fixed: the website chart’s hover readout closed on Escape only when the chart had keyboard focus (`stats.test.ts`). App info tips open on press and close on Escape. The docs show nothing on hover. |

</div>

### Operable

<div class="table-scroll" role="region" aria-label="Operable results" tabindex="0">

| Criterion | Website | Docs | App | Evidence |
| --- | --- | --- | --- | --- |
| 2.1.1 Keyboard (A) | Pass | Pass | Pass | Every control in the Tab walks works from the keyboard, including the website chart (arrow keys), docs search (Ctrl+K), and in the app the filters, export menu (arrow keys), photo viewer, shortcuts dialog, and the account screen’s choices and switches. |
| 2.1.2 No Keyboard Trap (A) | Pass | Pass | Pass | Every Tab walk wrapped back to the first stop. Dialogs and menus close on Escape and return focus to the control that opened them. |
| 2.1.4 Character Key Shortcuts (A) | N/A | Pass | Pass | Docs search opens on Ctrl+K only. The app’s single-key shortcuts can be turned off in its shortcuts dialog. |
| 2.2.1 Timing Adjustable (A) | N/A | N/A | Pass | No time limits in the sample. Outside it, product editing shows “Photo removed” with Undo for 8 seconds; whether a removal can be undone another way is still to check. |
| 2.2.2 Pause, Stop, Hide (A) | Pass | N/A | Pass | The website’s header mark moves with scrolling, not on its own. With reduced motion on, no sampled page runs an animation. |
| 2.3.1 Three Flashes or Below Threshold (A) | Pass | Pass | Pass | Nothing flashes. |
| 2.4.1 Bypass Blocks (A) | Pass | Pass | Pass | Docs have a skip link. The website (three links) and the app (four controls) have header, navigation and main landmarks, and the app moves focus to each screen’s heading. |
| 2.4.2 Page Titled (A) | Pass | Pass | Pass | Each sampled page and screen has its own title. |
| 2.4.3 Focus Order (A) | Pass | Pass | Pass | Focus follows the layout, and dialogs return focus to their opener. On the app’s sign-up steps, focus falls back to the start of the page after Continue; the next Tab reaches the new field. |
| 2.4.4 Link Purpose (In Context) (A) | Pass | Pass | Pass | Every link name read; links that open a new tab say so. |
| 2.4.5 Multiple Ways (AA) | Pass | Pass | Pass | Website: header and footer links. Docs: sidebar and search. App: navigation, search and filters. |
| 2.4.6 Headings and Labels (AA) | Pass | Pass | Pass | Fixed: the screen for choosing a username was headed “Sign in” (`onboarding.test.tsx`). |
| 2.4.7 Focus Visible (AA) | Pass | Pass | Pass | Every stop in every Tab walk painted a 2 px outline, read from the computed style. |
| 2.4.11 Focus Not Obscured (Minimum) (AA) | Pass | Pass | Pass | At 1280 and 320 px no focused control was fully covered by a sticky header, bar or button. |
| 2.5.1 Pointer Gestures (A) | N/A | N/A | Pass | Pinch zoom in the photo viewer has double-tap and the + and − keys; swiping has previous and next buttons. |
| 2.5.2 Pointer Cancellation (A) | Pass | Pass | Pass | Links, buttons and the app’s pressable controls act on release. |
| 2.5.3 Label in Name (A) | Pass | Pass | Pass | Fixed: the website hero’s record link showed “Browse the records” but was named “Browse teardown records in the app” (`HeroTeardown.test.ts`). Every other name contains its visible text. |
| 2.5.4 Motion Actuation (A) | N/A | N/A | N/A | No motion input. |
| 2.5.7 Dragging Movements (AA) | N/A | N/A | Not tested | Panning a zoomed photo in the photo viewer is a drag. Whether there is another way was not checked. |
| 2.5.8 Target Size (Minimum) (AA) | Pass | Pass | Pass | Website header links (29 by 20 px) and docs heading anchors (20 by 29 px) meet the spacing exception, links in text the inline exception. App controls are at least 44 px. |

</div>

### Understandable

<div class="table-scroll" role="region" aria-label="Understandable results" tabindex="0">

| Criterion | Website | Docs | App | Evidence |
| --- | --- | --- | --- | --- |
| 3.1.1 Language of Page (A) | Pass | Pass | Pass | `lang="en"` on every page. |
| 3.1.2 Language of Parts (AA) | Pass | Pass | Pass | All content is in English. |
| 3.2.1 On Focus (A) | Pass | Pass | Pass | Focus alone opens nothing and changes no page. |
| 3.2.2 On Input (A) | Pass | Pass | Pass | The docs theme menu and the app’s filters change content in place and move no focus. |
| 3.2.3 Consistent Navigation (AA) | Pass | Pass | Pass | The header and navigation are the same, in the same order, on every page. |
| 3.2.4 Consistent Identification (AA) | Pass | Pass | Pass | The same function has the same name everywhere. |
| 3.2.6 Consistent Help (A) | Pass | Pass | Pass | Contact and help links sit in the same place on every page: the website footer, the docs header, and the app’s account screen. |
| 3.3.1 Error Identification (A) | N/A | N/A | Pass | Empty, wrong and badly formed input in sign-in and sign-up each gets a message in words, tied to its field and announced as an alert. |
| 3.3.2 Labels or Instructions (A) | N/A | Pass | Pass | The docs search box is labelled. App fields have visible labels, and required ones say so. |
| 3.3.3 Error Suggestion (AA) | N/A | N/A | Pass | Messages say what to change, for example which characters a username may use. |
| 3.3.4 Error Prevention (Legal, Financial, Data) (AA) | N/A | N/A | Pass | Deleting the account asks for confirmation first. Nothing is legal or financial. |
| 3.3.7 Redundant Entry (A) | N/A | N/A | Pass | Sign-up asks for each value once. |
| 3.3.8 Accessible Authentication (Minimum) (AA) | N/A | N/A | Pass | Sign-in works with a password manager, and Google and GitHub sign-in are offered. Two-step codes come from an authenticator app and can be pasted. |

</div>

### Robust

<div class="table-scroll" role="region" aria-label="Robust results" tabindex="0">

| Criterion | Website | Docs | App | Evidence |
| --- | --- | --- | --- | --- |
| 4.1.2 Name, Role, Value (A) | Pass | Pass | Needs screen reader | axe’s ARIA rules pass everywhere. The app’s choices and switches expose their role and checked state; whether each is announced right needs a screen reader. |
| 4.1.3 Status Messages (AA) | Pass | Needs screen reader | Pass | The website’s figures and the app’s product count update in polite live regions; app errors are alerts and confirmations are status messages. The docs search region stayed empty after a search, so whether the result count is announced needs a screen reader. |

</div>

WCAG 2.2 removed 4.1.1 Parsing, so it is not listed.

## Summary

Of the 55 level A and AA criteria, no failure remains in the sample. Six failures were found and fixed, each with a test: 1.3.1, 1.3.5, 1.4.10, 1.4.13, 2.4.6 and 2.5.3.

- Website: 37 pass, 18 do not apply.
- Documentation site: 36 pass, 1 needs a screen reader, 18 do not apply.
- Web app: 44 pass, 3 need a screen reader, 1 is not tested, 7 do not apply.

Next: a screen-reader pass, which may change the rows that say so, and a check of dragging in the photo viewer.
