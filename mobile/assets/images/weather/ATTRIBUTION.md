# Weather icon attribution

The PNGs in this directory are rasterized (44/66 px) from the static SVGs
of **Meteocons** by Bas Milius, `fill` style, package
`@meteocons/svg-static@3.0.0-next.10`. Only @2x/@3x densities are vendored —
the @1x set was removed (no modern test device uses it; Metro falls back to
the nearest density).

- Source: https://github.com/basmilius/meteocons
- License: MIT © Bas Milius (see https://github.com/basmilius/meteocons/blob/main/LICENSE)
- Curated subset only (12 of 475+ icons): clear-day, clear-night,
  mostly-clear-day, mostly-clear-night, partly-cloudy-day,
  partly-cloudy-night, overcast, fog, drizzle, rain, snow, thunderstorms.

Regenerate: download `fill/{name}.svg` from
`https://cdn.jsdelivr.net/npm/@meteocons/svg-static@3.0.0-next.10/fill/`
and rasterize at widths 44/66 (square 128 viewBox) into
`{name}@2x.png`, `{name}@3x.png`.
