import { DEFAULTS, SCHEMA_VERSION } from "./defaults.js";
import { buildRules, RULE_REDIRECT, RULE_GUARD } from "./rules.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const ALL_RULE_IDS = [RULE_REDIRECT, RULE_GUARD];
const store = api.storage.local;

async function getSettings() {
  const stored = await store.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch((err) => {
      console.warn("[Maps Region Switcher] legacy settings read failed:", err);
      return fallback;
    }),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

async function migrate() {
  const { schemaVersion } = await store.get({ schemaVersion: 0 });
  if (schemaVersion >= SCHEMA_VERSION) return;

  const carried = await withTimeout(
    api.storage.sync.get(["enabled", "region"]),
    400,
    {}
  );

  await store.set({ ...DEFAULTS, ...carried, schemaVersion: SCHEMA_VERSION });

  await store.remove("scope");
}

async function syncRules() {
  const settings = await getSettings();
  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALL_RULE_IDS,
      addRules: buildRules(settings)
    });
  } catch (err) {
    console.error("[Maps Region Switcher] failed to update rules:", err);
    await showError(String(err && err.message ? err.message : err));
    return;
  }
  await applyActionState(settings);
}

const ICON_SIZES = [16, 32, 48, 128];

const iconPaths = (suffix) =>
  Object.fromEntries(ICON_SIZES.map((s) => [s, `icons/icon${s}${suffix}.png`]));

async function setIcon(enabled) {
  try {
    await api.action.setIcon({ path: iconPaths(enabled ? "" : "-off") });
  } catch (err) {
    console.error("[Maps Region Switcher] failed to set icon:", err);
  }
}

async function showError(detail) {
  try {
    await setIcon(true);
    await api.action.setBadgeText({ text: "!" });
    await api.action.setBadgeBackgroundColor({ color: "#b3261e" });
    await api.action.setTitle({
      title: `Maps Region Switcher — rules failed to install: ${detail}`
    });
  } catch { /* ignore errors */ }
}

async function applyActionState({ enabled, region }) {
  let installed = [];
  try {
    installed = await api.declarativeNetRequest.getDynamicRules();
  } catch (err) {
    console.error("[Maps Region Switcher] could not read back rules:", err);
  }
  const expected = enabled ? 2 : 0;
  if (installed.length !== expected) {
    await showError(`expected ${expected} rules, browser has ${installed.length}`);
    return;
  }
  await setIcon(enabled);
  try {
    await api.action.setBadgeText({ text: "" });

    await api.action.setTitle({
      title: enabled
        ? `Maps Region Switcher — on (${region.toUpperCase()})`
        : "Maps Region Switcher — off"
    });
  } catch (err) {
    console.error("[Maps Region Switcher] failed to update action state:", err);
  }
}

api.runtime.onInstalled.addListener(async () => {
  await migrate();
  await syncRules();
});
api.runtime.onStartup.addListener(syncRules);

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if ("enabled" in changes || "region" in changes) {
    syncRules();
  }
});

syncRules();
