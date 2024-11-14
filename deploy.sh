#!/bin/bash

PROJECT_ID="imposing-terra-439320-g4"
APP_NAME="pdf-form-filler"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${APP_NAME}:latest"
REGION="us-central1"

gcloud builds submit --tag "${IMAGE_NAME}"
gcloud run deploy pdf-form-filler \
    --image "${IMAGE_NAME}" \
    --platform managed \
    --region "${REGION}" \
    --allow-unauthenticated
