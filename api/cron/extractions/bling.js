// A fixed entry point gives the importer its own function and database pool.
// The shared Express route still enforces cron authentication, brand selection,
// provider throttling and the persisted lease/checkpoint.
module.exports = async (req, res) => {
  res.setHeader("X-Bling-Worker", "isolated");
  const { default: app } =
    await import("../../../artifacts/api-server/dist/serverless.mjs");
  return app(req, res);
};
