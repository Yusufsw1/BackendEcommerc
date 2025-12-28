import express, { Application, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";

// Import Routes
import authRoutes from "./routes/authRoutes";
import productRoutes from "./routes/productRoutes";

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- ROUTES ---
app.get("/", (req: Request, res: Response) => {
  res.send("🚀 E-Commerce API is running...");
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`
  ==========================================
  ✅ Server is running on port ${PORT}
  🔗 Local: http://localhost:${PORT}
  ==========================================
  `);
});

export default app;
