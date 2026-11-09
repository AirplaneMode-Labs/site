# Airplane Mode Labs brand

Canonical logo files for the organisation. Other repos copy from here; do not redraw the mark.

## Files

| File | Use |
|---|---|
| `airplanemode-labs-horizontal.svg` / `.png` (1280×320) | Headers, README banners, slides |
| `airplanemode-labs-square.svg` / `.png` (1000×1000) | GitHub organisation avatar, social cards |
| `airplanemode-labs-mark.svg` / `.png` | The toggle mark alone, transparent background, for inline use next to text |
| `airplanemode-labs-icon.svg` | The mark on a rounded ink tile; source for every icon below |
| `icons/icon-16/32/48/180/192/512.png`, `icons/favicon.ico` | Favicons, Apple touch icon, PWA icons |

The two `airplanemode-labs-*.svg` originals carry a C2PA provenance manifest in `<metadata>`; the
derived files do not.

## Colours

| Token | Hex | Where |
|---|---|---|
| Online blue | `#2F6BFF` | Left half of the toggle (cloud side) |
| Airplane purple | `#4B1FC4` | Right half of the toggle (offline side) |
| Labs violet | `#7B3FF2` | "LABS" wordmark, links, accents |
| Mode orange | `#FF9F0A` | Toggle knob |
| Star yellow | `#FFC400` | Small accent dot |
| Ink | `#0E1330` | "AirplaneMode" wordmark, dark tile, body text on light |
| White | `#FFFFFF` | Cloud, airplane, dots |

## Type

Wordmark: Inter 700 for "AirplaneMode", Inter 500 with wide tracking for "LABS". Fallback Helvetica,
Arial, sans-serif. Sites and demos should load no remote fonts; use the system stack with Inter when
installed.

## Rules

- Keep the toggle proportions; never recolour the halves or move the knob to the blue side (the knob
  on the purple side is the point: airplane mode on).
- Minimum clear space around the mark: half the toggle height.
- On dark backgrounds use the mark or the icon tile; the wordmark PNGs are for light backgrounds.
- Logos are licensed with the site repo (Apache-2.0 for code; the brand assets may be used to refer to
  Airplane Mode Labs and its projects, not to imply endorsement).
