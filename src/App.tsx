import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, LoginScreen, useAuth } from './auth'
import { FolioProvider } from './components/FolioPicker'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import ChangePassword from './pages/ChangePassword'
import { can } from './lib/access'
import { lazy, Suspense, useState } from 'react'

// Each page is its own file, downloaded the first time it's opened, so the first load stays small.
const Settings = lazy(() => import('./pages/Settings'))
const Books = lazy(() => import('./pages/Books'))
const Resources = lazy(() => import('./pages/Resources'))
const WorkQueue = lazy(() => import('./pages/WorkQueue'))
const MySpace = lazy(() => import('./pages/MySpace'))
const Chat = lazy(() => import('./pages/Chat'))
const Proteges = lazy(() => import('./pages/Proteges'))
const Licensing = lazy(() => import('./pages/Licensing'))
const Training = lazy(() => import('./pages/Training'))
const MyPay = lazy(() => import('./pages/MyPay'))
const ExecutiveDashboard = lazy(() => import('./pages/executive/ExecutiveDashboard'))
const Foresight = lazy(() => import('./pages/foresight/Foresight'))
const Agencies = lazy(() => import('./pages/Agencies'))
const SalesKPIs = lazy(() => import('./pages/sales/SalesKPIs'))

function Gate() {
  const { session, me, loading, signOut } = useAuth()
  const [pwDone, setPwDone] = useState(false)
  if (!session) return <LoginScreen />
  if (loading) return <div className="center"><Loading what="Signing in" /></div>
  if (!me) {
    return (
      <div className="center">
        <div className="panel narrow">
          <div className="panel-b">
            <p>You’re signed in, but this login isn’t set up as a staff account yet. Ask an admin to add you.</p>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }
  if ((me.must_change_password || sessionStorage.getItem('vx_recovery')) && !pwDone) return <ChangePassword forced onDone={() => { sessionStorage.removeItem('vx_recovery'); setPwDone(true) }} />
  const home = can(me, 'performance') ? '/' : '/today'
  return (
    <FolioProvider>
      <Layout>
        <Suspense fallback={<div className="center"><Loading what="Loading" /></div>}>
        <Routes>
          <Route path="/" element={can(me, 'performance') ? <ExecutiveDashboard /> : <Navigate to="/today" replace />} />
          {/* Performance screens not yet rebuilt: the original screens, shown by the layout's LegacyHost */}
          {['/legacy-dashboard', '/legacy-sales', '/huddle', '/reports', '/commissions', '/sdr'].map((p) =>
            <Route key={p} path={p} element={can(me, 'performance') ? null : <Navigate to="/today" replace />} />)}
          {can(me, 'performance') && <Route path="/sales" element={<SalesKPIs />} />}
          {can(me, 'performance') && <Route path="/foresight" element={<Foresight />} />}
          <Route path="/settings" element={<Settings />} />
          {me.platform_admin && <Route path="/agencies" element={<Agencies />} />}
          <Route path="/team" element={<Navigate to="/settings" replace />} />
          <Route path="/password" element={<ChangePassword />} />
          <Route path="/pay" element={<MyPay />} />
          <Route path="/today" element={<MySpace />} />
          {can(me, 'books') && <Route path="/books/:book" element={<Books />} />}
          {can(me, 'books') && <Route path="/books" element={<Navigate to="/books/farmers" replace />} />}
          {/* Renewals now live on Books of Business as an alert; old links open it expanded. */}
          {can(me, 'books') && <Route path="/renewals" element={<Navigate to="/books/farmers?renewals=1" replace />} />}
          {(can(me, 'resources') || can(me, 'passwords')) && <Route path="/resources" element={<Resources />} />}
          {can(me, 'work') && <Route path="/work" element={<WorkQueue />} />}
          {can(me, 'chat') && <Route path="/chat" element={<Chat />} />}
          {can(me, 'proteges') && <Route path="/proteges" element={<Proteges />} />}
          <Route path="/hr" element={<Licensing />} />
          {can(me, 'passwords') && <Route path="/passwords" element={<Navigate to="/resources?tab=passwords" replace />} />}
          {can(me, 'training') && <Route path="/training" element={<Training />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
        </Suspense>
      </Layout>
    </FolioProvider>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
