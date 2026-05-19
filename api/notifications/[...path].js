module.exports = async (req, res) => {
  const { default: app } = await import("../../artifacts/api-server/dist/serverless.mjs");

  if (!req.url.startsWith("/api/notifications")) {
    req.url = `/api/notifications${req.url}`;
  }
  return app(req, res);
};
