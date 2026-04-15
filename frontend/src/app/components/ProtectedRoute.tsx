import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getMe } from '../lib/api';
import {
  clearAuthSession,
  getAccessToken,
  getAuthUser,
  getHomePathForRole,
  saveAuthSession,
  type AuthUser,
  type UserRole,
} from '../lib/auth';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
}

interface SessionState {
  status: 'loading' | 'ready' | 'unauthenticated';
  user: AuthUser | null;
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const location = useLocation();
  const [sessionState, setSessionState] = useState<SessionState>({
    status: 'loading',
    user: getAuthUser(),
  });

  useEffect(() => {
    let ignore = false;
    const token = getAccessToken();

    if (!token) {
      setSessionState({ status: 'unauthenticated', user: null });
      return;
    }

    getMe(token)
      .then((user) => {
        if (ignore) {
          return;
        }

        saveAuthSession(token, user);
        setSessionState({ status: 'ready', user });
      })
      .catch(() => {
        if (ignore) {
          return;
        }

        clearAuthSession();
        setSessionState({ status: 'unauthenticated', user: null });
      });

    return () => {
      ignore = true;
    };
  }, [location.pathname]);

  if (sessionState.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fde8d8]">
        <div className="flex items-center gap-3 rounded-full border border-[#e0d5c7] bg-white px-5 py-3 text-[#8b7355] shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[#d87545]" />
          <span className="text-sm">Checking your session...</span>
        </div>
      </div>
    );
  }

  if (sessionState.status === 'unauthenticated' || !sessionState.user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowedRoles && !allowedRoles.includes(sessionState.user.role)) {
    return <Navigate to={getHomePathForRole(sessionState.user.role)} replace />;
  }

  return <Outlet />;
}
