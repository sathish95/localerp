import { useParams } from 'react-router-dom'
import SigningView from '../components/esign/SigningView'

// Public signing page /sign/:token — no login. Everything goes through the
// esign_public_* RPCs (STEP273), keyed by the signer's personal token.
export default function PublicSignPage() {
  const { token } = useParams()
  return (
    <div className="esg-public">
      <div className="esg-public-inner"><SigningView token={token} /></div>
      <div className="esg-public-foot">Electronic signing by ThingsAlive NeoX</div>
    </div>
  )
}
