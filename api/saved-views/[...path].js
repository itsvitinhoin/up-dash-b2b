module.exports = async (req, res) => {
  const { default: app } = await import("../../artifacts/api-server/dist/serverless.mjs");

  if (!req.url.startsWith("/api/saved-views")) {
    req.url = `/api/saved-views${req.url}`;
  }
  return app(req, res);
};
