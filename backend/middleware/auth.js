/**
 * Auth middleware placeholder — will be implemented in Phase 2.
 * For now, all requests pass through.
 */
function authMiddleware(req, res, next) {
    // Phase 2: Verify Firebase ID token from Authorization header
    // const idToken = req.headers.authorization?.split("Bearer ")[1];
    // if (!idToken) return res.status(401).json({ error: "Unauthorized" });
    // const decoded = await admin.auth().verifyIdToken(idToken);
    // req.user = decoded;
    next();
}

module.exports = { authMiddleware };
