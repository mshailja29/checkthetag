const express = require("express");
const router = express.Router();
const firestore = require("../services/firestore");

router.post("/", async (req, res) => {
    try {
        const userId = await firestore.createUser(req.body);
        res.json({ success: true, userId });
    } catch (err) {
        console.error("[users] create:", err);
        res.status(500).json({ error: err.message });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const data = await firestore.getUser(req.params.id);
        if (!data) return res.status(404).json({ error: "User not found" });
        res.json({ success: true, data });
    } catch (err) {
        console.error("[users] get:", err);
        res.status(500).json({ error: err.message });
    }
});

router.put("/:id/location", async (req, res) => {
    try {
        await firestore.updateUserLocation(req.params.id, req.body);
        res.json({ success: true });
    } catch (err) {
        console.error("[users] location:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
