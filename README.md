# Website Tester

Generic Home Assistant app for scheduled website monitoring with Playwright.

## Configuration

Set the target website in the Home Assistant app configuration:

- `website_url` — website to test
- `schedule` — daily time in the configured timezone
- `timezone` — IANA timezone
- `screenshot_mode` — `failures`, `all`, or `none`
- `timeout_minutes` — navigation/test timeout

The target website is not hard-coded into the app source.

## Installation

Add this GitHub repository as a Home Assistant custom app repository:

`https://github.com/danielmessem/websitetester`

Then install **Website Tester**.
