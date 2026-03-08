const express = require("express");
const router = express.Router();
const firestore = require("../services/firestore");

// POST /api/prices — create single price
router.post("/", async (req, res) => {
    try {
        const priceId = await firestore.createPrice(req.body);
        res.json({ success: true, priceId });
    } catch (err) {
        console.error("[prices] create:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/prices/batch — save multiple items
router.post("/batch", async (req, res) => {
    try {
        const { items, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId } = req.body;
        if (!Array.isArray(items)) return res.status(400).json({ error: "items must be an array" });
        const priceIds = await firestore.saveExtractedItems({
            items, storeName, storeId, storeLatitude, storeLongitude, userId, scanSource, scanId,
        });
        res.json({ success: true, count: priceIds.length, priceIds });
    } catch (err) {
        console.error("[prices] batch:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/search
router.get("/search", async (req, res) => {
    try {
        const data = await firestore.searchPrices(req.query.q);
        res.json({ success: true, data });
    } catch (err) {
        console.error("[prices] search:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/product/:name
router.get("/product/:name", async (req, res) => {
    try {
        const data = await firestore.findPricesForProduct(decodeURIComponent(req.params.name));
        res.json({ success: true, data });
    } catch (err) {
        console.error("[prices] product:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/nearby
router.get("/nearby", async (req, res) => {
    try {
        const { product, lat, lng, radius } = req.query;
        if (!product || !lat || !lng) return res.status(400).json({ error: "product, lat, lng required" });
        const data = await firestore.findPricesNearby(
            decodeURIComponent(product), parseFloat(lat), parseFloat(lng), parseFloat(radius) || 3
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error("[prices] nearby:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/compare
router.get("/compare", async (req, res) => {
    try {
        const { product, lat, lng, radius } = req.query;
        if (!product) return res.status(400).json({ error: "product required" });
        const allPrices = await firestore.findPricesForProduct(decodeURIComponent(product));
        let nearbyPrices = [];
        if (lat && lng) {
            nearbyPrices = await firestore.findPricesNearby(
                decodeURIComponent(product), parseFloat(lat), parseFloat(lng), parseFloat(radius) || 3
            );
        }
        const cheapestOverall = allPrices.length > 0 ? allPrices[0] : null;
        const cheapestNearby = nearbyPrices.length > 0 ? nearbyPrices[0] : null;
        res.json({
            success: true,
            data: { allPrices, nearbyPrices, cheapestOverall, cheapestNearby },
        });
    } catch (err) {
        console.error("[prices] compare:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/prices/store/:storeId
router.get("/store/:storeId", async (req, res) => {
    try {
        const data = await firestore.findPricesByStore(req.params.storeId);
        res.json({ success: true, data });
    } catch (err) {
        console.error("[prices] store:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
