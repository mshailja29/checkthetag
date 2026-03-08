const express = require("express");
const router = express.Router();
const firestore = require("../services/firestore");
const storage = require("../services/storage");
const { v4: uuidv4 } = require("uuid");

function sanitizeParts(parts) {
    if (!Array.isArray(parts)) return { textInputs: [], mediaParts: [] };

    const textInputs = [];
    const mediaParts = [];

    for (const part of parts) {
        if (part?.type === "text" && typeof part.value === "string" && part.value.trim()) {
            textInputs.push(part.value.trim());
            continue;
        }

        if ((part?.type === "image" || part?.type === "video" || part?.type === "audio") && typeof part.base64 === "string" && part.base64) {
            mediaParts.push({
                type: part.type,
                base64: part.base64,
                mimeType: part.mimeType || (
                    part.type === "video" ? "video/mp4"
                        : part.type === "audio" ? "audio/mpeg"
                            : "image/jpeg"
                ),
            });
        }
    }

    return { textInputs, mediaParts };
}

function buildExtractedSummary(extractedData) {
    if (!Array.isArray(extractedData) || extractedData.length === 0) {
        return { itemCount: 0, productNames: [], brands: [] };
    }

    const productNames = [...new Set(extractedData
        .map((entry) => (entry?.item || entry?.name || "").trim())
        .filter(Boolean))];
    const brands = [...new Set(extractedData
        .map((entry) => (entry?.brand || "").trim())
        .filter(Boolean))];

    return {
        itemCount: extractedData.length,
        productNames,
        brands,
    };
}

// POST /api/scans — upload media, save scan + prices
router.post("/", async (req, res) => {
    try {
        const {
            userId,
            image,
            mimeType,
            scanType,
            storeName,
            storeId,
            latitude,
            longitude,
            extractedData,
            parts,
            locationLabel,
            user,
            storeContext,
        } = req.body;
        if (!userId) return res.status(400).json({ error: "userId required" });

        const scanId = uuidv4();
        let mediaUrl = null;
        let mediaPath = null;
        let uploadedMediaItems = [];

        const { textInputs, mediaParts } = sanitizeParts(parts);

        if (mediaParts.length > 0) {
            uploadedMediaItems = await Promise.all(
                mediaParts.map(async (part, index) => {
                    const uploaded = await storage.uploadBase64(
                        part.base64,
                        part.mimeType,
                        userId,
                        scanId,
                        `${part.type}-${index + 1}`
                    );
                    return {
                        type: part.type,
                        mimeType: part.mimeType,
                        mediaUrl: uploaded.publicUrl,
                        mediaPath: uploaded.filePath,
                    };
                })
            );

            mediaUrl = uploadedMediaItems[0]?.mediaUrl || null;
            mediaPath = uploadedMediaItems[0]?.mediaPath || null;
        }

        // Upload media to GCS if provided
        if (!mediaUrl && image) {
            const uploaded = await storage.uploadBase64(image, mimeType || "image/jpeg", userId, scanId);
            mediaUrl = uploaded.publicUrl;
            mediaPath = uploaded.filePath;
            uploadedMediaItems = [{
                type: (mimeType || "").includes("video") ? "video" : (mimeType || "").includes("audio") ? "audio" : "image",
                mimeType: mimeType || "image/jpeg",
                mediaUrl,
                mediaPath,
            }];
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
        const primaryMimeType = mimeType || uploadedMediaItems[0]?.mimeType || null;

        const savedScanId = await firestore.createScan({
            userId, mediaUrl, mediaPath, mimeType: primaryMimeType, scanType,
            storeName, storeId: resolvedStoreId, latitude, longitude, extractedData,
            mediaItems: uploadedMediaItems,
            textInputs,
            locationLabel,
            userSnapshot: user || null,
            storeContext: storeContext || null,
            extractedSummary: buildExtractedSummary(extractedData),
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
