import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, LoginScreen, useAuth } from './auth'
import { FolioProvider } from './components/FolioPicker'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import ChangePassword from './pages/ChangePassword'
import { can, commissionsOnly } from './lib/access'
import { lazy, Suspense, useEffect, useState } from 'react'
import { getClientFile } from './lib/client'

// Each page is its own file, downloaded the first time it's opened, so the first load stays small.
const Settings = lazy(() => import('./pages/Settings'))
const Books = lazy(() => import('./pages/Books'))
const Resources = lazy(() => import('./pages/Resources'))
const SalesFlow = lazy(() => import('./pages/SalesFlow'))
const WorkQueue = lazy(() => import('./pages/WorkQueue'))
const MySpace = lazy(() => import('./pages/MySpace'))
const Chat = lazy(() => import('./pages/Chat'))
const Proteges = lazy(() => import('./pages/Proteges'))
const Licensing = lazy(() => import('./pages/Licensing'))
const Payroll = lazy(() => import('./pages/Payroll'))
const CommissionSheet = lazy(() => import('./pages/CommissionSheet'))
const Payments = lazy(() => import('./pages/Payments'))
const Training = lazy(() => import('./pages/Training'))
const MyPay = lazy(() => import('./pages/MyPay'))
const Retention = lazy(() => import('./pages/Retention'))
const MyCommissions = lazy(() => import('./pages/MyCommissions'))
const ExecutiveDashboard = lazy(() => import('./pages/executive/ExecutiveDashboard'))
const Foresight = lazy(() => import('./pages/foresight/Foresight'))
const Agencies = lazy(() => import('./pages/Agencies'))
const SalesKPIs = lazy(() => import('./pages/sales/SalesKPIs'))
const DailyHuddle = lazy(() => import('./pages/huddle/DailyHuddle'))
const Reports = lazy(() => import('./pages/reports/Reports'))
const ClientPortal = lazy(() => import('./pages/client/ClientPortal'))
const ClientPreview = lazy(() => import('./pages/client/ClientPreview'))

function Gate() {
  const { session, me, loading, signOut } = useAuth()
  const [pwDone, setPwDone] = useState(false)
  if (!session) return <LoginScreen />
  if (loading) return <div className="center"><Loading what="Signing in" /></div>
  // not on staff: a client portal login sees only their own file (ClientGate shows the old message for anyone else)
  if (!me) return <ClientGate onSignOut={signOut} />
  if ((me.must_change_password || sessionStorage.getItem('vx_recovery')) && !pwDone) return <ChangePassword forced onDone={() => { sessionStorage.removeItem('vx_recovery'); setPwDone(true) }} />
  // a new hire has only the training (and settings): it is their home and the rest isn't routed
  const trainee = me.role === 'new_hire'
  const home = trainee ? '/training' : can(me, 'performance') ? '/' : '/today'
  // "My Commissions only": that page, Farmers University, their settings and changing their password are all that is routed
  if (commissionsOnly(me)) {
    return (
      <FolioProvider key={me.user_id}>
        <Layout>
          <Suspense fallback={<div className="center"><Loading what="Loading" /></div>}>
          <Routes>
            <Route path="/my-commissions" element={<MyCommissions />} />
            <Route path="/training" element={<Training />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/password" element={<ChangePassword />} />
            <Route path="*" element={<Navigate to="/my-commissions" replace />} />
          </Routes>
          </Suspense>
        </Layout>
      </FolioProvider>
    )
  }
  return (
    <FolioProvider key={me.user_id}>
      <Layout>
        <Suspense fallback={<div className="center"><Loading what="Loading" /></div>}>
        <Routes>
          <Route path="/" element={can(me, 'performance') ? <ExecutiveDashboard /> : <Navigate to={home} replace />} />
          {/* Performance screens not yet rebuilt: the original screens, shown by the layout's LegacyHost */}
          {['/legacy-dashboard', '/legacy-sales', '/huddle', '/legacy-reports', '/year-end', '/legacy-commissions', '/commission-setup', '/legacy-sdr'].map((p) =>
            <Route key={p} path={p} element={can(me, 'performance') ? null : <Navigate to="/today" replace />} />)}
          {can(me, 'performance') && <Route path="/sales" element={<DailyHuddle />} />}
          {can(me, 'performance') && <Route path="/sales-kpis" element={<SalesKPIs />} />}
          {can(me, 'performance') && <Route path="/reports" element={<Reports />} />}
          {can(me, 'performance') && <Route path="/commissions" element={<Reports open="commissions" />} />}
          {can(me, 'performance') && <Route path="/sdr" element={<Reports open="sdr" />} />}
          {can(me, 'performance') && <Route path="/foresight" element={<Foresight />} />}
          <Route path="/settings" element={<Settings />} />
          {me.platform_admin && <Route path="/agencies" element={<Agencies />} />}
          <Route path="/team" element={<Navigate to="/settings" replace />} />
          <Route path="/password" element={<ChangePassword />} />
          {can(me, 'retention') && <Route path="/retention" element={<Retention />} />}
          {!trainee && <Route path="/pay" element={<MyPay />} />}
          {!trainee && <Route path="/my-commissions" element={<MyCommissions />} />}
          {!trainee && <Route path="/today" element={<MySpace />} />}
          {can(me, 'books') && <Route path="/books/:book" element={<Books />} />}
          {can(me, 'books') && <Route path="/books" element={<Navigate to="/books/farmers" replace />} />}
          {/* Renewals now live on Books of Business as an alert; old links open it expanded. */}
          {can(me, 'books') && <Route path="/renewals" element={<Navigate to="/books/farmers?renewals=1" replace />} />}
          {(can(me, 'resources') || can(me, 'passwords')) && <Route path="/resources" element={<Resources />} />}
          {can(me, 'resources') && <Route path="/sales-flow" element={<SalesFlow />} />}
          {can(me, 'work') && <Route path="/work" element={<WorkQueue />} />}
          {can(me, 'chat') && <Route path="/chat" element={<Chat />} />}
          {can(me, 'proteges') && <Route path="/proteges" element={<Proteges />} />}
          {!trainee && <Route path="/hr" element={<Licensing />} />}
          {can(me, 'payroll') && <Route path="/payroll" element={<Payroll />} />}
          {can(me, 'commission_sheet') && <Route path="/commission-sheet" element={<CommissionSheet />} />}
          {can(me, 'books') && !trainee && <Route path="/payments" element={<Payments />} />}
          {can(me, 'passwords') && <Route path="/passwords" element={<Navigate to="/resources?tab=passwords" replace />} />}
          {can(me, 'training') && <Route path="/training" element={<Training />} />}
          {can(me, 'books') && <Route path="/client-view/:account" element={<ClientPreview />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
        </Suspense>
      </Layout>
    </FolioProvider>
  )
}

/** A login that isn't on staff: if it's a client portal login, their own file (after choosing a password); otherwise
 *  the "not set up yet" message. The database decides: client_portal() returns nothing for anyone but a client. */
function ClientGate({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [state, setState] = useState<'loading' | 'client' | 'none'>('loading')
  const [mustChange, setMustChange] = useState(false)
  const [pw, setPw] = useState(false)
  useEffect(() => {
    let alive = true
    getClientFile().then((f) => { if (!alive) return; setMustChange(!!f?.viewer.must_change_password); setState(f ? 'client' : 'none') }).catch(() => alive && setState('none'))
    return () => { alive = false }
  }, [])
  if (state === 'loading') return <div className="center"><Loading what="Signing in" /></div>
  if (state === 'none') {
    return (
      <div className="center">
        <div className="panel narrow">
          <div className="panel-b">
            <p>You’re signed in, but this login isn’t set up yet. Please contact the agency.</p>
            <button className="btn-ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }
  if (mustChange || pw) return <ChangePassword forced onDone={() => { setMustChange(false); setPw(false) }} />
  return <Suspense fallback={<div className="center"><Loading what="Opening your file" /></div>}><ClientPortal onSignOut={onSignOut} onChangePassword={() => setPw(true)} /></Suspense>
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
