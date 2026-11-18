module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "VerifyFlow",
    environment: process.env.VERCEL_ENV || "development",
    timestamp: new Date().toISOString()
  });
};