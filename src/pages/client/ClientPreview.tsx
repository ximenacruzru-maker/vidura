import { useNavigate, useParams } from 'react-router-dom'
import ClientPortal from './ClientPortal'

/** Staff preview of one account's client portal: exactly what the client sees, live. */
export default function ClientPreview() {
  const { account = '' } = useParams()
  const nav = useNavigate()
  return (
    <>
      <div className="cp-preview-bar"><button className="btn-ghost" onClick={() => nav(-1)}>← Back</button></div>
      <ClientPortal previewAccount={account} />
    </>
  )
}
