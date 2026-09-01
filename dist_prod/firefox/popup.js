import { TAB_DEFAULTS, REGIONS } from "./defaults.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const els = {
  enabled: document.getElementById("enabled"),
  regionInput: document.getElementById("regionInput"),
  regionListbox: document.getElementById("regionListbox"),
  note: document.getElementById("note"),
  hint: document.getElementById("hint"),
  refresh: document.getElementById("refresh")
};

const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));
const labelFor = (r) => `${r.name} (${r.code})`;

function describe(enabled) {
  return enabled
    ? ""
    : "Google Maps loads normally in this tab, using your own location.";
}

function render({ enabled, region }) {
  els.enabled.checked = enabled;

  const info = REGION_BY_CODE.get(region);
  const label = info ? labelFor(info) : region.toUpperCase();

  els.regionInput.value = label;
  els.regionInput.disabled = !enabled;
  if (!enabled) closeList();

  const note = describe(enabled);
  els.note.textContent = note;
  els.note.hidden = !note;
}

// --- Region combobox: one text field that IS the region picker, with a
// custom filtered <ul role="listbox"> floating underneath it instead of a
// native <select> dropdown. Typing filters REGIONS by partial or exact match
// against the region's name or its two-letter code; the down-arrow icon next
// to the field is purely visual (CSS-only rotation via :has()) so people
// still recognize this as a dropdown, not just a text box. -------------------

let filtered = [];
let activeIndex = -1;

function matches(region, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${region.name} ${region.code}`.toLowerCase().includes(q);
}

function renderListbox() {
  els.regionListbox.innerHTML = "";
  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.className = "region-listbox-empty";
    empty.textContent = "No matching regions";
    els.regionListbox.append(empty);
    return;
  }
  filtered.forEach((region, i) => {
    const li = document.createElement("li");
    li.id = `region-opt-${region.code}`;
    li.className = "region-option" + (i === activeIndex ? " active" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    li.dataset.code = region.code;
    li.textContent = labelFor(region);
    els.regionListbox.append(li);
  });
}

function openList(query) {
  filtered = REGIONS.filter((r) => matches(r, query));
  activeIndex = -1;
  renderListbox();
  els.regionListbox.hidden = false;
  els.regionInput.setAttribute("aria-expanded", "true");
}

function closeList() {
  filtered = [];
  activeIndex = -1;
  els.regionListbox.hidden = true;
  els.regionListbox.innerHTML = "";
  els.regionInput.setAttribute("aria-expanded", "false");
  els.regionInput.removeAttribute("aria-activedescendant");
}

function setActive(index) {
  if (filtered.length === 0) return;
  activeIndex = (index + filtered.length) % filtered.length;
  renderListbox();
  const active = els.regionListbox.children[activeIndex];
  els.regionInput.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function revertInput() {
  const info = REGION_BY_CODE.get(currentState.region);
  els.regionInput.value = info ? labelFor(info) : currentState.region.toUpperCase();
}

function commitRegion(code) {
  const region = REGION_BY_CODE.get(code);
  if (!region) return;
  els.regionInput.value = labelFor(region);
  closeList();
  applyPatch({ region: region.code });
}

els.regionInput.addEventListener("focus", () => {
  els.regionInput.select();
  openList(""); // show every region on focus; typing narrows from here
});

els.regionInput.addEventListener("input", () => {
  openList(els.regionInput.value);
});

els.regionInput.addEventListener("keydown", (e) => {
  if (els.regionListbox.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    openList(els.regionInput.value);
    return;
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      setActive(activeIndex + 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      setActive(activeIndex - 1);
      break;
    case "Enter":
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        commitRegion(filtered[activeIndex].code);
      } else if (filtered.length === 1) {
        commitRegion(filtered[0].code);
      }
      break;
    case "Escape":
      closeList();
      revertInput();
      break;
    default:
      break;
  }
});

// The listbox's mousedown handler calls preventDefault() so the input never
// blurs before a click on an option completes -- without that, blur's own
// revert logic would close the list out from under the click.
els.regionListbox.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const li = e.target.closest(".region-option");
  if (li && li.dataset.code) commitRegion(li.dataset.code);
});

els.regionInput.addEventListener("blur", () => {
  if (els.regionListbox.hidden) return;
  const typed = els.regionInput.value.trim();
  const exact = REGIONS.find((r) => labelFor(r).toLowerCase() === typed.toLowerCase());
  const byCode = /^[A-Za-z]{2}$/.test(typed) ? REGION_BY_CODE.get(typed.toUpperCase()) : null;
  if (exact) {
    commitRegion(exact.code);
  } else if (byCode) {
    commitRegion(byCode.code);
  } else if (filtered.length === 1) {
    commitRegion(filtered[0].code);
  } else {
    revertInput();
  }
  closeList();
});

document.addEventListener("click", (e) => {
  if (!els.regionListbox.hidden && !document.getElementById("regionCombobox").contains(e.target)) {
    closeList();
    revertInput();
  }
});

// --- Per-tab state -----------------------------------------------------
// Every open Maps tab can be set to a different region independently. This
// popup only ever edits ONE tab: whichever tab was active when the icon was
// clicked. That per-tab state lives in the background script's
// chrome.storage.session (not storage.local), keyed by tab id -- see
// background.js and project memory: per_tab_regions.md.
let activeTabId = null;
let currentState = TAB_DEFAULTS;

async function applyPatch(patch) {
  if (activeTabId == null) return;

  const next = { ...currentState, ...patch };
  currentState = next;
  render(next);
  els.hint.textContent = "Applying…";

  const result = await api.runtime.sendMessage({
    type: "setTabState",
    tabId: activeTabId,
    enabled: next.enabled,
    region: next.region
  });

  els.hint.textContent = result && result.ok
    ? "Reload this tab to apply."
    : `Couldn't apply: ${result?.error || "unknown error"}`;
}

els.enabled.addEventListener("change", () => applyPatch({ enabled: els.enabled.checked }));

els.refresh.addEventListener("click", async () => {
  if (activeTabId != null) {
    await api.tabs.reload(activeTabId);
  } else {
    await api.tabs.create({ url: "https://www.google.com/maps" });
  }
  window.close();
});

async function init() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab ? tab.id : null;

  const { tabStates } = await api.storage.session.get({ tabStates: {} });
  currentState = (activeTabId != null && tabStates[activeTabId]) || TAB_DEFAULTS;
  render(currentState);
}

init();
