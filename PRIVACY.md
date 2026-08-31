# Privacy Policy

**Maps Region Switcher** does not collect, transmit, sell, or share any user
data. This policy explains what the extension stores, why, and where.

## Summary

- No personal data, browsing history, or Maps activity is collected.
- No data is sent to any server -- the extension has no backend.
- No analytics, telemetry, or advertising code of any kind.
- No data is sold or shared with third parties, because none is collected.

## What the extension stores

The extension keeps two small settings in the browser's local extension
storage (`chrome.storage.local` / `browser.storage.local`):

- **Region** -- the country you last selected in the popup (e.g. `CA`, `GB`).
- **Enabled** -- whether region switching is currently turned on.

This storage is local to your own browser profile. It is never synced to a
remote server, never leaves your device, and is not readable by the
extension's developer, by Google, or by any other party. Uninstalling the
extension removes it.

## How the extension works

When enabled, the extension uses the browser's `declarativeNetRequest` API to
rewrite the `gl` query parameter on Google Maps page requests, so Maps loads
using the region you selected. This happens entirely inside the browser using
built-in redirect rules -- the extension does not read, log, or transmit the
pages you visit, your search queries, your location, or any other Maps
activity. See the [README](README.md) for the technical details.

## Permissions

- **`storage`** -- to remember your region and on/off setting between
  browser sessions, as described above.
- **`declarativeNetRequestWithHostAccess`** and the Google Maps host
  permissions (`google.com/maps`, `www.google.com/maps`, `maps.google.com`)
  -- to add or replace the `gl` parameter on Maps page requests. Access is
  limited to those Maps addresses only.

The extension requests no other permissions and does not run on any site
other than Google Maps.

## Remote code

The extension contains no remotely fetched or dynamically loaded code. All
code that runs is packaged inside the extension and reviewed as part of the
Chrome Web Store / Firefox Add-ons submission.

## Children's privacy

The extension does not knowingly collect any data from anyone, including
children, because it does not collect data at all.

## Changes to this policy

If this policy changes, the updated version will be posted in this file and
in the extension's store listings, along with an updated "Last updated" date
below.

## Contact

Questions about this policy can be sent through the developer contact
information listed on the extension's Chrome Web Store and Firefox Add-ons
listing pages.

---
*Last updated: 2026-08-31*
