"use strict";

const { readProvider } = require("../lib/smm-catalog");
const { sendJson } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }
  try {
    const providers = await Promise.all([
      readProvider("peakerr"),
      readProvider("justanotherpanel")
    ]);
    const items = providers.flatMap(provider => (provider.eligibleServices || []).map(service => ({
      id: service.id,
      name: service.name,
      category: service.category,
      provider: provider.provider,
      providerLabel: provider.label,
      min: service.min,
      max: service.max,
      refill: service.refill,
      cancel: service.cancel
    })));
    const connected = providers.some(provider => provider.connected);
    return sendJson(res, 200, {
      ok: connected,
      items,
      providers: providers.map(provider => ({
        provider: provider.provider,
        label: provider.label,
        connected: provider.connected,
        eligibleCount: provider.eligibleCount
      })),
      message: connected ? null : "Marketing suppliers are not connected right now."
    });
  } catch (error) {
    console.error("[marketing-catalog]", error.code || error.message);
    return sendJson(res, 503, { ok: false, message: "Marketing services are temporarily unavailable." });
  }
};
