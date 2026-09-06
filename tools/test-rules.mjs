import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { REDIRECT_REGEX, GUARD_REGEX, buildTabRules, guardRuleId, redirectRuleId, stripRegionParam, isMapsUrl } from "../src/rules.js";
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

console.log("RE2 compatibility");
const patterns = [
  ["REDIRECT_REGEX", REDIRECT_REGEX],
  ["GUARD_REGEX", GUARD_REGEX]
];
for (const [name, re] of patterns) {
  check(`${name} uses only RE2-safe syntax`, () => {
    assert.ok(!/\(\?[=!<]/.test(re), "contains lookahead/lookbehind");
    assert.ok(!/\\[1-9]/.test(re), "contains a backreference");
    new RegExp(re);
  });
}

const guard = new RegExp(GUARD_REGEX, "i");
const redirect = new RegExp(REDIRECT_REGEX, "i");

const decide = (url) =>
  guard.test(url) ? "allow"
  : redirect.test(url) ? "redirect"
  : "none";

const cases = [
  ["https://www.google.com/maps", "redirect"],
  ["https://www.google.com/maps/@43.65,-77.90,8z", "redirect"],
  ["https://www.google.com/maps/@43.65,-77.9,8z?hl=en&entry=ttu&g_ep=EgoyMDI2MDgyNi4wIKXMDSoASAFQAw%3D%3D", "redirect"],
  ["https://www.google.com/maps/place/Toronto/@43.6,-79.3,10z/data=!3m1!4b1!4m5!3m4", "redirect"],
  ["https://google.com/maps", "redirect"],
  ["https://maps.google.com", "redirect"],
  ["http://www.google.com/maps/@43.65,-77.90,8z", "redirect"],
  ["https://www.google.com/maps/@51.50,-0.12,12z", "redirect"],
  ["https://www.google.com/maps/@37.77,-122.41,12z", "redirect"],
  ["https://www.google.com/maps/@35.68,139.69,12z", "redirect"],
  ["https://www.google.com/maps/search/coffee", "redirect"],

  ["https://www.google.com/maps/@43.65,-77.90,8z?gl=CA", "allow"],
  ["https://www.google.com/maps/@43.65,-77.9,8z?hl=en&gl=CA", "allow"],
  ["https://www.google.com/maps?gl=CA#anything", "allow"],
  ["https://maps.google.com/?gl=GB", "allow"],

  ["https://www.google.com/mapsearch", "none"],
  ["https://www.google.com/mapsomething?gl=CA", "none"],
  ["https://www.google.com/mapsearch?gl=CA", "none"],
  ["https://www.google.com/search?q=maps", "none"],
  ["https://www.google.com/", "none"],
  ["https://example.com/maps", "none"],
  ["https://notgoogle.com/maps", "none"],
  ["https://www.google.com.evil.test/maps", "none"],
  ["https://evil.test/?x=https://www.google.com/maps", "none"],

  ["https://www.google.com/maps?a=1#gl=CA", "redirect"],
  ["https://www.google.com/maps?a=1&xgl=CA", "redirect"],
  ["https://www.google.com/maps?foo=gl=CA", "redirect"]
];

console.log("\nRule matching");
for (const [url, expected] of cases) {
  check(`${expected.padEnd(8)} ${url}`, () =>
    assert.equal(decide(url), expected, `got "${decide(url)}"`));
}

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

console.log("\nisMapsUrl");
check("true for every URL the redirect or guard rule would match", () => {
  for (const [url, expected] of cases) {
    if (expected === "none") continue;
    assert.ok(isMapsUrl(url), `expected isMapsUrl(true) for ${url}`);
  }
});
check("false for look-alikes and unrelated URLs", () => {
  for (const [url, expected] of cases) {
    if (expected !== "none") continue;
    assert.ok(!isMapsUrl(url), `expected isMapsUrl(false) for ${url}`);
  }
});
check("false for a masked/missing url, not a thrown error", () => {
  assert.equal(isMapsUrl(undefined), false);
  assert.equal(isMapsUrl(null), false);
  assert.equal(isMapsUrl(""), false);
  assert.equal(isMapsUrl(42), false);
});

console.log("\nstripRegionParam (used by the Refresh button)");
check("removes gl from a URL that has it", () => {
  assert.equal(
    stripRegionParam("https://www.google.com/maps/@43.65,-77.90,8z?gl=CA"),
    "https://www.google.com/maps/@43.65,-77.90,8z"
  );
});
check("preserves other query params while removing gl", () => {
  const result = stripRegionParam("https://www.google.com/maps?hl=en&gl=CA&entry=ttu");
  const u = new URL(result);
  assert.equal(u.searchParams.get("gl"), null, "gl must be gone");
  assert.equal(u.searchParams.get("hl"), "en", "other params must survive");
  assert.equal(u.searchParams.get("entry"), "ttu", "other params must survive");
});
check("leaves a URL without gl unchanged", () => {
  const url = "https://www.google.com/maps/@43.65,-77.90,8z";
  assert.equal(stripRegionParam(url), url);
});
check("is idempotent", () => {
  const once = stripRegionParam("https://www.google.com/maps?gl=CA");
  assert.equal(stripRegionParam(once), once);
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
check("a very large real tab id never produces an out-of-range rule id", () => {
  const hugeTabId = 2_000_000_000;
  const rules = buildTabRules({ tabId: hugeTabId, ruleIdBase: 1, enabled: true, region: "CA" });
  assert.equal(rules.length, 2);
  const INT32_MAX = 2147483647;
  for (const r of rules) {
    assert.ok(Number.isInteger(r.id) && r.id > 0 && r.id <= INT32_MAX,
      `rule id ${r.id} must be a valid positive int32`);
    assert.deepEqual(r.condition.tabIds, [hugeTabId]);
  }
});

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
check("the toolbar icon is recolored per tab by Maps/not-Maps, not by enabled/region state", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(/action\.setIcon\(/.test(src), "background.js should call action.setIcon to color/grey the icon per tab");
  const iconFnStart = src.indexOf("async function updateActionIcon");
  assert.ok(iconFnStart > -1, "expected an updateActionIcon function");
  const iconFnBody = src.slice(iconFnStart, src.indexOf("\n}\n", iconFnStart));
  assert.ok(/isMapsUrl\(/.test(iconFnBody), "icon color must be driven by isMapsUrl, not enabled/region state");
  const popupSrc = readFileSync(join(SRC, "popup.js"), "utf8");
  assert.ok(!/action\.setIcon\(/.test(popupSrc), "popup.js must not call action.setIcon -- background.js owns per-tab icon state");
});
check("a tab's state is never stored unless it's currently Google Maps", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  const fnStart = src.indexOf("async function applyTabState");
  assert.ok(fnStart > -1, "expected an applyTabState function");
  const fnBody = src.slice(fnStart, src.indexOf("\n}\n", fnStart));
  assert.ok(/isMapsUrl\(/.test(fnBody), "applyTabState must check isMapsUrl before touching tabStates");
});
check("a tracked tab's rules/state are dropped as soon as it navigates off Google Maps", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  const listenerStart = src.indexOf("api.tabs.onUpdated.addListener");
  assert.ok(listenerStart > -1, "expected a tabs.onUpdated listener");
  const listener = src.slice(listenerStart, src.indexOf("\n});", listenerStart) + 4);
  assert.ok(/isMapsUrl\(/.test(listener), "onUpdated must re-check isMapsUrl on navigation");
  assert.ok(/forgetTab\(/.test(listener), "onUpdated must forget tab state once it's off Google Maps");
});
check("tab state is reconciled against reality at both onInstalled and onStartup", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  assert.ok(/onInstalled\.addListener\(async \(\) => \{[\s\S]*?reconcileTabStates\(\)/.test(src),
    "onInstalled must call reconcileTabStates so stale tracked tabs can't survive an update");
  assert.ok(/onStartup\.addListener\(async \(\) => \{[\s\S]*?reconcileTabStates\(\)/.test(src),
    "onStartup must call reconcileTabStates so stale tracked tabs can't survive a browser relaunch");
});
check("popup only offers controls when the active tab is Google Maps", () => {
  const src = readFileSync(join(SRC, "popup.js"), "utf8");
  assert.ok(/isMapsUrl\(/.test(src), "popup.js must gate its controls on isMapsUrl");
  assert.ok(/renderNotMaps/.test(src), "popup.js must render a distinct not-Maps state");
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
check("the Refresh button routes through stripRegionParam, not a bare reload", () => {
  const src = readFileSync(join(SRC, "popup.js"), "utf8");
  const handlerStart = src.indexOf("els.refresh.addEventListener");
  assert.ok(handlerStart > -1, "expected a refresh click handler");
  const handler = src.slice(handlerStart, src.indexOf("\n});", handlerStart));
  assert.ok(/stripRegionParam\(/.test(handler),
    "refresh handler must call stripRegionParam before reloading, or a stale gl= silently survives");
});
check("the message listener responds via sendResponse + return true, not a bare returned promise", () => {
  const src = readFileSync(join(SRC, "background.js"), "utf8");
  const listenerStart = src.indexOf("onMessage.addListener");
  assert.ok(listenerStart > -1, "expected an onMessage listener");
  const listener = src.slice(listenerStart, src.indexOf("\n});", listenerStart) + 4);
  assert.ok(/sendResponse/.test(listener),
    "listener must call sendResponse -- a directly returned promise isn't honored before Chrome 148");
  assert.ok(/return true/.test(listener),
    "listener must synchronously return true to keep the message channel open for the async sendResponse");
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
