# TikTok TV (TizenBrew module)

Opens TikTok's website full-screen on a Samsung Tizen TV via [TizenBrew](https://github.com/reisxd/TizenBrew) and maps the remote:

| Remote | Action |
|---|---|
| Down / Up (or Next / Prev) | Next / previous video |
| OK (or Play/Pause) | Play / pause, unmutes on first press |
| Right / Left (or FF / Rewind) | Seek ±5 s |
| Back | Close popup, otherwise exit |
| Red | Show usage stats overlay |

Also hides "get the app" banners and skips the login popup.

## Install
TizenBrew → Archive (Module Manager) → **Add GitHub Module** → `Shazamzafar/tiktok-tizen`

## Telemetry
Counters live in the TV's localStorage (`tttv.stats`) and never leave the TV. Press **Red** to view them.
`nav.button` / `nav.scroll` / `navFailed` show which navigation method works, so a TikTok layout change is visible instead of silently breaking.
