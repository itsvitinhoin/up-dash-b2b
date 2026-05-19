module.exports = async (req, res) => {
  const { default: app } = await import("../../artifacts/api-server/dist/serverless.mjs");

  if (!req.url.startsWith("/api/analytics")) {
    req.url = `/api/analytics${req.url}`;
  }
  return app(req, res);
};
