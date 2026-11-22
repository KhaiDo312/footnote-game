/**
 * /join/:code, e.g. /join/KQXTR: joins the game, then goes to its room page.
 * Sign-in is required (the (protected) folder), so a signed-out player signs
 * in first and lands back here.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { callAction } from '@/lib/call-action'

export default function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    // React may run this effect twice in development. That's fine: joinRoom
    // is safe to call twice (the second call finds the player already in).
    let stale = false
    callAction<{ roomId: string }>('joinRoom', { joinCode: code }).then((result) => {
      if (stale) return
      if (result.success) navigate(`/room/${result.data.roomId}`, { replace: true })
      else setError(result.error)
    })
    return () => {
      stale = true
    }
  }, [code, navigate])

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-foreground">
      {error ? (
        <>
          <p role="alert" className="text-lg">
            {error}
          </p>
          <Link to="/home" className="mt-6 inline-block text-sm underline">
            Back to home
          </Link>
        </>
      ) : (
        <p className="text-lg">Joining {code.toUpperCase()}…</p>
      )}
    </div>
  )
}
