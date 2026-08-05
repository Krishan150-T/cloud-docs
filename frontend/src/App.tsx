import { Navigate, Route, Routes } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import type { AuthResponse, User } from './types';

const TOKEN_KEY = 'clouddocs_token';
const USER_KEY = 'clouddocs_user';

function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

function PrivateRoute({
  isAuthenticated,
  children,
}: {
  isAuthenticated: boolean;
  children: ReactNode;
}) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) ?? '');
  const [user, setUser] = useState<User | null>(() => getStoredUser());

  const isAuthenticated = useMemo(() => Boolean(token && user), [token, user]);

  function handleAuthSuccess(payload: AuthResponse) {
    setToken(payload.accessToken);
    setUser(payload.user);
    localStorage.setItem(TOKEN_KEY, payload.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  }

  function handleLogout() {
    setToken('');
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <AuthPage mode="login" onAuthSuccess={handleAuthSuccess} />
          )
        }
      />
      <Route
        path="/signup"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <AuthPage mode="signup" onAuthSuccess={handleAuthSuccess} />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute isAuthenticated={isAuthenticated}>
            <DashboardPage token={token} user={user as User} onLogout={handleLogout} />
          </PrivateRoute>
        }
      />
      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
}

export default App;
