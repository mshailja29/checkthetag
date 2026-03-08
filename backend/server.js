const express = require("express");
const cors = require("cors");
const receiptRoutes = require("./routes/receipt");
const authRoutes = require("./routes/auth");

// Load .env for local dev
try { require("dotenv").config(); } catch { /* dotenv optional */ }

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: "200mb" })); // Receipts and especially base64 videos can be very large

// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api", receiptRoutes);
app.use("/api/gemini", require("./routes/geminiProxy"));

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Check the Tag backend running on http://0.0.0.0:${PORT}`);
    console.log(`   GCP Project: ${process.env.GCP_PROJECT_ID || "(not set)"}`);
    console.log(`   Region:      ${process.env.GCP_REGION || "(not set)"}`);
});
