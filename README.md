# Falcon Vision

Falcon Vision is a senior project that uses artificial intelligence to support industrial safety monitoring. The system combines computer vision, face recognition, and regulation analysis to help organizations detect safety violations in real time.

The main idea of the project is to allow each organization to upload its own safety regulation document. The system extracts useful safety rules from the document and uses them during monitoring, instead of relying only on fixed rules.

## Project Idea

Industrial workplaces can include many safety risks, such as missing personal protective equipment, falls, fire or smoke, and unauthorized access to restricted areas. Manual monitoring can be difficult because supervisors may not be able to observe every area continuously.

Falcon Vision aims to support supervisors by analyzing camera frames and detecting possible safety violations automatically. The system also connects the monitoring process with company-specific safety regulations, so the detection results are related to the rules selected by the organization.

## Problem Statement

Many industrial safety systems detect only predefined hazards. However, safety requirements can differ from one company to another depending on the work environment, equipment, and internal regulations. This creates a need for a flexible monitoring system that can understand uploaded safety documents and apply the extracted requirements during monitoring.

Falcon Vision addresses this problem by combining:

- Regulation rule extraction.
- PPE compliance detection.
- Fall detection.
- Fire and smoke detection.
- Face recognition for access control.
- A dashboard for admins and supervisors.

## Project Objectives

The objectives of Falcon Vision are:

- To build an AI-powered monitoring system for industrial safety.
- To extract safety rules from uploaded regulation PDF files.
- To detect PPE violations based on the active regulation.
- To detect falls in monitored areas.
- To detect fire and smoke hazards.
- To recognize employee faces for access-control monitoring.
- To generate and store safety alerts with evidence.
- To provide separate dashboards for admins and supervisors.

## System Overview

Falcon Vision is a web-based system with two main parts:

- Frontend dashboard: used by admins and supervisors to manage the system and view monitoring results.
- Backend API: handles authentication, database operations, regulation extraction, AI model calls, and alert management.

The system stores organization data, users, employees, regulations, extracted rules, face images, monitoring reports, and alerts in MongoDB.

## Main Features

### Authentication

- Organization sign up.
- Login for admins and supervisors.
- Password reset.
- Profile update.
- Strong password requirements.
- Password show/hide option.

### Regulation Management

- Admins can upload safety regulation PDF files.
- The system extracts safety rules from the uploaded document.
- Admins can activate or deactivate extracted rules.
- Admins can enable monitoring modules manually if needed.
- The active regulation controls what the system monitors.

### Employee Management

- Admins can add, edit, and delete employee records.
- Employee information includes ID, name, department, job title, phone, email, and PPE requirements.
- Employee records are used with face recognition and monitoring workflows.

### Face Recognition Management

- Admins can upload employee face images.
- The system uses uploaded images as the employee face gallery.
- During monitoring, detected faces can be compared with stored employee faces.
- Unknown or unauthorized faces can generate alerts when face recognition is enabled.

### Live Monitoring

Supervisors can use the monitoring page to analyze live camera frames. The system can detect:

- Missing PPE.
- Falls.
- Fire or smoke.
- Unknown or unauthorized faces.

The frontend displays detection boxes and alert information during monitoring.

### Alert History

- Alerts are stored for each organization.
- Alerts include category, severity, time, zone, message, and evidence image when available.
- Admins and supervisors can view alert history.
- Admins can clear or delete alerts.

### Monitoring Reports

Supervisors can save a monitoring session report that summarizes:

- Session time.
- Zone.
- Number of alerts.
- Alert categories.
- Active monitoring modules.
- Whether face recognition was enabled.

## AI Components

### PPE Detection

The PPE module detects safety equipment and missing equipment. It supports items such as helmets, gloves, masks, safety vests, safety shoes, safety glasses, face shields, coveralls, ear protectors, and safety harnesses.

The system compares the detected PPE results with the PPE rules extracted from the active regulation.

### Fall Detection

The fall detection module analyzes people in camera frames and classifies whether a person appears to have fallen. This module supports supervisors by generating alerts when a fall is detected in a monitored area.

### Fire and Smoke Detection

The fire detection module identifies fire and smoke in camera frames. It can also support multimodal detection when sensor data is provided.

### Face Recognition

The face recognition module compares detected faces with uploaded employee face images. It is used for access-control related monitoring, such as detecting unknown or unauthorized people.

### Regulation Rule Extraction

The regulation extraction module reads uploaded PDF documents and extracts safety requirements. These requirements are converted into system rules that can be used by the monitoring modules.

The extracted rules can include:

- Required PPE items.
- Fall-related monitoring rules.
- Fire or smoke monitoring rules.
- Face recognition or access-control rules.

## User Roles

### Admin

The admin is responsible for setting up and managing the organization inside the system. Admin features include:

- Uploading regulation files.
- Extracting and selecting safety rules.
- Managing employees.
- Uploading employee face images.
- Managing supervisor accounts.
- Viewing and clearing alert history.

### Supervisor

The supervisor is responsible for monitoring safety conditions. Supervisor features include:

- Running live monitoring.
- Viewing real-time alerts.
- Viewing alert history.
- Saving monitoring session reports.
- Updating profile information.

## System Workflow

The general workflow of the system is:

1. The admin creates an organization account.
2. The admin uploads a safety regulation PDF.
3. The system extracts safety rules from the PDF.
4. The admin selects the rules and modules that should be active.
5. The admin adds employees and uploads employee face images.
6. The supervisor starts monitoring.
7. Camera frames are analyzed by the AI modules.
8. Safety violations are shown on the dashboard.
9. Alerts are saved in the alert history.
10. The supervisor can save a monitoring report.

## Technologies Used

### Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- Radix UI
- Lucide icons

### Backend

- Python
- FastAPI
- MongoDB
- Motor / PyMongo
- Pydantic
- JWT authentication
- OpenCV
- NumPy
- Ultralytics YOLO
- ONNX Runtime
- scikit-learn

### AI and Document Processing

- YOLO models for object detection.
- Pose-based fall detection.
- Face detection and recognition.
- PDF text extraction.
- LLM-assisted rule extraction with local fallback.

## Repository Overview

```text
Falcon-Vision/
  backend/              Backend API, services, schemas, repositories, and AI integrations
  frontend/             React web dashboard
  PPE/                  PPE detection model and notebook
  Fall model/           Fall detection model and notebook
  Fire Detection/       Fire detection notebooks and related files
  Face Recognition/     Face recognition notebook
  LLM/                  Regulation extraction notebook
```

## Project Status

Falcon Vision currently includes the main implementation of the web dashboard, backend API, AI detection modules, regulation extraction workflow, employee management, face upload workflow, live monitoring, alert history, and monitoring reports.

The project was developed as a senior project to demonstrate how artificial intelligence can be used to improve industrial safety monitoring and make safety systems more adaptable to organization-specific regulations.
