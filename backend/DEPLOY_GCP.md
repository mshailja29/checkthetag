# Deploy Backend to GCP

This backend is set up to run well on Cloud Run:

- `server.js` listens on `PORT` and binds to `0.0.0.0`
- Vertex AI reads `GCP_PROJECT_ID` and `GCP_REGION`

## 1. Set deployment variables

Replace `your-gcp-project-id` with your actual project ID.

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export SERVICE_NAME="check-the-tag-backend"
export REPOSITORY="check-the-tag"
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:latest"
```

## 2. Authenticate and select the project

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project "$PROJECT_ID"
```

## 3. Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com
```

## 4. Create the Artifact Registry repository

This is safe to run once. If the repo already exists, Google Cloud will tell you.

```bash
gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Docker images for Check the Tag backend"
```

## 5. Build the image from `backend`

Run this from the project root:

```bash
cd /Users/vanshikamehta/Desktop/check_the_tag

gcloud builds submit ./backend \
  --tag "$IMAGE"
```

## 6. Deploy to Cloud Run

This deploys the backend publicly and sets the env vars your code expects.

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --timeout 300 \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},GCP_REGION=${REGION}"
```

## 7. Grant Vertex AI access to the Cloud Run runtime identity

Get the service account used by Cloud Run:

```bash
RUNTIME_SA="$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)')"

if [ -z "$RUNTIME_SA" ]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

echo "$RUNTIME_SA"
```

Grant the role:

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/aiplatform.user"
```

## 8. Get the service URL and verify health

```bash
SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --format='value(status.url)')"

echo "$SERVICE_URL"
curl "$SERVICE_URL/health"
```

## 9. Point the Expo app to the deployed backend

The mobile app reads `EXPO_PUBLIC_API_URL`, so set it to the Cloud Run URL before running Expo locally:

```bash
export EXPO_PUBLIC_API_URL="$SERVICE_URL"
```

Or put this in your app `.env`:

```bash
EXPO_PUBLIC_API_URL=https://your-cloud-run-url
```

## Notes

- `backend/Dockerfile` is included for the container build used above.
- If Vertex AI requests fail after deployment, IAM is the first thing to check.
- If you later want a non-public API, remove `--allow-unauthenticated` and add auth in the client.
