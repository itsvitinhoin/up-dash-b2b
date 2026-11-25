// Keep ERP reads independent of the shared function's single-connection pool.
// The existing Express route still enforces authentication and brand access.
module.exports = async (req, res) => {
  res.setHeader("X-Bling-Analytics", "isolated");
  const { default: app } =
    await import("../../../artifacts/api-server/dist/serverless.mjs");
  return app(req, res);
};
