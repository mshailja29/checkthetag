const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");

// Load .env for local dev
try { require("dotenv").config(); } catch { /* dotenv optional */ }

// Initialize Firebase Admin (must happen before routes that use Firestore)
require("./services/firebase");

const receiptRoutes = require("./routes/receipt");
const geminiRoutes = require("./routes/geminiProxy");
const storeRoutes = require("./routes/stores");
const priceRoutes = require("./routes/prices");
const scanRoutes = require("./routes/scans");
const userRoutes = require("./routes/users");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json({ limit: "200mb" }));

// Health check
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        project: process.env.GCP_PROJECT_ID || "(not set)",
        services: {
            firestore: "connected",
            gcs: process.env.GCS_BUCKET || "(not set)",
            vertexai: "gemini-2.5-flash",
        },
    });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api", receiptRoutes);
app.use("/api/gemini", geminiRoutes);

// API routes — cloud-backed
app.use("/api/stores", storeRoutes);
app.use("/api/prices", priceRoutes);
app.use("/api/scans", scanRoutes);
app.use("/api/users", userRoutes);

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`PriceScout backend running on http://0.0.0.0:${PORT}`);
    console.log(`   GCP Project: ${process.env.GCP_PROJECT_ID || "(not set)"}`);
    console.log(`   Region:      ${process.env.GCP_REGION || "(not set)"}`);
    console.log(`   GCS Bucket:  ${process.env.GCS_BUCKET || "(not set)"}`);
    console.log(`   Firestore:   connected`);
});
