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
