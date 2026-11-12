import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { RequireAdmin } from '@/components/AdminShell';
import { RequireAuth } from '@/components/AppShell';
import { adminBase, adminRoutes } from '@/lib/admin';
import { PREVIEW } from '@/lib/preview';
import { toRoute } from '@/lib/routes';
import { useUser } from '@/lib/session';

// Every page is its own chunk, loaded when it is first visited: a person who only reads the landing page does not
// download the Builder and its editor.
const Landing = lazy(() => import('@/pages/Landing'));
const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const PreviewHub = lazy(() => import('@/pages/PreviewHub'));
const Jobs = lazy(() => import('@/pages/Jobs'));
const Saved = lazy(() => import('@/pages/Saved'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const Watchlist = lazy(() => import('@/pages/Watchlist'));
const Settings = lazy(() => import('@/pages/Settings'));
const Community = lazy(() => import('@/pages/Community'));
const MyActivity = lazy(() => import('@/pages/MyActivity'));
const AdminBugs = lazy(() => import('@/pages/AdminBugs'));
const Upload = lazy(() => import('@/pages/Upload'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Applications = lazy(() => import('@/pages/Applications'));
const Letters = lazy(() => import('@/pages/Letters'));
const Builder = lazy(() => import('@/pages/Builder'));
const TeamInsights = lazy(() => import('@/pages/TeamInsights'));
const SignupPreview = lazy(() => import('@/pages/SignupPreview'));

/** An address from the older multi-page app (`/dashboard.html`) goes to the page's route. */
function LegacyAddress() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={toRoute(`${pathname.slice(1)}${search}${hash}`)} replace />;
}

export function App() {
  // Null unless an administrator is signed in; then the secret path the backend gave them.
  const admin = adminBase(useUser());
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {PREVIEW ? <Route path="/preview" element={<PreviewHub />} /> : null}
        {PREVIEW ? <Route path="/signup-preview" element={<SignupPreview />} /> : null}
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/letters" element={<Letters />} />
          <Route path="/builder" element={<Builder />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/community" element={<Community />} />
          <Route path="/activity" element={<MyActivity />} />
        </Route>
        {/* The admin console is its own window with its own shell: none of it is part of the signed-in user app.
            It has no fixed address: its routes exist only while an administrator is signed in, under the secret
            path the backend told them. For everyone else /admin (or any guess) is just an unknown address. */}
        {admin ? (
          <Route path={admin} element={<RequireAdmin />}>
            <Route index element={PREVIEW ? <TeamInsights /> : <Navigate to={adminRoutes(admin).bugs} replace />} />
            <Route path="bugs" element={<AdminBugs />} />
          </Route>
        ) : null}
        <Route path="/*.html" element={<LegacyAddress />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
