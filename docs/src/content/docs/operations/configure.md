---
title: Configure uploads
description: The operator settings that cap uploads, images and per-account storage.
---

These settings set the limits contributors meet when they upload photos and files. The [photos
guide](/user-guides/photos/) shows what a contributor sees. Set a value in the root `.env` of the
host. The deployed stack passes it to the API, and each setting falls back to the deployed stack's
default below when unset. See [Secrets and rotation](/operations/secrets/) for where each kind of
setting lives.

## Request and file size

| Variable                  | Default | Range | What it caps                                              |
| ------------------------- | ------- | ----- | --------------------------------------------------------- |
| `MAX_FILE_UPLOAD_SIZE_MB` | 50      | 1-500 | One research or scientific file, and every multipart body |

Keep the image size caps at or under this value. The request-size middleware caps every multipart
body at it.

## Image caps by role

Each image is also at most 10 000 px on its longest side, and 50 MP in total. The server enforces
the same caps on every upload. The app reads them from `/users/me` and fits photos before it
uploads.

| Variable                       | Default                  | Range                | Role          |
| ------------------------------ | ------------------------ | -------------------- | ------------- |
| `MAX_IMAGE_UPLOAD_SIZE_MB`     | 10                       | 1-100                | `contributor` |
| `MAX_IMAGE_UPLOAD_PIXELS`      | 12 582 912 (4096 × 3072) | 1 000 000-50 000 000 | `contributor` |
| `MAX_IMAGE_UPLOAD_SIZE_LAB_MB` | 20                       | 1-100                | `lab`         |
| `MAX_IMAGE_UPLOAD_PIXELS_LAB`  | 24 000 000               | 1 000 000-50 000 000 | `lab`         |

The contributor default fits every 12 MP phone photo untouched. The lab default fits 24 MP photos.

## Account quotas by role

| Variable                           | Default | Range       | Role          |
| ---------------------------------- | ------- | ----------- | ------------- |
| `MAX_UPLOAD_FILES_PER_USER`        | 5000    | 1-100 000   | `contributor` |
| `MAX_UPLOAD_BYTES_PER_USER_MB`     | 3072    | 1-1 000 000 | `contributor` |
| `MAX_UPLOAD_FILES_PER_LAB_USER`    | 20 000  | 1-100 000   | `lab`         |
| `MAX_UPLOAD_BYTES_PER_LAB_USER_MB` | 51 200  | 1-1 000 000 | `lab`         |

The lab value may not be below the contributor value. The backend refuses to start otherwise. An
upload over either quota is rejected. Deleting media frees quota, and images count at the size
they are stored at.

## Malware scanning

Scanning is on by default in the deployed stack: `MALWARE_SCAN_ENABLED` is `true`, and the stack
starts ClamAV on the private `scanning` network (see
[Deployment topology](/operations/deployment/#network-segmentation-policy)). The backend rejects
flagged files. Set `MALWARE_SCAN_ENABLED=false` only as an accepted risk: uploads are then stored
unscanned.

## What the backend always does

- It checks type, size and content before it stores a file.
- It unpacks and inspects office files.
- It turns each photo upright and removes GPS position, serial numbers, author and comments.
