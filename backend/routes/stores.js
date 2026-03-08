const express = require("express");
const router = express.Router();
const firestore = require("../services/firestore");

// POST /api/stores — create store
router.post("/", async (req, res) => {
    try {
        const storeId = await firestore.createStore(req.body);
        res.json({ success: true, storeId });
    } catch (err) {
        console.error("[stores] create:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stores — list all
router.get("/", async (_req, res) => {
    try {
        const data = await firestore.getAllStores();
        res.json({ success: true, data });
    } catch (err) {
        console.error("[stores] list:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stores/nearby
router.get("/nearby", async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
        const data = await firestore.findStoresNearby(
            parseFloat(lat), parseFloat(lng), parseFloat(radius) || 3
        );
        res.json({ success: true, data });
    } catch (err) {
        console.error("[stores] nearby:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stores/search
router.get("/search", async (req, res) => {
    try {
        const { name } = req.query;
        if (!name) return res.status(400).json({ error: "name required" });
        const data = await firestore.findStoreByName(name);
        res.json({ success: true, data: data ? [data] : [] });
    } catch (err) {
        console.error("[stores] search:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/stores/:id
router.get("/:id", async (req, res) => {
    try {
        const data = await firestore.getStore(req.params.id);
        if (!data) return res.status(404).json({ error: "Store not found" });
        res.json({ success: true, data });
    } catch (err) {
        console.error("[stores] get:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
