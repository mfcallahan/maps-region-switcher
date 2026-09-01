// Region rules are scoped per tab: each tab that's been switched on gets its
// own pair of SESSION-scoped declarativeNetRequest rules (declarativeNetRequest's
// `condition.tabIds` is only supported on session rules -- dynamic and static
// rules cannot be scoped to a tab at all). A tab that's off, or has never been
// touched, has no rules and renders Maps completely unmodified -- there is no
// global fallback region any more, so two tabs can sit side by side showing two
// different countries' Maps.
//
// Session rules (and the tab ids they're scoped to) are wiped when the browser
// restarts, which is fine: tab ids themselves don't survive a restart either,
// so there's nothing meaningful to keep in sync. See project memory:
// per_tab_regions.md.
//
// Rule `id` is NOT derived from the tab id. A real Chrome tab id must fit
// declarativeNetRequest's own tabIds condition just fine (Chrome guarantees
// that), but a rule's own `id` field is a *separate*, stricter int32 value,
// and on a long-lived Chrome profile tab ids can already be large enough
// that doubling one (the original scheme here) overflows int32 and Chrome
// rejects the whole call with "Invalid type: expected integer, found
// number". So rule ids come from a small pool (background.js hands out
// 1, 3, 5, ... and reclaims them when a tab closes) that is completely
// independent of how large the real tab id is.

const HOST = "^https?://((www\\.)?google\\.com/maps|maps\\.google\\.com)";

export const REDIRECT_REGEX = HOST + "(/|\\?|$)";
export const GUARD_REGEX = HOST + "(/[^?]*)?\\?([^#]*&)?gl=";

// ruleIdBase comes from background.js's id pool, not from the tab id -- see
// the note above. Each base occupies exactly two consecutive ids.
export const guardRuleId = (ruleIdBase) => ruleIdBase;
export const redirectRuleId = (ruleIdBase) => ruleIdBase + 1;

export function buildTabRules({ tabId, ruleIdBase, enabled, region }) {
  if (
    !enabled ||
    !Number.isInteger(tabId) || tabId < 0 ||
    !Number.isInteger(ruleIdBase) || ruleIdBase < 1 ||
    !/^[A-Za-z]{2}$/.test(region || "")
  ) {
    return [];
  }
  return [
    {
      id: guardRuleId(ruleIdBase),
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: GUARD_REGEX,
        resourceTypes: ["main_frame"],
        tabIds: [tabId]
      }
    },
    {
      id: redirectRuleId(ruleIdBase),
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          transform: {
            queryTransform: {
              addOrReplaceParams: [{ key: "gl", value: region.toUpperCase() }]
            }
          }
        }
      },
      condition: {
        regexFilter: REDIRECT_REGEX,
        resourceTypes: ["main_frame"],
        tabIds: [tabId]
      }
    }
  ];
}
