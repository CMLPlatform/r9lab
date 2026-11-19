---
title: Record materials
description: Note what a product or component is made of, with quantities, as a bill of materials.
---

A bill of materials lists the materials in a product or component, each with a quantity. It is
what makes records comparable across products.

## What you need

- A product or component record.
- A weight for each material, or a good estimate marked as one.
- Evidence for the material: a label, a marking such as `>PP<`, or a test.

## Steps

1. Open the record and choose **Properties**.
1. Read the **Materials** list. It shows each material and its quantity.
1. To add or change a quantity, use the API: `/v1/products/{id}/materials` for a base product
   and `/v1/components/{id}/materials` for a component. The [API guide](../api/) shows how.

The app shows the bill of materials but does not edit it yet.

![The Properties section of a cordless drill record. It lists the weight and size, then Materials with copper, lithium-ion cells and polypropylene, each with a quantity in kilograms.](/images/guides/product-materials.webp)

*Example record with illustrative values.*

## What good data looks like

- Materials come from the shared list. If none fits, leave it out rather than pick the closest.
- Quantities are in the unit shown, usually kilograms.
- Uncertain materials say so in the notes, such as "Likely polypropylene, unconfirmed".
- A measured quantity is not mixed up with an estimate. Say which one it is.

## Next

[Take and upload photos](../photos/) that back up your notes.
