module.exports = async (req, res) => {
  const { default: app } = await import("../artifacts/api-server/dist/serverless.mjs");

  return app(req, res);
};
