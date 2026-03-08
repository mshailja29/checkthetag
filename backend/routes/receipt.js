const express = require("express");
const { extractReceiptFromImage } = require("../services/vertexai");

const router = express.Router();

/**
 * POST /api/extract-receipt
 * Body: { image: string (base64), mimeType: string }
 * Returns: structured receipt JSON
 */
router.post("/extract-receipt", async (req, res) => {
    try {
        const { image, mimeType } = req.body;

        if (!image || typeof image !== "string") {
            return res.status(400).json({ error: "Missing or invalid 'image' field (base64 string required)" });
        }

        const type = mimeType || "image/jpeg";
        console.log(`[receipt] Extracting receipt (${(image.length / 1024).toFixed(0)} KB base64, type: ${type})`);

        const receiptData = await extractReceiptFromImage(image, type);

        console.log(`[receipt] Extracted: ${receiptData.items.length} items from "${receiptData.storeName}"`);

        return res.json({ success: true, data: receiptData });
    } catch (err) {
        console.error("[receipt] Error:", err.message);
        return res.status(500).json({ error: err.message || "Failed to extract receipt data" });
    }
});

module.exports = router;
