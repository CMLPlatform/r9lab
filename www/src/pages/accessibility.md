---
layout: ../layouts/ContentLayout.astro
title: Accessibility statement
description: What R9lab does for accessibility, what is known to be wrong, and how to tell us about a barrier.
intro: This statement covers the R9lab website (r9lab.io), the documentation site (docs.r9lab.io) and the web app (app.r9lab.io). The R9lab team at Leiden University, CML, is responsible for it.
---

<!-- The public accessibility statement. Leiden University is a public body and, for sites it
runs, the EU Web Accessibility Directive (EN 301 549) applies. Every fact must stay checkable in
the repository (axe tags in e2e/helpers.ts, the contrast unit tests, the target-size rules).
When a gap closes, move its bullet from "Known problems" to "How we check" in the same pull
request. CONTACT_EMAIL is filled in from the site config by ContentLayout.astro. -->

## Using R9lab

You should be able to:

- Read the text in the light and the dark theme. Text colours are checked for a 4.5:1 contrast ratio.
- Use buttons, links and icon controls of at least 24 by 24 CSS pixels, or with equivalent spacing.
- Turn off motion: animations follow your operating system’s “reduce motion” setting.

We have not yet recorded a full check by keyboard alone or with a screen reader, so we do not promise those.

## How accessible R9lab is

We aim to meet WCAG 2.2, level AA. Conformance with it is **not assessed**: no one has checked R9lab against every criterion. The checks listed below cover part of them. This is a self-assessment by the people who build R9lab, not an audit. R9lab is in English only.

R9lab is pronounced “Relab”. Screen readers may read the name as “R nine lab”.

## Known problems

- The endpoint lists in the API reference on the documentation site scroll, but nothing in them takes keyboard focus. This is the third-party viewer we use (Scalar). Instead, read the raw OpenAPI schema, for example `/api/schemas/openapi.public.json` on the documentation site. We do not control the viewer and no fix is planned. (2.1.1 Keyboard)
- One MCP link in that viewer is smaller than 24 by 24 CSS pixels. It is the same viewer, so we cannot change it. Instead, open the link from the surrounding text. No fix is planned. (2.5.8 Target Size)

### Content we don’t control

- Videos are embedded from YouTube. You may find they have no captions or the wrong ones, because the person who published each video decides. Instead, look for the same material in the documentation. No fix is planned. (1.2.2 Captions)

## Tell us about a problem

Email [CONTACT_EMAIL](mailto:CONTACT_EMAIL), or open an issue on [GitHub](https://github.com/CMLPlatform/r9lab/issues). Please give the page you were on, what went wrong, and the browser and assistive technology you used. We reply within 10 working days. If you need any content in another format, ask and we will provide it.

## How we check

Automated checks use axe, a testing tool, against the level A and AA rules for WCAG 2.0, 2.1 and 2.2. They run in Chromium and cover these screens. The website and web app scans run on every pull request; the documentation scan runs locally with `just docs/test-e2e`, outside the pull request checks.

- Website: the landing page in both themes, the privacy, terms and accessibility pages ([landing.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/www/e2e/landing.spec.ts), [accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/www/e2e/accessibility.spec.ts)).
- Documentation site: the home page in both themes, the getting-started guide, two architecture pages, and the page around each API reference. The API reference viewer itself is left out because it is third-party ([accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/docs/e2e/accessibility.spec.ts)).
- Web app: the product list, a product page and the account screen. These report only serious and critical findings, and colour contrast is not part of this scan. The sign-in, onboarding and other screens are not scanned ([accessibility.spec.ts](https://github.com/CMLPlatform/r9lab/blob/main/app/e2e/accessibility.spec.ts)).

Other checks: unit tests on the app’s colour pairs, and on the app a test that keyboard focus paints a visible indicator. Linting runs on every pull request.

Automated tools find only part of the problems. Two criteria have no automated rule and no recorded check: 2.4.11 Focus Not Obscured, and 2.4.13 Focus Appearance outside the app. Nobody has yet worked through R9lab by keyboard alone or with a screen reader.

## Tested with

- Chromium with axe: website, documentation site and web app.
- Firefox and WebKit: only the smoke tests, with no assistive technology. VoiceOver, TalkBack, NVDA and JAWS are untested.

R9lab relies on HTML, CSS, JavaScript and WAI-ARIA. The web app is built with React Native for the web.

## About this statement

Prepared: 11 October 2026

Last reviewed: 22 October 2026

Next review by: 22 October 2027

Method: self-assessment by the developer.
