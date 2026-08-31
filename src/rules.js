export const RULE_REDIRECT = 1;
export const RULE_GUARD = 2;

const HOST = "^https?://((www\\.)?google\\.com/maps|maps\\.google\\.com)";

export const REDIRECT_REGEX = HOST + "(/|\\?|$)";
export const GUARD_REGEX = HOST + "(/[^?]*)?\\?([^#]*&)?gl=";

export function buildRules({ enabled, region }) {
  if (!enabled || !/^[A-Za-z]{2}$/.test(region || "")) {
    return [];
  }
  return [
    {
      id: RULE_GUARD,
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: GUARD_REGEX,
        resourceTypes: ["main_frame"]
      }
    },
    {
      id: RULE_REDIRECT,
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
        resourceTypes: ["main_frame"]
      }
    }
  ];
}
