// Rule-matching tests. No browser required: replicates how Chrome evaluates the
// two dynamic rules, then checks the redirect transform for idempotency.
//
// Run with `npm test`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REDIRECT_REGEX, GUARD_REGEX, buildRules } from "../src/rules.js";
import { DEFAULTS } from "../src/defaults.js";

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
};

// Chrome's declarativeNetRequest matches regexFilter with RE2, which has no
// lookaround and no backreferences. Guard against anyone "improving" these
// patterns with syntax that silently fails to register at runtime.
console.log("RE2 compatibility");
const patterns = [
  ["REDIRECT_REGEX", REDIRECT_REGEX],
  ["GUARD_REGEX", GUARD_REGEX]
];
for (const [name, re] of patterns) {
  check(`${name} uses only RE2-safe syntax`, () => {
    assert.ok(!/\(\?[=!<]/.test(re), "contains lookahead/lookbehind");
    assert.ok(!/\\[1-9]/.test(re), "contains a backreference");
    new RegExp(re); // must at least compile
  });
}

// isUrlFilterCaseSensitive defaults to false, so mirror that with the i flag.
const guard = new RegExp(GUARD_REGEX, "i");
const redirect = new RegExp(REDIRECT_REGEX, "i");

// Chrome resolves `allow` ahead of `redirect`, so the guard wins where both match.
const decide = (url) =>
  guard.test(url) ? "allow"
  : redirect.test(url) ? "redirect"
  : "none";

// ---------------------------------------------------------------------------
// Every Maps navigation is rewritten, anywhere in the world -- there is no
// scoping any more (see README.md for why the earlier "areas" option was
// removed rather than kept as a checkbox that mostly did nothing).
// ---------------------------------------------------------------------------
const cases = [
  ["https://www.google.com/maps", "redirect"],
  ["https://www.google.com/maps/@43.65,-77.90,8z", "redirect"],
  ["https://www.google.com/maps/@43.65,-77.9,8z?hl=en&entry=ttu&g_ep=EgoyMDI2MDgyNi4wIKXMDSoASAFQAw%3D%3D", "redirect"],
  ["https://www.google.com/maps/place/Toronto/@43.6,-79.3,10z/data=!3m1!4b1!4m5!3m4", "redirect"],
  ["https://google.com/maps", "redirect"],
  ["https://maps.google.com", "redirect"],
  ["http://www.google.com/maps/@43.65,-77.90,8z", "redirect"],
  ["https://www.google.com/maps/@51.50,-0.12,12z", "redirect"],
  ["https://www.google.com/maps/@37.77,-122.41,12z", "redirect"],  // San Francisco
  ["https://www.google.com/maps/@35.68,139.69,12z", "redirect"],   // Tokyo, positive lng
  ["https://www.google.com/maps/search/coffee", "redirect"],       // no coordinates at all

  // Already carries gl= -> the guard must stop a second rewrite.
  ["https://www.google.com/maps/@43.65,-77.90,8z?gl=CA", "allow"],
  ["https://www.google.com/maps/@43.65,-77.9,8z?hl=en&gl=CA", "allow"],
  ["https://www.google.com/maps?gl=CA#anything", "allow"],
  ["https://maps.google.com/?gl=GB", "allow"],

  // Look-alikes and unrelated URLs must not match at all.
  ["https://www.google.com/mapsearch", "none"],
  ["https://www.google.com/mapsomething?gl=CA", "none"],
  ["https://www.google.com/mapsearch?gl=CA", "none"],
  ["https://www.google.com/search?q=maps", "none"],
  ["https://www.google.com/", "none"],
  ["https://example.com/maps", "none"],
  ["https://notgoogle.com/maps", "none"],
  ["https://www.google.com.evil.test/maps", "none"],
  ["https://evil.test/?x=https://www.google.com/maps", "none"],

  // gl only in the fragment is not a real region param -> still needs rewriting.
  ["https://www.google.com/maps?a=1#gl=CA", "redirect"],
  ["https://www.google.com/maps?a=1&xgl=CA", "redirect"],
  ["https://www.google.com/maps?foo=gl=CA", "redirect"]
];

console.log("\nRule matching");
for (const [url, expected] of cases) {
  check(`${expected.padEnd(8)} ${url}`, () =>
    assert.equal(decide(url), expected, `got "${decide(url)}"`));
}

// Mirror declarativeNetRequest's queryTransform.addOrReplaceParams so we can
// confirm the redirect settles after exactly one hop.
const applyTransform = (url, key, value) => {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
};

console.log("\nRedirect idempotency");
check("one hop reaches a URL the guard then stops", () => {
  const start = "https://www.google.com/maps/@43.65,-77.90,8z";
  assert.equal(decide(start), "redirect");
  const hop1 = applyTransform(start, "gl", "CA");
  assert.equal(decide(hop1), "allow", `hop1 (${hop1}) must be allowed, not redirected again`);
  assert.equal(applyTransform(hop1, "gl", "CA"), hop1, "transform is not idempotent");
});

check("path data survives the transform untouched", () => {
  const start = "https://www.google.com/maps/place/Toronto/@43.6,-79.3,10z/data=!3m1!4b1";
  const hop1 = applyTransform(start, "gl", "CA");
  assert.ok(hop1.includes("/data=!3m1!4b1"), `path was mangled: ${hop1}`);
});

console.log("\nRule construction");
check("disabled produces no rules", () =>
  assert.equal(buildRules({ enabled: false, region: "CA" }).length, 0));
check("invalid region produces no rules", () => {
  for (const region of ["CAN", "", undefined, "1A"]) {
    assert.equal(buildRules({ enabled: true, region }).length, 0, `region=${region}`);
  }
});
check("enabled produces guard + redirect with unique ids", () => {
  const rules = buildRules({ enabled: true, region: "ca" });
  assert.equal(rules.length, 2);
  assert.equal(new Set(rules.map((r) => r.id)).size, 2);
  const allow = rules.find((r) => r.action.type === "allow");
  const redir = rules.find((r) => r.action.type === "redirect");
  assert.ok(allow.priority > redir.priority, "guard must outrank the redirect");
  assert.equal(
    redir.action.redirect.transform.queryTransform.addOrReplaceParams[0].value,
    "CA",
    "region should be upper-cased"
  );
  for (const r of rules) assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
});

// A missing off-state icon would only surface at runtime, as a failed
// setIcon call the moment someone toggles the extension off.
//
// Two manifests share this one src/ tree (see tools/build.mjs) -- the
// background entry point is spelled differently in each (service_worker vs
// scripts[0]), so every check below is run once per target manifest rather
// than assuming Chrome's shape.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const TARGETS = ["chrome", "firefox"];
const manifest = (target) =>
  JSON.parse(readFileSync(join(ROOT, "manifests", `manifest.${target}.json`), "utf8"));
const backgroundEntry = (m) => m.background.service_worker ?? m.background.scripts[0];

console.log("\nAssets");
for (const target of TARGETS) {
  check(`[${target}] every file the manifest references exists`, () => {
    const m = manifest(target);
    const refs = new Set([
      ...Object.values(m.icons),
      ...Object.values(m.action.default_icon),
      backgroundEntry(m),
      m.action.default_popup
    ]);
    for (const r of refs) assert.ok(existsSync(join(SRC, r)), `missing ${r}`);
  });
}
check("every color icon has a matching -off variant", () => {
  for (const p of Object.values(manifest("chrome").icons)) {
    const off = p.replace(/\.png$/, "-off.png");
    assert.ok(existsSync(join(SRC, off)), `missing ${off}`);
  }
});
check("popup never blocks its render on chrome.storage.sync", () => {
  // A cold storage.sync read can take seconds. The popup must read only from
  // storage.local; storage.sync may appear in background.js migration alone.
  const src = readFileSync(join(SRC, "popup.js"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/api\.storage\.sync/.test(src),
    "popup.js must not call storage.sync");
});
check("migration never runs on the service-worker hot path", () => {
  // migrate() awaits storage.sync; on every wake that delays rule installation,
  // which was shown to leave getDynamicRules() empty during startup.
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(/onInstalled\.addListener\(async \(\) => \{\s*await migrate\(\)/.test(src),
    "migrate() must run from onInstalled");
  assert.ok(!/^\s*init\(\);/m.test(src), "no top-level init() that migrates on every wake");
  assert.ok(/^syncRules\(\);/m.test(src), "top-level wake path must call syncRules directly");
});
check("popup paints synchronously before awaiting storage", () => {
  // chrome.storage.local's first call per session pays a cold-open cost, so the
  // toggle must render from the synchronous localStorage mirror first.
  const src = readFileSync(join(SRC, "popup.js"), "utf8");
  const paint = src.indexOf("readMirror()");
  const read = src.indexOf("store.get(DEFAULTS)");
  assert.ok(paint > -1 && read > -1, "expected both a mirror read and a store read");
  assert.ok(paint < read, "the synchronous mirror render must come first");
});
check("legacy storage.sync read is bounded by a timeout", () => {
  // An unbounded await on storage.sync during service-worker startup can wedge
  // init() forever on a stalled sync backend, so the rules never install.
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(/withTimeout\(\s*api\.storage\.sync\.get/.test(src),
    "api.storage.sync.get must be wrapped in withTimeout");
  assert.ok(!/await\s+api\.storage\.sync\.get/.test(src),
    "no bare awaited api.storage.sync.get");
});
check("background.js does not put the region code on the badge", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(!/setBadgeText\(\{\s*text:\s*[^}]*region/.test(src),
    "region code must not be rendered as badge text");
});

// The regression this suite missed once already: a default that installs rules
// which never match anything a real user navigates to. Assert the shipped
// configuration handles the COMMON case, not just the coordinate-bearing one.
console.log("\nDefault configuration");
check("defaults redirect a plain Maps load", () => {
  const rules = buildRules(DEFAULTS);
  const redir = rules.find((r) => r.action.type === "redirect");
  assert.ok(redir, "default config must install a redirect rule");
  const re = new RegExp(redir.condition.regexFilter, "i");
  for (const url of [
    "https://www.google.com/maps",
    "https://www.google.com/maps/",
    "https://www.google.com/maps/@43.65,-77.90,8z",
    "https://www.google.com/maps/search/coffee",
    "https://maps.google.com/"
  ]) {
    assert.ok(re.test(url), `default config must redirect ${url}`);
  }
});
check("defaults are enabled with a valid region", () => {
  assert.equal(DEFAULTS.enabled, true);
  assert.match(DEFAULTS.region, /^[A-Z]{2}$/);
  assert.equal(buildRules(DEFAULTS).length, 2);
});
check("defaults carry no leftover scope key", () => {
  assert.equal(DEFAULTS.scope, undefined, "the scoping feature was removed");
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
