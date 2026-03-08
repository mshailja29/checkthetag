/**
 * Firebase Admin SDK initialization — single shared instance.
 */
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// Load dotenv if available (for standalone script usage)
try { require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") }); } catch { }

// Resolve credential file — check env var, then known filenames
function findCredentialFile() {
    const backendDir = path.resolve(__dirname, "..");
    const candidates = [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "./gcloud-hackathon-vi0ysib4ateve-f2b5e719a4a6.json",
        "./service-account.json",
    ].filter(Boolean);

    for (const c of candidates) {
        const resolved = path.resolve(backendDir, c);
        if (fs.existsSync(resolved)) return resolved;
    }
    throw new Error("No service account JSON found. Place it in the backend/ directory.");
}

if (!admin.apps.length) {
    const credFile = findCredentialFile();
    admin.initializeApp({
        credential: admin.credential.cert(credFile),
        projectId: process.env.GCP_PROJECT_ID || "gcloud-hackathon-vi0ysib4ateve",
    });
}

const db = admin.firestore();
const { FieldValue } = admin.firestore;

module.exports = { admin, db, FieldValue };
