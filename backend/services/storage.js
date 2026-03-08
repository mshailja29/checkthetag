/**
 * Google Cloud Storage service for uploading scan media (images/videos).
 */
const { Storage } = require("@google-cloud/storage");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

function findCredFile() {
    const backendDir = path.resolve(__dirname, "..");
    const candidates = [
        process.env.GOOGLE_APPLICATION_CREDENTIALS,
        "./gcloud-hackathon-vi0ysib4ateve-f2b5e719a4a6.json",
        "./service-account.json",
    ].filter(Boolean);
    for (const c of candidates) {
        const resolved = path.resolve(backendDir, c);
        if (fs.existsSync(resolved)) return resolved;
    }
    return undefined;
}

const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID || "gcloud-hackathon-vi0ysib4ateve",
    keyFilename: findCredFile(),
});

const BUCKET_NAME = process.env.GCS_BUCKET || "pricescout-media-vi0ysib4ateve";
const bucket = storage.bucket(BUCKET_NAME);

async function uploadBase64(base64Data, mimeType, userId, scanId, filename) {
    const ext = mimeType.includes("video") ? "mp4"
        : mimeType.includes("audio/mp4") || mimeType.includes("audio/m4a") ? "m4a"
            : mimeType.includes("audio/mpeg") ? "mp3"
                : mimeType.includes("audio/wav") ? "wav"
                    : mimeType.includes("audio") ? "audio"
                        : mimeType.includes("png") ? "png"
                            : mimeType.includes("webp") ? "webp"
                                : "jpg";

    const name = filename
        ? (filename.includes(".") ? filename : `${filename}.${ext}`)
        : `${uuidv4()}.${ext}`;
    const filePath = `scans/${userId}/${scanId}/${name}`;
    const file = bucket.file(filePath);

    const buffer = Buffer.from(base64Data, "base64");

    await file.save(buffer, {
        metadata: {
            contentType: mimeType,
            metadata: { userId, scanId },
        },
        resumable: false,
    });

    const gcsUri = `gs://${BUCKET_NAME}/${filePath}`;
    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filePath}`;

    return { gcsUri, publicUrl, filePath };
}

async function getSignedUrl(filePath) {
    const [url] = await bucket.file(filePath).getSignedUrl({
        action: "read",
        expires: Date.now() + 60 * 60 * 1000,
    });
    return url;
}

async function deleteFile(filePath) {
    await bucket.file(filePath).delete({ ignoreNotFound: true });
}

module.exports = { uploadBase64, getSignedUrl, deleteFile, bucket, BUCKET_NAME };
