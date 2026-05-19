module.exports = async (req, res) => {
  const { default: app } = await import("../artifacts/api-server/dist/serverless.mjs");
  const url = new URL(req.url, "https://data-intelligence-system.vercel.app");
  const path = url.searchParams.get("path") ?? "";
  url.searchParams.delete("path");
  req.url = `/api/${path}${url.search}`;

  return app(req, res);
};
