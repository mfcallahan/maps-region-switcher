import { DEFAULTS, REGIONS } from "./defaults.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const els = {
  enabled: document.getElementById("enabled"),
  region: document.getElementById("region"),
  note: document.getElementById("note"),
  statusText: document.getElementById("statusText"),
  hint: document.getElementById("hint"),
  refresh: document.getElementById("refresh")
};

for (const { code, name } of REGIONS) {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = `${name} (${code})`;
  els.region.append(opt);
}

function describe(code, enabled) {
  if (!enabled) {
    return "Google Maps loads normally, using your own location.";
  }

  const region = REGIONS.find((r) => r.code === code);

  if (!region) {
    return "";
  }

  const base = `Google Maps loads as if you were in ${region.name}.`;
  return region.note ? `${base}\nNames shown: ${region.note}` : base;
}

function render({ enabled, region }) {
  els.enabled.checked = enabled;
  els.region.value = region;
  els.region.disabled = !enabled;

  const info = REGIONS.find((r) => r.code === region);
  const label = info ? `${info.name} (${region.toUpperCase()})` : region.toUpperCase();

  els.statusText.textContent = enabled ? `On — ${label}` : "Off";
  els.note.textContent = describe(region, enabled);
}

const store = api.storage.local;

const OWNED = ["enabled", "region"];
const pick = (obj) => Object.fromEntries(OWNED.map((k) => [k, obj[k]]));
const CACHE_KEY = "settings-mirror-v1";

function readMirror() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;  // private mode, blocked site data, corrupt JSON: fall through
  }
}

function writeMirror(settings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(pick(settings)));
  } catch { /* ignore errors */ }
}

async function save(patch) {
  const current = { ...DEFAULTS, ...(await store.get(DEFAULTS)) };
  const next = { ...current, ...patch };

  writeMirror(next);
  await store.set(pick(next));

  render(next);
  els.hint.textContent = "Reload Maps to apply.";
}

els.enabled.addEventListener("change", () => save({ enabled: els.enabled.checked }));

els.region.addEventListener("change", () => save({ region: els.region.value }));

els.refresh.addEventListener("click", async () => {
  const [tab] = await api.tabs.query({
    url: ["*://www.google.com/maps*", "*://google.com/maps*", "*://maps.google.com/*"],
    currentWindow: true
  });

  if (tab && tab.id != null && tab.url) {
    const stripped = new URL(tab.url);
    stripped.searchParams.delete("gl");
    const next = stripped.toString();
    if (next !== tab.url) {
      await api.tabs.update(tab.id, { active: true, url: next });
    } else {
      // No gl= to strip -- update() to an identical URL is not guaranteed to
      // reload, so ask explicitly.
      await api.tabs.update(tab.id, { active: true });
      await api.tabs.reload(tab.id);
    }
  } else {
    await api.tabs.create({ url: "https://www.google.com/maps" });
  }
  window.close();
});

const mirrored = readMirror();
if (mirrored) {
    render({ ...DEFAULTS, ...mirrored });
}

store.get(DEFAULTS).then((stored) => {
  const settings = { ...DEFAULTS, ...stored };
  render(settings);
  writeMirror(settings);
});
