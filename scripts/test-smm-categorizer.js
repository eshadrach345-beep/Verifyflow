"use strict";
const assert = require("node:assert/strict");
const { classifySmmService } = require("../lib/smm-categorizer");
const cases = [
  [{ category: "Instagram", name: "Instagram Followers", description: "Real followers" }, "Instagram", "Followers", "high"],
  [{ category: "Instagram", name: "Premium Likes", description: "Instagram post likes" }, "Instagram", "Likes", "high"],
  [{ category: "TikTok", name: "Video Views" }, "TikTok", "Views", "high"],
  [{ name: "YouTube Subscribers", description: "Channel growth" }, "YouTube", "Subscribers", "high"],
  [{ name: "Telegram Group Members" }, "Telegram", "Members", "high"],
  [{ name: "Mystery digital service", description: "No platform or action specified" }, "Other", "Other", "needs_review"]
];
for (const [input, platform, subcategory, status] of cases) {
  const result = classifySmmService(input);
  assert.equal(result.platform, platform, JSON.stringify(input));
  assert.equal(result.subcategory, subcategory, JSON.stringify(input));
  assert.equal(result.classificationStatus, status, JSON.stringify(input));
}
console.log("SMM automatic categorization tests passed.");
