# Wisp / Wispa identity

The selected mark is the Labrador profile from concept 01, named for Wispa,
the founder's childhood dog. The hanging ear doubles as a vinyl record.

The production master is `src/Wisp.Client/public/branding/wispa.svg`, a clean
vector trace of the approved concept with transparent cutouts and the existing
Wisp purple (`#aa3bff`). Keep that silhouette consistent across surfaces.

Usage: expanded/collapsed sidebar, Settings header, browser favicon/touch icon,
Windows executable, Photino window/taskbar, installer and installed shortcuts.
The wordmark supplies the accessible name alongside decorative images; the
collapsed sidebar control retains its explicit expand-sidebar label.

To regenerate the checked-in PNG and ICO assets after a master edit:

```powershell
npm ci
npm run build:branding
```

The ICO contains 16, 20, 24, 32, 40, 48, 64, 128 and 256 px RGBA frames. The build
also creates `artifacts/branding/icon-sizes.png` for light/dark visual review.
Generated production assets are checked in so ordinary app/installer builds do
not need the branding toolchain. The original generated concepts and prompts
are kept in `concepts/2026-09-11/` for provenance, not used at runtime.
