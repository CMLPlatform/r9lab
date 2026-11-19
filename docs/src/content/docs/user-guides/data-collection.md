---
title: Data collection guide
description: Capture a solid R9lab record with clear hierarchy, media, and reference data.
---

A good record captures what the product is, how it comes apart, and the evidence you collected.
Photos and notes are often worth more than a perfectly filled form.

## Before you start

- Make sure you can sign in.
- Prepare a workspace with good lighting and enough room for separated components.
- Gather the tools needed for safe disassembly.
- Decide what you will capture during disassembly and what you will add afterwards.

## Recommended workflow

1. Create a top-level product record for the item you are about to document, such as a cordless
   drill.
1. Add identifying metadata: name, brand, model, and descriptive notes.
1. Record initial media for the intact product.
1. As disassembly progresses, create child records for meaningful components or subassemblies.
1. Attach images, files, measurements, and notes to the most appropriate record level.
1. Link product types, categories, or materials where you are reasonably confident.

The app shows a record's bill of materials (its materials and their quantities) read-only under
Properties. You record quantities through the API, at `/v1/products/{id}/materials` for a base
product and `/v1/components/{id}/materials` for a component.

## When to create a child component

Create a child record when:

- the part is functionally meaningful
- the part has distinct material or circularity relevance
- the part needs its own images or notes
- the part may be useful in later comparison across products

:::tip[A useful rule of thumb]
If you would photograph it separately and write notes about it specifically, it probably deserves
its own record. A battery pack is a component. A single screw usually is not.
:::

## Tips for recording

- Use parent-child product links to represent the physical breakdown of the object.
- Keep free-text notes for uncertainty, unusual joins, damage, or ambiguous materials.
- Use circularity notes for concise observations about recyclability, disassemblability, and
  remanufacturability. Leave them empty when there is no useful observation yet.
- Photograph anything a later reader might want to check.

:::note[Partial is fine]
If you are not sure, say so in the record. "Likely polypropylene, unconfirmed" is more useful than
a guess.
:::

## Good notes often include

- disassembly difficulty
- destructive versus non-destructive steps
- uncertainty about materials
- wear, damage, or contamination
- reasons for modeling decisions made while documenting the product

## Measurements

Physical properties are the item's overall size in centimetres (width, height, depth as it sits in
front of you) and its mass in grams. Enter what you measured. Leave a field empty rather than
typing `0`: empty means "not recorded", zero means a weightless or flat object. Sub-gram masses
(screws, clips) are fine as decimals.

The components list on a record adds up the weights of its components, each times its amount. A
component you weighed counts as a whole; one you did not weigh counts through its own components.
If some components have no weight, the list shows the total as "at least" and says how many are
missing.

The circularity notes ask for three observations. *Disassemblability* is how easily the item comes
apart and whether doing so damages the parts: tools needed, glued or welded joins, and anything you
had to break. *Recyclability* and *remanufacturability* are the same kind of observation about the
materials and the reusable assemblies. Uncertain notes are welcome.

The [Glossary](../glossary/) defines every other term.

## Reference data

Use materials, categories, taxonomies, and product types when they improve consistency. If no entry
fits, leave the field empty rather than picking the closest match.

## Media capture

### Photos someone else can check

- Photograph the product as it arrived, before you clean or open it. Keep wear, dirt and damage
  visible. Note where it came from: repair, reuse, collection or recycling.
- Add a readable close-up of the model label, if there is one, next to an overview of the product.
- Photograph components and their connections before you detach them, where this is safe.
  Attach each photo to the product or component it shows.
- Keep measurements apart from estimates, and say how you checked a name, material or value. A
  software suggestion or a visual guess is not a measurement.

If a study asks for repeat photos, follow its protocol and keep the first capture. Note which
photos show the same item and what changed between them.

### Permission and privacy

Uploaded records and photos are public. Upload only photos you took yourself and may share. The
[privacy policy](https://r9lab.io/privacy/) and [contributor terms](https://r9lab.io/terms/) say
what that means, and the [dataset guide](../../project/dataset/) says which records a curated
release can include.

Keep faces, address labels, receipts and personal screens out of the frame, including in
reflections and the background. Keep make and model markings. Leave out owner details and serial
numbers, unless a study protocol asks for them and says how to share them.

R9lab removes identifying metadata from each photo (see [Upload limits](#upload-limits)), but not
what the photo itself shows. Crop or blur that before you upload. If you are not sure you may
share a photo, leave it out and ask <info@r9lab.io>.

### Attach your files

Attach media in two ways:

- manual upload of files and images
- device-assisted capture through the Raspberry Pi camera integration

Use image uploads for display photos. Use file uploads for research documents and scientific
datasets (hyperspectral ENVI, HDF5, NITF, GeoTIFF); R9lab stores those without image processing.

Every signed-in, verified account can upload images. Only a lab account sees the "Research files"
block on a record it owns. Ask an administrator if you need the lab role.

For the camera integration, see [r9cam integration](../r9cam/).

## Upload limits

Accepted types and size limits:

- Images (size caps by role, below): `.bmp`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp`
- Research files (up to 50 MiB): `.csv`, `.docx`, `.json`, `.md`, `.pdf`, `.pptx`, `.tsv`, `.txt`,
  `.xlsx`
- Scientific data (up to 50 MiB): `.dat`, `.h5`, `.hdr`, `.hdf5`, `.img`, `.nitf`, `.ntf`, `.raw`,
  `.tif`, `.tiff`

R9lab validates type, size, and content before storing a file, and unpacks and inspects office
files. If malware scanning is enabled, flagged files are rejected.

Each image has a size cap set by the role of the account that uploads it. Every image is also at
most 10 000 px on its longest side:

| Role          | Per image | Pixels                |
| ------------- | --------- | --------------------- |
| `contributor` | 10 MiB    | 12.6 MP (4096 × 3072) |
| `lab`         | 20 MiB    | 24 MP                 |

The app uploads a photo within your caps at full resolution. A photo over them is scaled down just
enough to fit, then uploaded; a format the server does not accept, such as HEIC from an iPhone, is
converted to JPEG. The server applies the same caps to every upload. It also turns each photo
upright and removes identifying metadata (GPS position, serial numbers, author, comments) before
storing it.

Each account also has a cap on total file count and storage, set by its role:

| Role          | Files  | Storage  |
| ------------- | ------ | -------- |
| `contributor` | 1000   | 3072 MB  |
| `lab`         | 20 000 | 51200 MB |

An upload over either cap is rejected; deleting media releases its quota. Images count at the
size they are stored at.

## Edit history

Tap the "Last updated" date on a product or component to see its edits, newest first: when each
was made, who made it, and which fields changed. It covers the record's own fields, not photos,
files, components or materials. The history starts with the release that added it, so older edits
are not listed. Edits are kept for two years.

The editor's name follows their profile settings. A correction by a moderator is shown as one,
without the moderator's name. The values an edit left behind are visible only to the owner and the
admins, through the API.

## Final check

- Check that each component sits under the right parent.
- Make sure important images are attached to the right record.
- Add missing notes while the work is still fresh.
- Pick a product type or material from the lists where one fits.
- Keep "unconfirmed" notes as they are. Do not replace them with guesses.
