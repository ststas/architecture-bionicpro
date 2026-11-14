import cors from "cors";
import express from "express";
import { config } from "./config";
import { reportsRouter } from "./reports";

const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: config.corsOrigin, allowedHeaders: ["Authorization"] }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use(reportsRouter);

app.listen(config.port, () => {
  console.log(`reports-api started on port ${config.port}`);
});
