import type { AuthUser, UserRole } from './auth';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  token?: string;
  body?: BodyInit | unknown;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface RegisterOrganizationRequest {
  organization_name: string;
  industry?: string;
  country?: string;
  city?: string;
  address?: string;
  admin_full_name: string;
  admin_email: string;
  admin_password: string;
  admin_phone?: string;
}

export interface RegisterOrganizationResponse {
  organization: {
    id: string;
    name: string;
    status: string;
  };
  user: AuthUser;
}

export interface CreateUserRequest {
  full_name: string;
  email: string;
  password: string;
  role: UserRole;
  phone?: string;
  job_title?: string;
}

export interface UserResponse {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: string;
  phone?: string | null;
  job_title?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeResponse {
  id: string;
  organization_id: string;
  employee_number: string;
  full_name: string;
  department?: string | null;
  job_title?: string | null;
  employment_type: string;
  status: string;
  phone?: string | null;
  email?: string | null;
  requires_ppe: boolean;
  ppe_requirements: string[];
  training_certifications: string[];
  created_at: string;
  updated_at: string;
}

export interface EmployeeListResponse {
  items: EmployeeResponse[];
  total: number;
}

export interface EmployeeFaceUploadFailure {
  filename: string;
  detail: string;
}

export interface EmployeeFaceUploadItem {
  id: string;
  employee_id: string;
  organization_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  image: {
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    public_url?: string | null;
  };
  quality: {
    score?: number | null;
    frontal?: boolean | null;
    has_mask?: boolean | null;
    lighting?: string | null;
  };
  embedding?: {
    model_name: string;
    dimension: number;
    created_at: string;
  } | null;
}

export interface EmployeeFaceUploadResponse {
  uploaded_count: number;
  failed_count: number;
  items: EmployeeFaceUploadItem[];
  failures: EmployeeFaceUploadFailure[];
}

export interface FaceRecognitionResponse {
  status: string;
  authorized: boolean;
  threshold: number;
  score?: number | null;
  matched_face_id?: string | null;
  matched_employee_id?: string | null;
  matched_employee_name?: string | null;
  face_box?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    image_width: number;
    image_height: number;
  } | null;
}

export interface FaceRecognitionStatusResponse {
  enabled: boolean;
}

export interface PPEDetectionItem {
  class_name: string;
  confidence: number;
  bbox: number[];
}

export interface PPEDetectionResponse {
  status: string;
  detected_items: PPEDetectionItem[];
  image_width: number;
  image_height: number;
}

export interface LivePPEResult {
  status: string;
  violations: string[];
  detected_items: PPEDetectionItem[];
  image_width: number;
  image_height: number;
}

export interface PPEComplianceResponse {
  status: string;
  employee_id?: string | null;
  employee_name?: string | null;
  required_ppe: string[];
  detected_ppe: string[];
  missing_ppe: string[];
  confidence: number;
  image_width: number;
  image_height: number;
}

export interface FallDetectionResponse {
  status: string;
  people_count: number;
  falls_detected: number;
  detections: Array<{
    person_id: number;
    is_fallen: boolean;
    confidence: number;
    bbox: number[];
  }>;
  fall_detection_active: boolean;
  zone_type?: string | null;
}

export interface FireDetectionResponse {
  alert_level: string;
  sensor_prediction: string;
  image_decision: string;
  image_confidence: number;
  reason: string;
  detections: Array<{
    class: string;
    confidence: number;
    bbox: number[];
  }>;
  fire_detection_active: boolean;
  zone_type?: string | null;
  sensor_data_used: boolean;
}

export interface AlertResponse {
  id: string;
  title: string;
  message: string;
  category: string;
  severity: string;
  status: string;
  detected_at: string;
  camera_name?: string | null;
  zone_name?: string | null;
  employee_name?: string | null;
  evidence_image_path?: string | null;
}

export interface AlertListResponse {
  items: AlertResponse[];
  total: number;
}

export interface SafetyMonitoringResponse {
  status: string;
  ppe: LivePPEResult;
  fall: FallDetectionResponse;
  fire: FireDetectionResponse;
  alerts: AlertResponse[];
}

export interface WebRtcSessionDescriptionPayload {
  sdp: string;
  type: string;
}

export interface RegulationFileResponse {
  original_filename: string;
  storage_provider: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

export interface RegulationResponse {
  id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  document_type: string;
  status: string;
  version: number;
  uploaded_by: string;
  file: RegulationFileResponse;
  created_at: string;
  updated_at: string;
}

export interface ExtractedRuleResponse {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  required_classes: string[];
  violation_when: string;
  confidence_threshold: number;
  zone_types: string[];
  source_excerpt?: string | null;
}

export interface RegulationExtractionSummary {
  total_rules: number;
  ppe_items: string[];
  fall_detection_active: boolean;
  fire_smoke_detection_active: boolean;
}

export interface RegulationUploadResponse {
  regulation: RegulationResponse;
  extracted_rules: ExtractedRuleResponse[];
  summary: RegulationExtractionSummary;
}

export interface FaceRecognitionSettingResponse {
  enabled: boolean;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    },
    body:
      options.body == null
        ? undefined
        : isFormData
          ? options.body
          : JSON.stringify(options.body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof payload?.detail === 'string'
        ? payload.detail
        : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export function registerOrganization(body: RegisterOrganizationRequest) {
  return apiRequest<RegisterOrganizationResponse>('/api/auth/register-organization', {
    method: 'POST',
    body,
  });
}

export function login(body: LoginRequest) {
  return apiRequest<TokenResponse>('/api/auth/login', {
    method: 'POST',
    body,
  });
}

export function getMe(token: string) {
  return apiRequest<AuthUser>('/api/auth/me', {
    token,
  });
}

export function createUser(body: CreateUserRequest, token: string) {
  return apiRequest<UserResponse>('/api/users', {
    method: 'POST',
    token,
    body,
  });
}

export function listEmployees(token: string) {
  return apiRequest<EmployeeListResponse>('/api/employees', {
    token,
  });
}

export function uploadEmployeeFaces(employeeId: string, files: File[], token: string) {
  const formData = new FormData();
  formData.append('employee_id', employeeId);

  files.forEach((file) => {
    formData.append('files', file, file.name);
  });

  return apiRequest<EmployeeFaceUploadResponse>('/api/employee-faces/upload', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function uploadRegulation(file: File, token: string, title?: string, description?: string) {
  const formData = new FormData();
  formData.append('file', file, file.name);

  if (title?.trim()) {
    formData.append('title', title.trim());
  }

  if (description?.trim()) {
    formData.append('description', description.trim());
  }

  return apiRequest<RegulationUploadResponse>('/api/regulations/upload', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function setRegulationFaceRecognition(regulationId: string, enabled: boolean, token: string) {
  return apiRequest<FaceRecognitionSettingResponse>(`/api/regulations/${regulationId}/face-recognition`, {
    method: 'POST',
    token,
    body: { enabled },
  });
}

export function recognizeEmployeeFace(file: Blob, token: string) {
  const formData = new FormData();
  const uploadFile =
    file instanceof File ? file : new File([file], 'camera-frame.jpg', { type: file.type || 'image/jpeg' });

  formData.append('file', uploadFile, uploadFile.name);

  return apiRequest<FaceRecognitionResponse>('/api/employee-faces/recognize', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function detectPPE(file: File, token: string) {
  const formData = new FormData();
  formData.append('file', file, file.name);

  return apiRequest<PPEDetectionResponse>('/api/ppe/detect', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function detectSafety(file: Blob, zoneType?: string, token?: string) {
  const formData = new FormData();
  const uploadFile =
    file instanceof File ? file : new File([file], 'camera-frame.jpg', { type: file.type || 'image/jpeg' });

  formData.append('file', uploadFile, uploadFile.name);

  if (zoneType) {
    formData.append('zone_type', zoneType);
  }

  return apiRequest<SafetyMonitoringResponse>('/api/monitoring/detect', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function getFaceRecognitionStatus(token: string) {
  return apiRequest<FaceRecognitionStatusResponse>('/api/employee-faces/status', {
    token,
  });
}

export function listAlerts(token: string, limit = 100) {
  return apiRequest<AlertListResponse>(`/api/alerts?limit=${limit}`, {
    token,
  });
}

export function resolveStorageUrl(storagePath?: string | null) {
  if (!storagePath) {
    return null;
  }

  return new URL(storagePath.replace(/^\//, ''), `${API_BASE_URL}/`).toString();
}

export function getMonitoringSafetyWebSocketUrl(token: string) {
  const wsBaseUrl = API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const encodedToken = encodeURIComponent(token);
  return `${wsBaseUrl}/api/monitoring/ws/safety?token=${encodedToken}`;
}

export function createMonitoringSafetyWebRtcOffer(
  body: WebRtcSessionDescriptionPayload & { zone_type?: string },
  token: string,
) {
  return apiRequest<WebRtcSessionDescriptionPayload>('/api/monitoring/webrtc/offer', {
    method: 'POST',
    token,
    body,
  });
}

export function checkPPECompliance(
  file: File,
  employeeId?: string,
  requiredPPE?: string[],
  zoneType?: string,
  token?: string
) {
  const formData = new FormData();
  formData.append('file', file, file.name);

  if (employeeId) {
    formData.append('employee_id', employeeId);
  }

  if (requiredPPE && requiredPPE.length > 0) {
    requiredPPE.forEach(ppe => formData.append('required_ppe', ppe));
  }

  if (zoneType) {
    formData.append('zone_type', zoneType);
  }

  return apiRequest<PPEComplianceResponse>('/api/ppe/check-compliance', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function detectFalls(file: Blob, zoneType?: string, token?: string) {
  const formData = new FormData();
  const uploadFile =
    file instanceof File ? file : new File([file], 'camera-frame.jpg', { type: file.type || 'image/jpeg' });

  formData.append('file', uploadFile, uploadFile.name);

  if (zoneType) {
    formData.append('zone_type', zoneType);
  }

  return apiRequest<FallDetectionResponse>('/api/fall/detect', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function detectFire(file: Blob, zoneType?: string, token?: string) {
  const formData = new FormData();
  const uploadFile =
    file instanceof File ? file : new File([file], 'camera-frame.jpg', { type: file.type || 'image/jpeg' });

  formData.append('file', uploadFile, uploadFile.name);

  if (zoneType) {
    formData.append('zone_type', zoneType);
  }

  return apiRequest<FireDetectionResponse>('/api/fire/detect-image-only', {
    method: 'POST',
    token,
    body: formData,
  });
}

export function detectFireMultimodal(
  file: Blob,
  sensorData?: number[],
  zoneType?: string,
  token?: string
) {
  const formData = new FormData();
  const uploadFile =
    file instanceof File ? file : new File([file], 'camera-frame.jpg', { type: file.type || 'image/jpeg' });

  formData.append('file', uploadFile, uploadFile.name);

  if (sensorData && sensorData.length > 0) {
    formData.append('sensor_data', JSON.stringify(sensorData));
  }

  if (zoneType) {
    formData.append('zone_type', zoneType);
  }

  return apiRequest<FireDetectionResponse>('/api/fire/detect-multimodal', {
    method: 'POST',
    token,
    body: formData,
  });
}
