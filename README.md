# Maps Region Switcher

A Chrome (MV3) extension that loads Google Maps as it appears in another
country, by setting Google's own `gl` region parameter.

The motivating case: Google Maps renders certain place names, labels, and
other content differently depending on which region it associates with your
view. That variation is Google's own region-dependent behavior, not universal
across regions, so switching the region parameter changes which version you
see -- using Google's own rendering for that region, not a workaround or an
overlay.

## Why this approach?

Google Maps draws basemap labels into a WebGL canvas from vector tiles. There
is no DOM node to rewrite, so the obvious approaches like overlaying a replacement
label or patching the tiles which intersect the feature, won't work (and won't stay
within the Google Maps terms of use).

Setting the region instead produces Google's own rendering with correct font,
halo, placement, line-breaking, at every zoom level, and it keeps working when
Google changes its internals. It also modifies none of Google's content, which
matters for both the Maps terms and store review.

Verified against live Google Maps rendering, 2026-08-30: adding `?gl=<region>`
to a Maps URL changes region-dependent content exactly as Google serves it for
that region, including certain place labels, attribution text, and interface
language, with no additional handling required on the extension's part.

## Install (unpacked)

Run `npm run build` first -- it assembles `dist/chrome/` and `dist/firefox/`
from the shared `src/` tree plus the matching `manifests/manifest.<target>.json`
(see Layout below). Load the built folder, not `src/` directly.

**Chrome**
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select `dist/chrome/`.
4. Pin the extension. The toolbar icon is full color when active, grey when off.

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** and select `dist/firefox/manifest.json`.
3. Pin the extension the same way. This load is temporary -- it's removed on~
   restart, which is expected for local testing. `npm run firefox:run` (via
   `web-ext`) reloads on every save instead of doing this by hand each time.

## Toolbar icon

Clicking the icon opens a small panel whose first control is an on/off toggle;
the region picker sits below it and greys out while the extension is off.

The icon itself carries the state, with no text overlaid on it:

| Icon | Meaning |
| --- | --- |
| Color | On — Maps loads are being given the selected region |
| Grey | Off — the rules are removed and Maps is untouched |
| Color + red `!` | The rules failed to install; hover for the reason |

The error state deliberately keeps the color icon rather than going grey, so
"broken" never looks like "the user switched it off". State is read back from
`chrome.declarativeNetRequest.getDynamicRules()` after every write, so the icon
reflects the rules Chrome actually holds rather than what was intended.

## How it works

Two dynamic `declarativeNetRequest` rules, rebuilt from `chrome.storage.sync`
whenever the popup changes a setting:

| Rule | Priority | Action | Matches |
| --- | --- | --- | --- |
| Guard | 2 | `allow` | Maps URLs that already have `gl=` |
| Redirect | 1 | `redirect` | Any top-level Maps navigation |

The redirect uses `queryTransform.addOrReplaceParams`, so it only ever touches
the query string — Maps keeps its `!`-encoded data in *path* segments, which are
left alone. It applies to every Maps load, everywhere — there is no scoping.

An earlier version restricted the redirect to a small set of hard-coded map
viewports, on the theory that changing `gl` invalidated the basemap tile
cache and caused the map to blank while zooming. Both parts of that turned
out wrong: the blanking happens with the extension disabled too (it's Google
Maps' own rendering), and the scoped rule rarely fired anyway, because Maps is
a single-page app — searching or panning to a new place doesn't produce a new
navigation for a URL-based rule to match. The option was removed rather than
left as a checkbox that mostly did nothing.

The region parameter does still change the basemap tile URLs:

```
no gl:   ...!3i792558794!3m8!2sen!3sus!5e1105!12m4...
gl=CA:   ...!3i792558794!3m7!2sen!5e1105!12m4...
                         ^^^ region field gone
```

That's real and inherent — different labels require different tiles — but it's
a one-time refetch per tile, not the zoom-blanking behaviour above.

The guard rule is the loop protection. Without it we would be relying on Chrome
silently dropping a redirect whose transform yields an identical URL; an
explicit higher-priority `allow` is the deterministic way to stop processing a
request that has already been rewritten.

The region has to be present on the **initial document request**, which is why
this is DNR and not a content script — a content script runs long after the
region has been resolved.

## Testing

After loading unpacked:

1. **Baseline.** Turn the extension off in the popup, open
   `https://www.google.com/maps/@43.65,-77.90,8z`, and note how the map renders.
2. **Effect.** Turn it on (region Canada), reload the same URL, and confirm a
   region-dependent label or attribution detail has changed to match the
   selected region.
3. **No redirect loop.** This is the one failure mode worth checking explicitly.
   Reload the Maps tab several times and navigate between a few places. You must
   never see `ERR_TOO_MANY_REDIRECTS`. Confirm the guard rule is installed by
   running this in the service worker console (`chrome://extensions` →
   *service worker*):

   ```js
   await chrome.declarativeNetRequest.getDynamicRules()
   ```

   Expect two rules, ids `1` and `2`.
4. **Rule matching.** `npm test` — or `node tools/test-rules.mjs` — checks both
   regexes against a corpus of real Maps URL shapes without needing a browser.

Note that Google strips `gl` from the address bar after load (via
`replaceState`). That is cosmetic; the region is already applied. Because Maps
is a single-page app, panning and searching after load keep the region in
memory — only full reloads re-trigger the rule.

## Settings storage

Settings live in `chrome.storage.local`, deliberately not `chrome.storage.sync`.
A cold `storage.sync` read waits on Chrome's account sync engine and can take
several seconds; that latency sat directly in front of the popup's first render,
so the toggle showed no state until it resolved. Three local preferences are not
worth a multi-second popup, so they no longer follow you between devices.

### Popup first paint

`chrome.storage.local` is async, and its first call in a browser session pays
the backing store's cold-open cost, which sat directly in front of the toggle
showing any state.

So the popup keeps a `localStorage` mirror of the settings. localStorage is
synchronous and available to extension pages, so the toggle renders correct in
its first frame and the async read reconciles behind it.

The mirror is written on every save and after every authoritative read, and the
popup is the only writer of settings, so a stale frame would require the store
to change between two opens. It degrades safely: a missing or unreadable mirror
just falls back to the async path.

A `schemaVersion` migration in `background.js` carries values over from the old
sync store on first run after upgrading.

## Known trade-off

`gl` sets your **region**, not one label. Expect other region-dependent
behaviour to change too: the attribution bar switches to the selected country's
terms links, other place names change, and local business results skew
toward that country, and label language follows the region (`gl=MX` renders a
Spanish interface). That is inherent to the mechanism, which is why the popup
exposes an explicit toggle and region picker rather than silently rewriting
every Maps load.

## Publishing notes

- **Permissions** are already minimal: `declarativeNetRequestWithHostAccess`
  (not the broader `declarativeNetRequest`), `storage`, and three narrow host
  patterns. Do not widen these — reviewers weigh it heavily.
- **No remote code, no obfuscation.** The rules are declarative and the source
  ships as-is.
- **Data disclosure:** the extension collects and transmits nothing. Declare it
  that way.
- **Naming and branding:** do not lead the name with "Google" and do not use
  Google logos or brand colours. Describing it as "for Google Maps" is
  nominative use; naming it *Google Maps ...* invites a trademark rejection.
- **Framing.** List this as a general-purpose region switcher, which is what
  it is -- a broad, narrowly-scoped listing described by its mechanism is
  easier for reviewers to evaluate than one built around a single example.

None of the above is legal advice, and Google's terms are Google's to interpret
and enforce.

## Layout

One `src/` tree, shared by both browsers -- `background.js` and `popup.js`
pick `browser` (Firefox) or `chrome` (Chrome) at runtime, so nothing in `src/`
is browser-specific. Only the manifest differs, which is why it lives outside
`src/` as two versions, merged in at build time.

```
src/
  background.js     service worker (Chrome) / event page (Firefox)
  rules.js          rule construction + the two regexes
  defaults.js       default settings and the region list
  popup.html/.js    toolbar UI
  icons/            generated PNGs (color, plus -off grey variants)
manifests/
  manifest.chrome.json    background.service_worker
  manifest.firefox.json   background.scripts + browser_specific_settings
tools/
  build.mjs         assembles dist/chrome/ and dist/firefox/ from the above
  make_icons.py     regenerates both icon sets (stdlib only)
  test-rules.mjs    regex corpus test + manifest/asset checks (both targets)
dist/               build output, gitignored -- run `npm run build`
```

## License

MIT — see [LICENSE](LICENSE).
