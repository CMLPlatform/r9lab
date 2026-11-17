# r9lab logo: source & generator

The mark is a **font-derived 9, vertically squished**, so it reads as a loop and as a mirrored "e".
The 9 is Titillium Web 600. The R, l, a and b come from IBM Plex Sans 600. The output SVGs are
self-contained: the glyphs are outlined, so rendering needs no font.
Colours are the Cyanotype palette from [../DESIGN.md](../DESIGN.md): `#1f4c96` light / `#8fb8ff`
dark for the 9 and ring, ink `#16202e` / `#e9eff8` for the letters.

## Generate

Needs [`uv`](https://docs.astral.sh/uv/). Run from this directory:

```sh
uv run --with fonttools --with brotli python3 make_r9lab.py
```

This writes the canonical `../r9lab-*.svg` files directly. Then run `just assets-sync` from the
repo root to regenerate the PNG and `.ico` files and the consumer copies.

## Variants

| File                      | What                                                |
| ------------------------- | --------------------------------------------------- |
| `r9lab-mark.svg`          | the squished 9 alone: favicons, app icons          |
| `r9lab-mark-adaptive.svg` | the mark with a `prefers-color-scheme` style, for browser-tab favicons |
| `r9lab-wordmark.svg`      | pure-text `R9lab` lockup                            |
| `r9lab-logo.svg`          | ringed wordmark: `(R9) lab`, the primary wide logo |
| `r9lab-badge.svg`         | the ringed `(R9)` alone: square avatars (OAuth consent screens, account pictures) |
| `r9lab-og.svg`            | 1200×630 social card (wordmark + tagline)           |

Each has a `-dark` counterpart. `scripts/sync_brand_assets.py` (run by `just assets-sync`) renders
every PNG and `.ico` file from these SVGs: the consumer copies, the `../r9lab-wordmark.png` that the
root README embeds, and the og cards.

The Titillium Web and IBM Plex Sans font subsets (latin) are checked in under `fonts/candidates/`
with their OFL licence texts (`OFL-*.txt`).
