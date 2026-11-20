"use strict";

const PLATFORM_RULES = [
  ["Instagram", /instagram|\\big\\b|ig\\s+(?:followers?|likes?|views?)/i],
  ["TikTok", /tiktok|tik tok/i],
  ["YouTube", /youtube|\\byt\\b|subscribers?\\s+(?:on|for)\\s+youtube/i],
  ["Facebook", /facebook|\\bfb\\b/i],
  ["Telegram", /telegram/i],
  ["X (Twitter)", /twitter|\\bx\\s*(?:\\(|platform)|retweets?|tweet/i],
  ["Spotify", /spotify/i],
  ["Twitch", /twitch/i],
  ["Discord", /discord/i],
  ["Snapchat", /snapchat/i],
  ["Threads", /threads/i],
  ["LinkedIn", /linkedin/i],
  ["Pinterest", /pinterest/i]
];
const ACTION_RULES = [
  ["Followers", /followers?|follow(?:ing)?|profile visits?/i],
  ["Likes", /likes?|hearts?|favourites?|favorites?/i],
  ["Views", /views?|impressions?|reach/i],
  ["Comments", /comments?|replies?/i],
  ["Shares", /shares?|reposts?|retweets?/i],
  ["Subscribers", /subscribers?|subs\\b/i],
  ["Members", /members?|group joins?|channel joins?/i],
  ["Story Views", /story\\s+views?/i],
  ["Reactions", /reactions?|votes?/i],
  ["Saves", /saves?|bookmarks?/i],
  ["Watch Time", /watch\\s*time|hours?\\s*watch/i],
  ["Live Viewers", /live\\s*viewers?|stream\\s*viewers?/i],
  ["Plays", /plays?|streams?/i],
  ["Reviews", /reviews?|ratings?/i],
  ["Website Traffic", /website\\s*(?:traffic|visitors?)|organic\\s*traffic/i],
  ["SEO", /seo|backlinks?|domain\\s*authority/i]
];

function classifySmmService(service = {}) {
  const source = [service.category, service.type, service.name, service.description]
    .map(value => String(value || "")).join(" ").replace(/\\s+/g, " ").trim();
  const platformMatch = PLATFORM_RULES.find(([, pattern]) => pattern.test(source));
  const actionMatch = ACTION_RULES.find(([, pattern]) => pattern.test(source));
  const hasPlatformEvidence = Boolean(platformMatch);
  const hasActionEvidence = Boolean(actionMatch);
  const platform = platformMatch ? platformMatch[0] : "Other";
  const subcategory = actionMatch ? actionMatch[0] : "Other";
  const confidence = hasPlatformEvidence && hasActionEvidence ? "high"
    : hasPlatformEvidence || hasActionEvidence ? "medium" : "low";
  return {
    platform,
    category: platform,
    subcategory,
    classificationStatus: confidence === "low" ? "needs_review" : confidence,
    confidence
  };
}

module.exports = { classifySmmService, PLATFORM_RULES, ACTION_RULES };
