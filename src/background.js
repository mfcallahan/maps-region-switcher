import { DEFAULTS, SCHEMA_VERSION } from "./defaults.js";
import { buildTabRules, guardRuleId, redirectRuleId, isMapsUrl } from "./rules.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const store = api.storage.local;
const sessionStore = api.storage.session;

async function migrate() {
  const { schemaVersion } = await store.get({ schemaVersion: 0 });
  if (schemaVersion >= SCHEMA_VERSION) return;
  await store.set({ schemaVersion: SCHEMA_VERSION });
  await store.remove(["scope", "enabled", "region"]);
}

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
  pool.nextBase += 2;
  return base;
}

const ICON_SIZES = [16, 32, 48, 128];

function iconPaths(suffix) {
  const paths = {};
  for (const size of ICON_SIZES) paths[size] = `icons/icon${size}${suffix}.png`;
  return paths;
}

async function updateActionIcon(tabId, url) {
  try {
    await api.action.setIcon({ tabId, path: iconPaths(isMapsUrl(url) ? "" : "-off") });
  } catch {
  }
}

async function showTabError(tabId, detail) {
  try {
    await api.action.setBadgeText({ tabId, text: "!" });
    await api.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
    await api.action.setTitle({
      tabId,
      title: `Maps Region Switcher — rules failed to install: ${detail}`
    });
  } catch { }
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
  let tab;
  try {
    tab = await api.tabs.get(tabId);
  } catch {
    return { ok: false, error: "tab no longer exists" };
  }
  if (!isMapsUrl(tab.url)) {
    return { ok: false, error: "not a Google Maps tab" };
  }

  const { tabStates, pool } = await getSessionData();
  const existing = tabStates[tabId];
  let ruleIdBase = existing?.ruleIdBase ?? null;

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

async function forgetTab(tabId) {
  const { tabStates, pool } = await getSessionData();
  const existing = tabStates[tabId];
  if (!existing) return;
  if (existing.ruleIdBase != null) {
    try {
      await api.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [guardRuleId(existing.ruleIdBase), redirectRuleId(existing.ruleIdBase)]
      });
    } catch { }
    pool.free.push(existing.ruleIdBase);
  }
  delete tabStates[tabId];
  await sessionStore.set({ tabStates, pool });
}

async function reconcileTabStates() {
  const { tabStates } = await getSessionData();
  for (const tabIdStr of Object.keys(tabStates)) {
    const tabId = Number(tabIdStr);
    let tab;
    try {
      tab = await api.tabs.get(tabId);
    } catch {
      await forgetTab(tabId);
      continue;
    }
    if (!isMapsUrl(tab.url)) {
      await forgetTab(tabId);
    }
  }
}

async function refreshAllTabIcons() {
  let tabs = [];
  try {
    tabs = await api.tabs.query({});
  } catch {
    return;
  }
  await Promise.all(tabs.map((tab) => updateActionIcon(tab.id, tab.url)));
}

api.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));

api.tabs.onActivated.addListener(async ({ tabId }) => {
  let tab;
  try {
    tab = await api.tabs.get(tabId);
  } catch {
    return;
  }
  await updateActionIcon(tabId, tab.url);
});

api.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url === undefined && changeInfo.status === undefined) return;
  await updateActionIcon(tabId, tab.url);
  if (!isMapsUrl(tab.url)) {
    await forgetTab(tabId);
  }
});

api.runtime.onInstalled.addListener(async () => {
  await migrate();
  await reconcileTabStates();
  await refreshAllTabIcons();
});

api.runtime.onStartup.addListener(async () => {
  await reconcileTabStates();
  await refreshAllTabIcons();
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== "setTabState") {
    return;
  }
  applyTabState(message.tabId, message.enabled, message.region).then(sendResponse);
  return true;
});
