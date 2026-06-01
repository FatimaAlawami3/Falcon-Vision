# Falcon Vision

AI-powered industrial safety monitoring system that combines computer vision, face recognition, and LLM-assisted regulation extraction.

Falcon Vision lets an organization upload its own safety regulation PDF, extract monitorable rules from it, choose which rules are active, and then run live monitoring for PPE compliance, fall detection, fire/smoke detection, face-based access control, and alert history.

## Table of Contents

- [Project Overview](#project-overview)
- [Main Features](#main-features)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [System Architecture](#system-architecture)
- [AI Modules](#ai-modules)
- [User Roles](#user-roles)
- [Requirements](#requirements)
- [Environment Variables](#environment-variables)
- [Local Setup](#local-setup)
- [Docker Setup](#docker-setup)
- [Frontend Deployment](#frontend-deployment)
- [Main Workflows](#main-workflows)
- [API Overview](#api-overview)
- [Model Assets](#model-assets)
- [Database Indexes](#database-indexes)
- [Testing and Checks](#testing-and-checks)
- [Troubleshooting](#troubleshooting)

## Project Overview

Falcon Vision is built for industrial safety monitoring. The system supports company-specific rules instead of hard-coded safety assumptions:

1. An admin registers an organization.
2. The admin uploads a safety regulation PDF.
3. The backend extracts safety requirements from the PDF.
4. Extracted rules are mapped to available vision modules.
5. The admin activates the rules/modules that should be monitored.
6. Supervisors run live monitoring from the dashboard.
7. The system detects violations and stores alerts with evidence images.

The project includes:

- A FastAPI backend with MongoDB persistence.
- A Vite/React frontend dashboard.
- YOLO-based PPE detection.
- YOLO pose + Random Forest fall detection.
- Fire/smoke detection with optional sensor fusion.
- Face recognition using RetinaFace/ArcFace-style ONNX models.
- LLM/local keyword rule extraction for regulation PDFs.

## Main Features

### Authentication and Accounts

- Organization registration.
- Admin and supervisor roles.
- JWT-based login.
- Password reset.
- Shared password strength requirements across sign up, reset password, profile updates, and supervisor account creation.
- Password visibility toggle for password fields.

Password requirements:

- At least 8 characters.
- Contains uppercase letter.
- Contains lowercase letter.
- Contains number.
- Contains symbol.

### Admin Dashboard

- Upload regulation PDFs.
- Extract safety rules from PDF files.
- View saved regulations.
- Switch active regulation.
- Download or delete regulation PDFs.
- Enable/disable extracted rules.
- Enable manual modules when the PDF does not explicitly contain them.
- Manage employees.
- Upload employee face images.
- Create, edit, suspend, or delete supervisor accounts.
- View and clear alert history.

### Supervisor Dashboard

- Start live monitoring.
- View live camera feed.
- See bounding boxes and labels over video frames.
- Receive live alerts for:
  - Missing PPE.
  - Falls.
  - Fire/smoke.
  - Unauthorized or unknown faces.
- Save monitoring session reports.
- View alert history.
- Update own profile.

### Regulation Extraction

- Upload PDF regulations.
- Extract PPE requirements.
- Extract fall monitoring requirements.
- Extract fire/smoke/heat monitoring requirements.
- Extract face recognition/access control requirements.
- Uses Hugging Face router/OpenAI-compatible API when `HF_TOKEN` is configured.
- Falls back to local keyword extraction when the external LLM is unavailable.

### Alerts

- Saves alerts per organization.
- Stores alert category, severity, status, time, zone, employee snapshot, and cropped evidence image.
- De-duplicates repeated alerts within a short time window.
- Supports alert history clearing and single-alert deletion.

## Tech Stack

### Backend

- Python 3.11
- FastAPI
- Uvicorn
- Motor / PyMongo
- MongoDB
- Pydantic v2
- JWT authentication with `python-jose`
- Password hashing with `passlib` and `bcrypt`
- OpenCV
- NumPy
- Ultralytics YOLO
- ONNX Runtime
- scikit-learn
- Docling / PyPDF2
- OpenAI Python SDK for Hugging Face router integration
- Azure Blob Storage support

### Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- Radix UI components
- Lucide React icons
- Sonner toast notifications

### Infrastructure

- Docker and Docker Compose for backend deployment.
- Vercel-compatible frontend rewrites.
- MongoDB database.
- Local filesystem or Azure Blob Storage for uploads/evidence files.

## Repository Structure

```text
Falcon-Vision/
  backend/
    app/
      api/                 FastAPI route definitions and dependencies
      core/                configuration, security, database, constants, validation
      integrations/        AI, storage, and notification clients
      models/              Mongo/Pydantic domain models
      repositories/        MongoDB data access layer
      schemas/             request/response schemas
      services/            business logic
      utils/               shared helpers
      main.py              FastAPI app entry point
    postman/               Postman API collection
    scripts/               database/setup helper scripts
    tests/                 test package placeholders
    Dockerfile             backend Docker image
    requirements.txt       Python dependencies

  frontend/
    src/
      app/
        components/        shared React components
        lib/               API/auth/password helpers
        pages/             public, admin, and supervisor pages
      assets/              images and logo
      styles/              CSS/theme files
    package.json
    vite.config.ts
    vercel.json

  PPE/                     PPE YOLO model and prototype notebook
  Fall model/              fall pose model, RF classifier, notebook
  Fire Detection/          fire/smoke prototype notebooks and ML artifacts
  Face Recognition/        face recognition prototype notebook
  LLM/                     LLM prototype notebook
  docker-compose.yml
  README.md
  vercel.json
```

## System Architecture

```text
React frontend
  |
  | REST / WebSocket / WebRTC-style monitoring requests
  v
FastAPI backend
  |
  | routes
  v
Services
  |
  | repositories              | integrations
  v                           v
MongoDB                    AI models / storage / LLM
```

Backend responsibilities are separated by layer:

- Routes receive HTTP/WebSocket requests.
- Schemas validate request and response shapes.
- Services contain business logic.
- Repositories handle MongoDB access.
- Integrations wrap model inference, file storage, and external providers.

## AI Modules

### PPE Detection

Path:

```text
PPE/PPE_model.pt
```

The PPE service uses the YOLO model to detect PPE and missing-PPE classes. Live monitoring filters detections based on the active regulation rules, so the system only alerts for PPE that is required by the uploaded regulation.

Supported classes include:

- Coverall
- Ear Protectors
- Face Shield
- Gloves
- Helmet
- Mask
- Safety Glasses
- Safety Harness
- Safety Shoes
- Safety Vest
- Corresponding `No ...` violation classes

### Fall Detection

Paths:

```text
Fall model/fall_model.pt
Fall model/fall_classifier_RF.pkl
```

The fall pipeline uses a pose model and a Random Forest classifier. Detection is activated when the active regulation contains a fall-related rule or the admin manually enables fall monitoring.

### Fire and Smoke Detection

Main backend model path:

```text
backend/app/integrations/ai/fire_detection/best.pt
```

Prototype and ML artifacts:

```text
Fire Detection/
```

The service supports image-only detection and optional multimodal fusion with sensor data. Fire detection can be disabled with `FIRE_DETECTION_ENABLED=false`.

### Face Recognition

Face images are uploaded per employee. Recognition is enabled only when an active access-control rule exists, usually through extracted or manually enabled face recognition rules.

The face recognition client downloads/caches required ONNX models from InsightFace release assets when needed. In Docker, the cache is persisted through the `insightface_cache` volume.

### Regulation Rule Extraction

The regulation extractor:

- Reads text directly from PDFs with PyPDF2 when possible.
- Uses Docling/OCR fallback for pages with weak text extraction.
- Uses an LLM when `HF_TOKEN` is configured.
- Falls back to local keyword extraction when no token is configured or the provider fails.

Extracted rule categories:

- PPE
- Fall
- Fire/smoke
- Access control / face recognition

## User Roles

### Admin

Admins can:

- Register an organization.
- Upload and manage regulation PDFs.
- Extract and select monitoring rules.
- Manage employees.
- Upload employee face images.
- Manage supervisor accounts.
- View monitoring and alert history.

### Supervisor

Supervisors can:

- Run monitoring sessions.
- View live safety results.
- Save session reports.
- View alert history.
- Update their own profile.

## Requirements

Install these before running locally:

- Python 3.11+
- Node.js 18+
- npm
- MongoDB connection string
- Git
- For local AI inference: enough disk/RAM for YOLO, OpenCV, Torch, ONNX Runtime, and model files

Docker users need:

- Docker
- Docker Compose

## Environment Variables

Create a root `.env` file. The backend reads from `.env` and `../.env`. The frontend Vite config also reads environment variables from the repo root.

Example:

```env
APP_NAME=Falcon Vision
ENVIRONMENT=development
DEBUG=true

MONGO_URI=mongodb+srv://username:password@cluster.example.mongodb.net/
MONGO_DB_NAME=falcon_vision

JWT_SECRET_KEY=change-this-secret-before-production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60

UPLOAD_DIR=uploads
MAX_PDF_SIZE_MB=25
MAX_FACE_IMAGE_SIZE_MB=10
FIRE_DETECTION_ENABLED=true

# Optional Azure Blob Storage.
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=fv
AZURE_STORAGE_URL_EXPIRY_MINUTES=60

# Optional LLM extraction through Hugging Face router.
HF_TOKEN=

# Frontend.
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_SUPPORT_EMAIL=falcon.vision.support@gmail.com
```

Important notes:

- Do not commit real `.env` secrets.
- Use a strong `JWT_SECRET_KEY` in production.
- If `AZURE_STORAGE_CONNECTION_STRING` is empty, local file storage is used.
- If `HF_TOKEN` is empty, regulation extraction still works with local keyword fallback.

## Local Setup

### 1. Clone the Repository

```powershell
git clone https://github.com/FatimaAlawami3/Falcon-Vision.git
cd Falcon-Vision
```

### 2. Backend Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create database indexes:

```powershell
python scripts/create_indexes.py
```

Optional MongoDB connection check:

```powershell
python scripts/check_mongo_connection.py
```

Start the backend:

```powershell
uvicorn app.main:app --reload
```

Backend URLs:

```text
API:     http://127.0.0.1:8000
Swagger: http://127.0.0.1:8000/docs
Health:  http://127.0.0.1:8000/api/health
```

### 3. Frontend Setup

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

### 4. Build Frontend

```powershell
cd frontend
npm run build
```

## Docker Setup

The repository includes a backend-only Docker setup:

```powershell
docker compose up --build
```

Docker service:

- `backend`: runs FastAPI with `python:3.11-slim` on port `8000`.

Docker notes:

- `docker-compose.yml` reads environment variables from the root `.env`.
- The backend image copies model directories from the repo root:
  - `PPE`
  - `Fall model`
  - `Fire Detection`
  - `Face Recognition`
- Uploaded files are stored in the `falcon_uploads` named volume.
- Face recognition model cache is stored in the `insightface_cache` named volume.
- This setup is intended to sit behind your own reverse proxy such as nginx.

## Frontend Deployment

The frontend is Vercel-compatible. The root `vercel.json` and `frontend/vercel.json` include SPA rewrites so browser routes still load `index.html`.

Rewrite behavior:

- Frontend routes are rewritten to `/index.html`.
- `/api/...` and `/uploads/...` are excluded from the rewrite.

Typical production setup:

1. Deploy backend separately.
2. Deploy frontend to Vercel.
3. Set `VITE_API_BASE_URL` to the backend URL.
4. Set `VITE_SUPPORT_EMAIL` if needed.

## Main Workflows

### Organization Registration

1. User opens Sign Up.
2. Creates an organization and admin account.
3. Backend creates:
   - Organization document.
   - Admin user document.
4. Admin logs in and lands on the admin dashboard.

### Regulation Upload and Extraction

1. Admin uploads a PDF regulation.
2. Backend stores the PDF.
3. Admin starts extraction.
4. Backend extracts rules from the PDF.
5. Rules are saved under the active regulation.
6. Admin selects active PPE items and monitoring modules.
7. Monitoring uses only active rules.

### Employee and Face Setup

1. Admin creates employee records.
2. Admin uploads employee face images.
3. Images are stored.
4. Embeddings are created lazily during recognition if missing.
5. Face recognition compares live faces against the employee gallery.

### Live Monitoring

1. Supervisor opens Monitoring.
2. Browser captures frames from camera video.
3. Frames are sent to the backend through the monitoring endpoint/socket.
4. Backend runs enabled modules:
   - PPE
   - Fall
   - Fire/smoke
5. Frontend draws overlays and shows alerts.
6. Backend stores alert evidence when a violation is created.

### Alert History

1. Alerts are listed by organization.
2. Admin/supervisor can view alert history.
3. Admin can clear/delete alert history.
4. Alert evidence files are deleted when alert documents are removed.

## API Overview

Swagger UI:

```text
http://127.0.0.1:8000/docs
```

Main route groups:

| Area | Prefix | Purpose |
| --- | --- | --- |
| Health | `/api/health` | Backend health check |
| Auth | `/api/auth` | Register, login, reset password, current user |
| Users | `/api/users` | Admin/supervisor user management |
| Employees | `/api/employees` | Employee directory |
| Employee Faces | `/api/employee-faces` | Face upload and recognition |
| Regulations | `/api/regulations` | PDF upload, extraction, rules, modules |
| PPE | `/api/ppe` | PPE detection and compliance |
| Fall | `/api/fall` | Fall detection |
| Fire | `/api/fire` | Fire/smoke detection |
| Monitoring | `/api/monitoring` | Live combined safety detection |
| Monitoring Sessions | `/api/monitoring-sessions` | Save monitoring reports |
| Alerts | `/api/alerts` | Alert history |

Postman collection:

```text
backend/postman/FalconVision.postman_collection.json
```

## Model Assets

The project expects model files to remain in these paths:

```text
PPE/PPE_model.pt
Fall model/fall_model.pt
Fall model/fall_classifier_RF.pkl
backend/app/integrations/ai/fire_detection/best.pt
Fire Detection/ml_lr_classifier.pkl
Fire Detection/ml_lrـscaler.pkl
Fire Detection/ml_lrـlabel_encoder.pkl
```

Notes:

- Some fire sensor ML files are prototype artifacts and may be optional depending on the path used by the backend.
- The face recognition client downloads/caches InsightFace ONNX files when needed.
- Large model files should be treated carefully when cloning, deploying, or moving the project.

## Database Indexes

Run this after configuring MongoDB:

```powershell
cd backend
python scripts/create_indexes.py
```

The script creates indexes for:

- Organizations
- Users
- Regulations
- Extracted rules
- Extraction jobs
- Employees
- Employee faces
- Zones
- Cameras
- Monitoring sessions
- Detections
- Alerts
- Notifications
- Audit logs

## Testing and Checks

Current repository status:

- Test folders exist under `backend/tests`.
- No full automated test suite is currently implemented.

Useful checks:

```powershell
# Frontend production build
cd frontend
npm run build

# Backend syntax/import compile check
cd backend
python -m compileall app
```

If Python validation/import checks fail because dependencies are missing, install backend requirements first:

```powershell
cd backend
pip install -r requirements.txt
```

## Troubleshooting

### MongoDB connection fails

- Check `MONGO_URI`.
- Check `MONGO_DB_NAME`.
- Confirm IP/network access for MongoDB Atlas if used.
- Run:

```powershell
cd backend
python scripts/check_mongo_connection.py
```

### CORS errors from frontend

- Make sure `VITE_API_BASE_URL` points to the backend.
- Make sure the frontend origin is included in `CORS_ORIGINS` in backend settings.

Default backend CORS origins include local Vite ports and:

```text
https://falcon-vision.site
https://www.falcon-vision.site
```

### Regulation extraction fails

- Confirm the uploaded file is a PDF.
- Check file size against `MAX_PDF_SIZE_MB`.
- If the PDF is scanned, OCR may take longer.
- If no `HF_TOKEN` is configured, extraction uses local keyword fallback.
- If the LLM provider has no credits or is unavailable, the extractor falls back where possible.

### PPE model not found

Confirm:

```text
PPE/PPE_model.pt
```

exists from the repository root.

### Fall model not found

Confirm:

```text
Fall model/fall_model.pt
Fall model/fall_classifier_RF.pkl
```

exist from the repository root.

### Fire detector unavailable

Confirm:

```text
backend/app/integrations/ai/fire_detection/best.pt
```

exists, and check:

```env
FIRE_DETECTION_ENABLED=true
```

### Face recognition is disabled

Face recognition only runs when access control is enabled for the organization. Enable it from the regulation controls or make sure the active regulation contains an access-control rule.

### Uploaded/evidence images do not show

- Local storage uses `UPLOAD_DIR`.
- The backend mounts `/uploads`.
- Azure Blob Storage requires `AZURE_STORAGE_CONNECTION_STRING`.

## Notes for Contributors

- Keep secrets out of Git.
- Keep model files in the expected paths unless the service code is updated.
- Prefer adding validation in schemas and shared helpers rather than duplicating rules in services/pages.
- Keep backend route logic thin; put business rules in services.
- Keep frontend API calls centralized in `frontend/src/app/lib/api.ts`.
- Run `npm run build` after frontend changes.

