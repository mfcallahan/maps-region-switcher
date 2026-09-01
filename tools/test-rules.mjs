// Rule-matching tests. No browser required: replicates how Chrome evaluates the
// per-tab guard/redirect rule pair, then checks the redirect transform for
// idempotency.
//
// Run with `npm test`.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REDIRECT_REGEX, GUARD_REGEX, buildTabRules, guardRuleId, redirectRuleId } from "../src/rules.js";
import { DEFAULTS, TAB_DEFAULTS } from "../src/defaults.js";

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
// Every Maps navigation in an enabled tab is rewritten, anywhere in the world
// -- there is no area scoping (see README.md for why the earlier "areas"
// option was removed rather than kept as a checkbox that mostly did nothing).
// The regexes themselves don't know about tabs at all -- tab scoping is a
// `condition.tabIds` on the rule, checked separately below.
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
  assert.equal(buildTabRules({ tabId: 7, ruleIdBase: 1, enabled: false, region: "CA" }).length, 0));
check("invalid region produces no rules", () => {
  for (const region of ["CAN", "", undefined, "1A"]) {
    assert.equal(buildTabRules({ tabId: 7, ruleIdBase: 1, enabled: true, region }).length, 0, `region=${region}`);
  }
});
check("invalid tabId produces no rules", () => {
  for (const tabId of [-1, 1.5, NaN, undefined, null, "7"]) {
    assert.equal(buildTabRules({ tabId, ruleIdBase: 1, enabled: true, region: "CA" }).length, 0, `tabId=${tabId}`);
  }
});
check("invalid ruleIdBase produces no rules", () => {
  for (const ruleIdBase of [-1, 0, 1.5, NaN, undefined, null, "3"]) {
    assert.equal(buildTabRules({ tabId: 7, ruleIdBase, enabled: true, region: "CA" }).length, 0, `ruleIdBase=${ruleIdBase}`);
  }
});
check("enabled tab produces guard + redirect scoped to that tab", () => {
  const tabId = 42;
  const rules = buildTabRules({ tabId, ruleIdBase: 5, enabled: true, region: "ca" });
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
  for (const r of rules) {
    assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
    assert.deepEqual(r.condition.tabIds, [tabId], "rule must be scoped to its tab");
  }
});
check("different rule id bases never collide with each other", () => {
  const a = buildTabRules({ tabId: 3, ruleIdBase: 1, enabled: true, region: "CA" });
  const b = buildTabRules({ tabId: 4, ruleIdBase: 3, enabled: true, region: "GB" });
  const ids = [...a, ...b].map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "rule ids must not collide across bases");
});
check("a base's own guard and redirect ids never collide", () => {
  for (const ruleIdBase of [1, 3, 5, 1000]) {
    assert.notEqual(guardRuleId(ruleIdBase), redirectRuleId(ruleIdBase));
  }
});
// Regression test for a real bug: the first shipped version derived rule ids
// via `tabId * 2` / `tabId * 2 + 1`. declarativeNetRequest rule ids are a
// strict int32 (max 2,147,483,647); on a long-lived Chrome profile, tab ids
// are large enough that doubling one overflows int32, and
// updateSessionRules() rejects the *entire* call with "Invalid type:
// expected integer, found number" -- silently breaking the extension for
// exactly the users who've had Chrome open the longest. Rule ids must never
// be derived from the tab id's magnitude; ruleIdBase comes from a small,
// independent pool instead (see background.js).
check("a very large real tab id never produces an out-of-range rule id", () => {
  const hugeTabId = 2_000_000_000; // valid int32 tab id; tabId*2 would overflow
  const rules = buildTabRules({ tabId: hugeTabId, ruleIdBase: 1, enabled: true, region: "CA" });
  assert.equal(rules.length, 2);
  const INT32_MAX = 2147483647;
  for (const r of rules) {
    assert.ok(Number.isInteger(r.id) && r.id > 0 && r.id <= INT32_MAX,
      `rule id ${r.id} must be a valid positive int32`);
    // The real tab id is used unmodified as the scoping condition -- that's
    // always safe, since Chrome guarantees tab ids themselves fit int32.
    assert.deepEqual(r.condition.tabIds, [hugeTabId]);
  }
});

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
check("the toolbar icon is never recolored -- action.setIcon is not called", () => {
  // Per-tab state is shown via the popup and a badge/title, not by swapping
  // icon files -- the icon must stay whatever the manifest declares, always.
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(!/action\.setIcon\(/.test(src), "background.js must not call action.setIcon");
  const popupSrc = readFileSync(join(SRC, "popup.js"), "utf8");
  assert.ok(!/action\.setIcon\(/.test(popupSrc), "popup.js must not call action.setIcon");
});
check("popup never blocks its render on chrome.storage.sync or storage.local", () => {
  const src = readFileSync(join(SRC, "popup.js"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/api\.storage\.sync/.test(src), "popup.js must not call storage.sync");
  assert.ok(!/api\.storage\.local/.test(src), "popup.js must not call storage.local");
});
check("migration only runs from onInstalled, never at module top level", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(/onInstalled\.addListener\(async \(\) => \{\s*await migrate\(\)/.test(src),
    "migrate() must run from onInstalled");
  assert.ok(!/^\s*migrate\(\);/m.test(src), "no top-level migrate() call outside onInstalled");
});
check("background.js does not put the region code on the badge", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(!/setBadgeText\(\{\s*[^}]*text:\s*[^}]*region/.test(src),
    "region code must not be rendered as badge text");
});
check("every declarativeNetRequest mutation goes through the message handler, not the popup", () => {
  const src = readFileSync(join(SRC, "popup.js"), "utf8");
  assert.ok(!/declarativeNetRequest\./.test(src),
    "popup.js must not call declarativeNetRequest directly");
});

console.log("\nDefault configuration");
check("TAB_DEFAULTS is off with a valid region to pre-fill", () => {
  assert.equal(TAB_DEFAULTS.enabled, false);
  assert.match(TAB_DEFAULTS.region, /^[A-Z]{2}$/);
  assert.equal(buildTabRules({ tabId: 1, ...TAB_DEFAULTS }).length, 0);
});
check("defaults carry no leftover global-rule keys", () => {
  assert.equal(DEFAULTS.scope, undefined, "the scoping feature was removed");
  assert.equal(DEFAULTS.enabled, undefined, "enabled is per-tab now, not a stored default");
  assert.equal(DEFAULTS.region, undefined, "region is per-tab now, not a stored default");
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
