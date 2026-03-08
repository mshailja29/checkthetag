#!/usr/bin/env node
/**
 * Fetches ngrok URL from local API and updates .env for tunnel mode.
 * Run ngrok in another terminal first: ngrok http 8080
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const envPath = path.join(__dirname, "..", ".env");

function fetchNgrokUrl() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const url = json.tunnels?.[0]?.public_url;
          resolve(url || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function main() {
  const url = await fetchNgrokUrl();
  if (!url) {
    console.log(`
To use tunnel mode:
1. Start your backend:  npm run backend
2. In another terminal run:  ngrok http 8080
3. Copy the https://...ngrok-free.app URL
4. Put it in .env:  EXPO_PUBLIC_API_URL=https://your-url.ngrok-free.app
5. Run:  npm run start:tunnel

(Install ngrok: brew install ngrok)
`);
    process.exit(1);
  }

  const httpsUrl = url.startsWith("https") ? url : url.replace("http:", "https:");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  if (envContent.includes("EXPO_PUBLIC_API_URL=")) {
    envContent = envContent.replace(
      /EXPO_PUBLIC_API_URL=.*/,
      `EXPO_PUBLIC_API_URL=${httpsUrl}`
    );
  } else {
    envContent += `\nEXPO_PUBLIC_API_URL=${httpsUrl}\n`;
  }
  fs.writeFileSync(envPath, envContent.trim() + "\n");
  console.log("Updated .env with ngrok URL:", httpsUrl);
}

main();
