---
title: Roadmap
description: Research and platform priorities for the next R9lab phases.
---

Reviewed: 2026-10

## Research direction

The main question is how to make product data collection more scalable, collaborative, and reusable.
R9lab focuses on open, FAIR product-level disassembly data. Automation stays
human-verified: software can suggest, people confirm.

This page covers the next year, to October 2027. It is a plan, not a promise, and it changes as the
research needs change. The live work list is tracked in the public
[GitHub issues](https://github.com/CMLPlatform/r9lab/issues), released work is in the
[changelog](https://github.com/CMLPlatform/r9lab/blob/main/CHANGELOG.md), and
[GOVERNANCE.md](https://github.com/CMLPlatform/r9lab/blob/main/GOVERNANCE.md) says who decides what
goes here.

## Near term

Work planned for the coming months.

- [ ] improve the data collection guides and keep the rest of the docs current
- [ ] strengthen tests, especially around component hierarchies
- [ ] simplify CSV and JSON export from live records toward dataset releases
- [ ] improve admin and reference-data maintenance workflows
- [ ] make camera-assisted capture easier to operate in repeated lab workflows
- [ ] separate the material taxonomy from the product taxonomy: Ashby's material classes as
  reference data, CPV for products only, before the bill-of-materials picker and the material
  filter build on it ([#163](https://github.com/CMLPlatform/r9lab/issues/163))
- [ ] re-apply account and upload erasures after a backup restore, so a restored snapshot
  stays in step with the deletions made since it was taken (added 2026-10-08)

## Later

Work planned within the year, after the near-term items.

- [ ] publish curated, versioned dataset releases separate from the live database, with stable
  identifiers and documented scope and licensing
- [ ] improve API guidance and exports for analysis scripts, reproducible research, and LCA work
- [ ] explore human-verified assistance for label reading, component suggestion, and quality
  control, with provenance records for assisted values
- [ ] make reference-data search multilingual and meaning-based: embedding search over categories
  and product types next to the current full-text and fuzzy matching (accent-insensitive since
  2026-09)
  - pin a self-hosted multilingual model (bge-m3 is the first candidate) rather than a hosted
    one whose output can change under us
  - store the model id with each vector, so a model change forces a full re-embed instead of
    mixing vectors from two models
- [ ] explore interoperability with semantic vocabularies and Digital Product Passport identifiers
  - first candidate: [CEON](https://arxiv.org/abs/2606.02253), the Circular Economy Ontology
    Network (CC BY 4.0), which separates a product model from a physical item and follows the
    ISO 59040 Product Circularity Data Sheet; map products and components onto its product and
    material modules for the JSON-LD export

## Not planned

- automation that writes records without a person confirming them
- third-party analytics, tracking, or advertising scripts in the app or sites
- closed or paid access to the research data: public records and dataset releases stay openly
  licensed
