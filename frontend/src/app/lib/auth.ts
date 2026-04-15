export type UserRole =
  | 'admin'
  | 'supervisor';

export interface AuthUser {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  status: string;
}

const ACCESS_TOKEN_KEY = 'falcon_vision_access_token';
const AUTH_USER_KEY = 'falcon_vision_user';

export function saveAuthSession(accessToken: string, user: AuthUser) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getAuthUser(): AuthUser | null {
  const rawUser = localStorage.getItem(AUTH_USER_KEY);

  if (!rawUser) {
    return null;
  }

  try {
    return JSON.parse(rawUser) as AuthUser;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function clearAuthSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

export function getHomePathForRole(role: UserRole) {
  if (role === 'admin') {
    return '/admin';
  }

  if (role === 'supervisor') {
    return '/supervisor';
  }

  return '/login';
}

export function formatRoleLabel(role: UserRole) {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'supervisor':
      return 'Supervisor';
    default:
      return role;
  }
}
