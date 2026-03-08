const express = require("express");
const router = express.Router();
const firestore = require("../services/firestore");
const storage = require("../services/storage");
const { v4: uuidv4 } = require("uuid");

// POST /api/scans — upload media, save scan + prices
router.post("/", async (req, res) => {
    try {
        const { userId, image, mimeType, scanType, storeName, storeId, latitude, longitude, extractedData } = req.body;
        if (!userId) return res.status(400).json({ error: "userId required" });

        const scanId = uuidv4();
        let mediaUrl = null;
        let mediaPath = null;

        // Upload media to GCS if provided
        if (image) {
            const uploaded = await storage.uploadBase64(image, mimeType || "image/jpeg", userId, scanId);
            mediaUrl = uploaded.publicUrl;
            mediaPath = uploaded.filePath;
        }

        // Resolve store
        let resolvedStoreId = storeId;
        let storeLatitude = latitude || null;
        let storeLongitude = longitude || null;
        if (!resolvedStoreId && storeName) {
            const store = await firestore.findStoreByName(storeName);
            if (store) {
                resolvedStoreId = store.id;
                storeLatitude = store.latitude;
                storeLongitude = store.longitude;
            }
        }

        // Save scan document
        const savedScanId = await firestore.createScan({
            userId, mediaUrl, mediaPath, mimeType, scanType,
            storeName, storeId: resolvedStoreId, latitude, longitude, extractedData,
        });

        // Save extracted prices if provided
        let savedPrices = 0;
        if (Array.isArray(extractedData) && extractedData.length > 0) {
            const priceIds = await firestore.saveExtractedItems({
                items: extractedData.map(d => ({
                    item: d.item || d.name,
                    brand: d.brand || "",
                    price: d.price,
                    weight: d.weight || "",
                })),
                storeName: storeName || "Unknown",
                storeId: resolvedStoreId,
                storeLatitude,
                storeLongitude,
                userId,
                scanSource: scanType || "receipt",
                scanId: savedScanId,
            });
            savedPrices = priceIds.length;
        }

        res.json({ success: true, scanId: savedScanId, mediaUrl, savedPrices });
    } catch (err) {
        console.error("[scans] create:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/scans/user/:userId
router.get("/user/:userId", async (req, res) => {
    try {
        const data = await firestore.getUserScans(req.params.userId);
        res.json({ success: true, data });
    } catch (err) {
        console.error("[scans] user:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/scans/:id
router.get("/:id", async (req, res) => {
    try {
        const snap = await require("../services/firebase").db.collection("scans").doc(req.params.id).get();
        if (!snap.exists) return res.status(404).json({ error: "Scan not found" });
        res.json({ success: true, data: { id: snap.id, ...snap.data() } });
    } catch (err) {
        console.error("[scans] get:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
