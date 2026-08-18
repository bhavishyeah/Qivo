import "dotenv/config";
import app from "./app.js";

const port = Number(process.env.PORT ?? 3000);

console.log("Starting Qivo API...");

app.listen(port, () => {
  console.log(`Qivo API running at http://localhost:${port}`);
});