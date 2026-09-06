const HOST = "^https?://((www\\.)?google\\.com/maps|maps\\.google\\.com)";

export const REDIRECT_REGEX = HOST + "(/|\\?|$)";
export const GUARD_REGEX = HOST + "(/[^?]*)?\\?([^#]*&)?gl=";

const MAPS_URL_REGEX = new RegExp(REDIRECT_REGEX, "i");

export function isMapsUrl(url) {
  return typeof url === "string" && MAPS_URL_REGEX.test(url);
}

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

export function stripRegionParam(url) {
  const u = new URL(url);
  u.searchParams.delete("gl");
  return u.toString();
}
