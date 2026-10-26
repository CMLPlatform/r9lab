---
layout: ../layouts/ContentLayout.astro
title: Accessibility statement
description: What R9lab does for accessibility, what is known to be wrong, and how to tell us about a barrier.
intro: This statement covers the R9lab website (r9lab.io), the documentation site (docs.r9lab.io) and the web app (app.r9lab.io). The R9lab team at Leiden University, CML, is responsible for it.
---

<!-- The public accessibility statement. Leiden University is a public body and, for sites it
runs, the EU Web Accessibility Directive (EN 301 549) applies. Every fact must stay checkable in
the repository (axe tags in e2e/helpers.ts, the contrast unit tests, the target-size rules, the
criterion-by-criterion table in accessibility-assessment.md).
When a gap closes, move its bullet from "Known problems" to "How we check" in the same pull
request. The address mirrors the PUBLIC_CONTACT_EMAIL default in src/config/public.ts (Markdown cannot read config, and set:html is banned); accessibility-statement.spec.ts fails if they differ. -->

## Using R9lab

You should be able to:

- Read the text in the light and the dark theme. Text colours are checked for a 4.5:1 contrast ratio.
- Use buttons, links and icon controls of at least 24 by 24 CSS pixels, or with equivalent spacing.
- Turn off motion: animations follow your operating system’s “reduce motion” setting.
- Zoom to 400%, or use a screen 320 CSS pixels wide, without scrolling sideways to read the text.
- Use the pages and app screens we build with a keyboard alone, with a visible focus outline.

Use the main tasks with a screen reader: the developer has listened to ten of them, listed in the [self-assessment](/accessibility-assessment#screen-reader-pass). Other screens have not been listened to yet.

## How accessible R9lab is

We aim to meet WCAG 2.2, level AA. R9lab is **partially conformant** with it. The parts we build passed every level A and AA criterion we could check on a sample of pages, as the [WCAG 2.2 self-assessment](/accessibility-assessment) shows criterion by criterion. Content from other suppliers fails 1.2.2 Captions, 2.1.1 Keyboard and 2.5.8 Target Size (see below). A screen-reader pass of ten main tasks found no problems; the self-assessment lists them. This is a self-assessment by the people who build R9lab, not an audit. R9lab is in English only.

R9lab is pronounced “Relab”. Screen readers may read the name as “R nine lab”.

## Known problems

We know of no problems in the parts we build ourselves. The ones below are in content from other suppliers.

### Content we don’t control

- The endpoint lists in the API reference on the documentation site scroll, but nothing in them takes keyboard focus. The reference uses Scalar’s viewer, which we do not control. Instead, read the raw OpenAPI schema, for example `/api/schemas/openapi.public.json` on the documentation site. No fix is planned. (2.1.1 Keyboard)
- One MCP link in that viewer is smaller than 24 by 24 CSS pixels, so it can be hard to hit. It is the same Scalar viewer. Instead, zoom in on the page. No fix is planned. (2.5.8 Target Size)
- Videos are embedded from YouTube. You may find they have no captions or the wrong ones, because the person who published each video decides. Instead, look for the same material in the documentation. No fix is planned. (1.2.2 Captions)

## Tell us about a problem

Email [info@r9lab.io](mailto:info@r9lab.io), or open an issue on [GitHub](https://github.com/CMLPlatform/r9lab/issues). Please give the page you were on, what went wrong, and the browser and assistive technology you used. We reply within 10 working days. If you need any content in another format, ask and we will provide it.

## How we check

Automated checks use axe, a testing tool, against the level A and AA rules for WCAG 2.0, 2.1 and 2.2. They run in Chromium and cover these screens. The website and web app scans run on every pull request; the documentation scan runs locally with `just docs/test-e2e`, outside the pull request checks.

- Website: the landing page in both themes, the privacy, terms and accessibility pages ([landing.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/www/e2e/landing.spec.ts), [accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/www/e2e/accessibility.spec.ts)).
- Documentation site: the home page in both themes, the getting-started guide, two architecture pages, and the page around each API reference. The API reference viewer itself is left out because it is third-party ([accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/docs/e2e/accessibility.spec.ts)).
- Web app: the product list, a product page and the account screen. These report only serious and critical findings, and colour contrast is not part of this scan. The sign-in, onboarding and other screens are not scanned ([accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/app/e2e/accessibility.spec.ts)).

Other checks: unit tests on the app’s colour pairs, and on the app a test that keyboard focus paints a visible indicator. Linting runs on every pull request.

Automated tools find only part of the problems. So the developer also checked every level A and AA criterion on a sample of all three sites: keyboard-only walks, zoom and narrow screens, text spacing, contrast in both themes, target sizes, reduced motion, the app’s form errors and its accessibility tree. The [WCAG 2.2 self-assessment](/accessibility-assessment) lists the sample, the method and each result. The developer then listened to ten main tasks with a screen reader, on 26 October 2026.

## Tested with

- Chromium with axe: website, documentation site and web app.
- Chromium, by keyboard and with scripted checks of zoom, spacing, contrast and target size: the self-assessment’s sample, 26 October 2026.
- Firefox and WebKit: only the smoke tests, with no assistive technology. VoiceOver, TalkBack, NVDA and JAWS are untested.

R9lab relies on HTML, CSS, JavaScript and WAI-ARIA. The web app is built with React Native for the web.

## About this statement

Prepared: 11 October 2026

Last reviewed: 26 October 2026

Last tested: 26 October 2026

Next review by: 26 October 2027

Method: self-assessment by the developer.
