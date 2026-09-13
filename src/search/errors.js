import { t } from "../i18n.js";

export function mapErrorText(error) {
  const keys = ["invalidArea", "invalidSearch", "quota", "dailyLimit", "tooDense", "emptyArea", "partialData", "badData", "timeout", "unavailable"];
  const code = keys.includes(error?.code) ? error.code : "unavailable";
  return t(code, { seconds: error.retryAfter || 60 });
}
