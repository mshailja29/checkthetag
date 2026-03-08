# PriceScout AI

**Smart grocery price comparison powered by Google Gemini 2.5 Flash**

PriceScout AI is a mobile app that helps shoppers find the best grocery prices in real time. Point your camera at any product, ask a question by voice, and get instant answers — powered by an agentic AI that searches both a crowdsourced price database and the web.

---

## Features

### Live Voice + Vision Assistant
- Point your camera at any product and tap the mic
- **Continuous conversation mode** — automatic silence detection, auto-restart listening after AI responds
- AI identifies the product from the camera image, searches the database, and answers with text-to-speech
- Status indicators: "Listening..." / "Thinking..." / "Speaking..."

### Multi-Modal Price Scanning
- Scan **receipts**, **shelf tags**, **product photos**, or **videos**
- AI extracts item names, brands, prices, and weights automatically
- Prices are saved to the cloud database for the community

### Price Comparison
- Search for any product to compare prices across stores
- Location-aware — finds prices at nearby stores within your radius
- AI-powered natural language queries ("Where's the cheapest milk near me?")

### Agentic AI Architecture
- **Phase 0**: Gemini analyzes camera image + audio to identify the product and understand the question
- **Phase 1**: AI autonomously calls Firestore database tools (`search_prices_nearby`, `find_stores_nearby`, `compare_prices`, `search_prices`)
- **Phase 2**: Google Search grounding supplements database results with web data
- Streamed responses for real-time chat experience

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile App | React Native 0.81 + Expo SDK 54 |
| AI Model | Google Gemini 2.5 Flash (Vertex AI) |
| Database | Google Cloud Firestore |
| Storage | Google Cloud Storage |
| Backend | Node.js + Express |
| Auth | JWT + bcrypt |
| Voice I/O | expo-av (recording) + expo-speech (TTS) |
| Camera | expo-camera (live preview + snapshots) |
| Location | expo-location (geospatial queries) |

---

## Architecture

```
Mobile App (React Native / Expo)
  |
  |-- Camera --> captures product image
  |-- Microphone --> records voice question
  |-- Location --> provides lat/lng for nearby search
  |
  +-- API Client --> Express Backend (Node.js)
        |
        |-- Phase 0: Gemini Vision + Audio --> identifies product & question
        |-- Phase 1: Agentic Function Calling --> searches Firestore DB
        |-- Phase 2: Google Search Grounding --> supplements with web data
        |
        |-- Firestore --> stores, prices, products, scans, users
        +-- Cloud Storage --> receipt/scan media files
```

---

## Project Structure

```
checkthetag/
├── screens/
│   ├── LoginScreen.js          # Email/password auth
│   ├── SignupScreen.js         # User registration
│   ├── LocationScreen.js       # Geolocation setup
│   ├── RadiusScreen.js         # Search radius config
│   ├── HomeScreen.js           # Dashboard
│   ├── AddPricesScreen.js      # Multi-modal price scanning
│   ├── CheckPricesScreen.js    # Price search & comparison
│   └── RealtimeAskScreen.js    # Live voice + camera assistant
├── backend/
│   ├── routes/
│   │   ├── geminiProxy.js      # AI endpoints (3-phase agentic pipeline)
│   │   ├── auth.js             # Signup/login/JWT
│   │   ├── stores.js           # Store CRUD + nearby search
│   │   ├── prices.js           # Price CRUD + comparison
│   │   ├── scans.js            # Scan upload + extraction
│   │   ├── users.js            # User profiles
│   │   └── receipt.js          # Receipt extraction
│   ├── services/
│   │   ├── firebase.js         # Firebase Admin init
│   │   ├── firestore.js        # All Firestore operations
│   │   ├── geolocation.js      # Geohash + Haversine distance
│   │   └── storage.js          # GCS media uploads
│   └── server.js               # Express entry point
├── apiClient.js                # Frontend HTTP client
├── gemini.js                   # AI wrapper functions
├── database.js                 # Local SQLite (offline fallback)
├── theme.js                    # Design system tokens
└── App.js                      # Navigation root
```

---

## API Endpoints

### AI / Gemini
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/gemini/extract-prices` | Extract items from image/video/audio |
| POST | `/api/gemini/query-prices` | AI-powered price query |
| POST | `/api/gemini/realtime-ask` | Voice + image question (3-phase) |
| POST | `/api/gemini/realtime-ask-stream` | Streamed version (NDJSON) |

### Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/prices/batch` | Save multiple prices |
| GET | `/api/prices/nearby` | Find prices near location |
| GET | `/api/prices/compare` | Compare across stores |
| GET | `/api/stores/nearby` | Find stores near location |
| POST | `/api/scans` | Upload scan with auto-extraction |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user |

---

## Setup

### Prerequisites
- Node.js >= 18
- Expo CLI (`npm install -g expo-cli`)
- Google Cloud project with Vertex AI, Firestore, and Cloud Storage enabled
- Firebase service account key

### Backend
```bash
cd backend
npm install
# Create .env with:
#   GCP_PROJECT_ID=your-project-id
#   GCP_REGION=us-central1
#   PORT=8080
#   GCS_BUCKET=your-bucket-name
node server.js
```

### Frontend
```bash
npm install
# Create .env with:
#   EXPO_PUBLIC_API_URL=http://your-backend-url:8080
npx expo start
```

### For device testing (same Wi-Fi issues)
```bash
# Terminal 1: Backend
node backend/server.js

# Terminal 2: ngrok tunnel
ngrok http 8080

# Terminal 3: Expo
npx expo start

# Update .env with ngrok URL
```

---

## Google Cloud Services Used

- **Vertex AI** — Gemini 2.5 Flash for multimodal understanding (image + audio + text)
- **Cloud Firestore** — NoSQL database with geospatial queries (geohash-based)
- **Cloud Storage** — Media file storage for scans and receipts
- **Google Search Grounding** — Web search integration for real-time price data

---

## Team

Built at Columbia Hackathon 2026
