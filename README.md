# Falcon Vision

Falcon Vision is an industrial safety monitoring project with a FastAPI backend, MongoDB, JWT authentication, employee face enrollment, and monitoring-time face recognition.

This repository currently contains the backend code and project documentation. The frontend exists in a separate local project and is not included in this repository.

## Current scope

Implemented backend modules in this repo:

- organization registration and login
- role-based authentication with only two dashboard roles: `admin` and `supervisor`
- user CRUD for dashboard users
- employee CRUD for real monitored workers
- employee face image upload
- face recognition during monitoring
- Postman collection for testing

## Important model

The project uses two different concepts:

- `users`: dashboard accounts that log in to the system
- `employees`: real people monitored by cameras

Face recognition is linked to `employees`, not `users`.

## Roles

Only these dashboard roles should be used going forward:

- `admin`
- `supervisor`

The backend currently normalizes some older role values for compatibility with older data, but new work should use only `admin` and `supervisor`.

## Face recognition flow

The current face-recognition flow works like this:

1. Create an employee in `/api/employees`
2. Upload one or more employee face images in `/api/employee-faces/upload`
3. Start monitoring from the frontend
4. The frontend captures frames from the browser camera
5. The backend runs recognition when frames are sent to `/api/employee-faces/recognize`

Important:

- face upload only stores the image files and metadata
- the model is not invoked during upload
- recognition happens during monitoring

## Repo structure

```text
FalconVision/
├── backend/
│   ├── app/
│   ├── postman/
│   ├── scripts/
│   ├── requirements.txt
│   └── README.md
├── docs/
└── .env
```

## Backend setup

From the project root:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python scripts/create_indexes.py
uvicorn app.main:app --reload
```

API will run at:

- `http://127.0.0.1:8000`
- Swagger docs: `http://127.0.0.1:8000/docs`

## Environment variables

The backend reads settings from `.env` at the repo root or inside `backend/`.

Main settings used right now:

- `MONGO_URI`
- `MONGO_DB_NAME`
- `JWT_SECRET_KEY`
- `JWT_ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`
- `UPLOAD_DIR`
- `MAX_FACE_IMAGE_SIZE_MB`
- `MAX_PDF_SIZE_MB`

## Installed backend dependencies

Main backend stack:

- FastAPI
- Uvicorn
- MongoDB Motor
- Pydantic v2
- JWT auth with `python-jose`
- bcrypt / passlib
- `onnxruntime`
- `opencv-python-headless`
- `numpy`

## Implemented API routes

Currently active routes:

- `GET /api/health`
- `POST /api/auth/register-organization`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/users`
- `GET /api/users`
- `GET /api/users/{user_id}`
- `PATCH /api/users/{user_id}`
- `PATCH /api/users/{user_id}/status`
- `DELETE /api/users/{user_id}`
- `POST /api/employees`
- `GET /api/employees`
- `GET /api/employees/{employee_id}`
- `PATCH /api/employees/{employee_id}`
- `DELETE /api/employees/{employee_id}`
- `POST /api/employee-faces/upload`
- `POST /api/employee-faces/recognize`

## Recommended test order

Use the Postman collection at:

```text
backend/postman/FalconVision.postman_collection.json
```

Recommended order:

1. Register organization
2. Login
3. Create employee
4. Upload employee faces
5. Recognize employee face
6. Create supervisor users if needed

## Notes for teammates

- use `employees` for face recognition, not `users`
- upload the face images first before testing monitoring recognition
- if you change collection structure, update `scripts/create_indexes.py`
- if you add new routes, keep business logic in services and Mongo queries in repositories
