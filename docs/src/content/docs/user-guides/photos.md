---
title: Take and upload photos
description: Take photos someone else can check, keep personal details out, and know the upload limits.
---

Photos are the evidence behind a record. A reader should be able to check a name, a material or a
measurement against them.

## What you need

- Good, even light. A window or a lamp beside the work is enough.
- A phone or camera. See [Hardware](../hardware/) for setups.
- A signed-in, verified account. Photos you upload are public.

## Steps

1. Photograph the product as it arrived, before you clean or open it. Keep wear, dirt and damage
   visible.
1. Add a close-up of the model label, next to an overview of the product.
1. Photograph each part and its connections before you detach it, where this is safe.
1. On the record, choose **Add photos** and select the files, or take the photo in the app.
1. Check that each photo sits on the product or component it shows.

For a camera that captures by itself, see [r9cam](../r9cam/).

## What good data looks like

- A photo shows one thing, in focus, with the whole part in frame.
- Each photo is attached to the record it shows.
- Notes keep measurements apart from estimates, and say how you checked a name or material.
- If a study asks for repeat photos, follow its protocol and keep the first capture.

## Keep personal details out

Uploaded records and photos are public. Upload only photos you took yourself and may share. The
[privacy policy](https://r9lab.io/privacy/) and [contributor terms](https://r9lab.io/terms/) say
what that means. The [dataset guide](../../project/dataset/) says which records a curated release
can include.

- Keep faces, address labels, receipts and personal screens out of the frame, including in
  reflections and the background.
- Keep make and model markings.
- Leave out owner details and serial numbers, unless a study protocol asks for them.

R9lab removes identifying metadata from each photo, such as GPS position and serial numbers. It
does not remove what the photo shows. Crop or blur that before you upload. If you are not sure you
may share a photo, leave it out and ask <info@r9lab.io>.

## Files and limits

Use image uploads for display photos. Use file uploads for research documents and scientific
data. Only a lab account sees the "Research files" block on a record it owns. Ask an administrator
if you need the lab role.

| What                 | Accepted types                                                          | Limit                    |
| -------------------- | ----------------------------------------------------------------------- | ------------------------ |
| Images               | `.bmp`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.webp`                        | 10 MiB, 12.6 MP (contributor) |
| Research files       | `.csv`, `.docx`, `.json`, `.md`, `.pdf`, `.pptx`, `.tsv`, `.txt`, `.xlsx` | 50 MiB                   |
| Scientific data      | `.dat`, `.h5`, `.hdr`, `.hdf5`, `.img`, `.nitf`, `.ntf`, `.raw`, `.tif`, `.tiff` | 50 MiB            |

A contributor account holds up to 1000 files and 3 GiB. A lab account holds up to 20 000 files and
50 GiB, and its image caps are 20 MiB and 24 MP. Deleting media frees quota. These are the default
limits; an operator can change them (see [Configure uploads](/operations/configure/)).

The app uploads a photo that fits your caps at full size. A larger photo is scaled down just
enough to fit. A format the server does not accept, such as HEIC from an iPhone, is converted to
JPEG. R9lab checks type, size and content before it stores a file, and turns each photo upright.
