module.exports = async (req, res) => {
  const { default: app } = await import("../../artifacts/api-server/dist/serverless.mjs");

  if (!req.url.startsWith("/api/auth")) {
    req.url = `/api/auth${req.url}`;
  }
  return app(req, res);
};
