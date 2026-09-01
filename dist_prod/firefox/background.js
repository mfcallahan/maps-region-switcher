import { DEFAULTS, SCHEMA_VERSION } from "./defaults.js";
import { buildTabRules, guardRuleId, redirectRuleId } from "./rules.js";

const api = typeof browser !== "undefined" ? browser : chrome;

// storage.local holds only schemaVersion -- nothing else survives a browser
// restart deliberately, since per-tab state shouldn't (see rules.js).
const store = api.storage.local;
// storage.session holds the actual per-tab state and the id pool below. Its
// lifetime already matches session-scoped DNR rules and tab ids themselves,
// so there's nothing to reconcile on restart.
const sessionStore = api.storage.session;

async function migrate() {
  const { schemaVersion } = await store.get({ schemaVersion: 0 });
  if (schemaVersion >= SCHEMA_VERSION) return;
  // Older versions kept one global {enabled, region} pair (storage.local,
  // and before that storage.sync). Regions are per-tab now -- see project
  // memory: per_tab_regions.md -- and per-tab state lives only in
  // storage.session, which has nothing to migrate into. Just drop the old
  // global keys.
  await store.set({ schemaVersion: SCHEMA_VERSION });
  await store.remove(["scope", "enabled", "region"]);
}

// tabStates: { [tabId]: {enabled, region, ruleIdBase} }
// pool: {nextBase, free} -- see rules.js for why rule ids come from a small
// pool instead of being derived from the (possibly large) real tab id.
async function getSessionData() {
  const { tabStates, pool } = await sessionStore.get({
    tabStates: {},
    pool: { nextBase: 1, free: [] }
  });
  return { tabStates, pool };
}

function allocateRuleIdBase(pool) {
  if (pool.free.length > 0) {
    return pool.free.shift();
  }
  const base = pool.nextBase;
  pool.nextBase += 2; // each base reserves exactly 2 ids: base, base+1
  return base;
}

// The toolbar icon itself never changes -- it stays whatever color icon the
// manifest declares, always, for every tab and every state. A real failure
// (rules didn't install) is surfaced with a badge + title on just the
// affected tab instead, not by recoloring anything.
async function showTabError(tabId, detail) {
  try {
    await api.action.setBadgeText({ tabId, text: "!" });
    await api.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
    await api.action.setTitle({
      tabId,
      title: `Maps Region Switcher — rules failed to install: ${detail}`
    });
  } catch { /* ignore errors */ }
}

async function setTabActionState(tabId, enabled, region) {
  try {
    await api.action.setBadgeText({ tabId, text: "" });
    await api.action.setTitle({
      tabId,
      title: enabled
        ? `Maps Region Switcher — on for this tab (${region.toUpperCase()})`
        : "Maps Region Switcher — off for this tab"
    });
  } catch (err) {
    console.error("[Maps Region Switcher] failed to update action state:", err);
  }
}

async function applyTabState(tabId, enabled, region) {
  const { tabStates, pool } = await getSessionData();
  const existing = tabStates[tabId];
  let ruleIdBase = existing?.ruleIdBase ?? null;

  // Only spend a slot from the pool the first time a tab is actually turned
  // on. A tab that's off and has never been on needs no rules at all, so it
  // needs no id either.
  if (enabled && ruleIdBase == null) {
    ruleIdBase = allocateRuleIdBase(pool);
  }

  if (ruleIdBase != null) {
    const rules = buildTabRules({ tabId, ruleIdBase, enabled, region });
    try {
      await api.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [guardRuleId(ruleIdBase), redirectRuleId(ruleIdBase)],
        addRules: rules
      });
    } catch (err) {
      console.error("[Maps Region Switcher] failed to update rules:", err);
      const message = String(err && err.message ? err.message : err);
      await showTabError(tabId, message);
      return { ok: false, error: message };
    }

    let installed = [];
    try {
      installed = await api.declarativeNetRequest.getSessionRules({
        ruleIds: [guardRuleId(ruleIdBase), redirectRuleId(ruleIdBase)]
      });
    } catch (err) {
      console.error("[Maps Region Switcher] could not read back rules:", err);
    }
    if (installed.length !== rules.length) {
      const message = `expected ${rules.length} rules, browser has ${installed.length}`;
      await showTabError(tabId, message);
      return { ok: false, error: message };
    }
  }

  tabStates[tabId] = { enabled, region, ruleIdBase };
  await sessionStore.set({ tabStates, pool });
  await setTabActionState(tabId, enabled, region);
  return { ok: true };
}

// No special permission needed. A closed tab's rules and stored state would
// otherwise sit around forever, and its id-pool slot would never come back
// for reuse by another tab.
api.tabs.onRemoved.addListener(async (tabId) => {
  const { tabStates, pool } = await getSessionData();
  const existing = tabStates[tabId];
  if (existing && existing.ruleIdBase != null) {
    try {
      await api.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [guardRuleId(existing.ruleIdBase), redirectRuleId(existing.ruleIdBase)]
      });
    } catch { /* the tab's rules may already be gone */ }
    pool.free.push(existing.ruleIdBase);
  }
  delete tabStates[tabId];
  await sessionStore.set({ tabStates, pool });
});

api.runtime.onInstalled.addListener(async () => {
  await migrate();
});

// The popup never calls declarativeNetRequest directly -- every mutation and
// its "verify what actually installed" check happens here, in one place,
// reached only through this message.
api.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object" || message.type !== "setTabState") {
    return;
  }
  return applyTabState(message.tabId, message.enabled, message.region);
});
