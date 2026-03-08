const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs/promises");
const jwt = require("jsonwebtoken");
const path = require("path");

const { authMiddleware, JWT_SECRET } = require("../middleware/auth");

const router = express.Router();
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, "[]\n", "utf8");
  }
}

async function readUsers() {
  await ensureUsersFile();
  const raw = await fs.readFile(USERS_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

router.post("/signup", async (req, res) => {
  try {
    const name = (req.body?.name || "").trim();
    const email = (req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password || "";

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "Name, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
    }

    const users = await readUsers();
    const existingUser = users.find((user) => user.email === email);
    if (existingUser) {
      return res.status(409).json({ success: false, error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: `user_${Date.now()}`,
      name,
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users.push(user);
    await writeUsers(users);

    return res.json({
      success: true,
      token: createToken(user),
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("[auth signup]", err);
    return res.status(500).json({ success: false, error: "Could not create account." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = (req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password || "";

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }

    const users = await readUsers();
    const user = users.find((entry) => entry.email === email);
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, error: "Invalid email or password." });
    }

    return res.json({
      success: true,
      token: createToken(user),
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("[auth login]", err);
    return res.status(500).json({ success: false, error: "Could not log in." });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const users = await readUsers();
    const user = users.find((entry) => entry.id === req.user?.sub);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    return res.json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("[auth me]", err);
    return res.status(500).json({ success: false, error: "Could not load user." });
  }
});

module.exports = router;
