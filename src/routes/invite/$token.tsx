import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'

export const Route = createFileRoute('/invite/$token')({
  component: InvitePage,
})

function InvitePage() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'already' | 'error'>('loading')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    handleJoin()
  }, [])

  async function handleJoin() {
    const session = await getSession()
    if (!session) {
      window.location.href = `/login?redirect=/invite/${token}`
      return
    }

    const { data, error } = await supabase.rpc('join_group_via_invite', { p_token: token })

    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
      return
    }

    if (data.error) {
      setErrorMsg(data.error)
      setStatus('error')
      return
    }

    setGroupId(data.group_id)

    // Fetch group name
    const { data: group } = await supabase
      .from('groups')
      .select('name')
      .eq('id', data.group_id)
      .single()
    setGroupName(group?.name ?? '')

    setStatus(data.already_member ? 'already' : 'success')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-500">Joining group…</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">You joined {groupName || 'the group'}!</h1>
              <p className="text-sm text-gray-500 mb-6">You can now view and add expenses.</p>
              <button
                onClick={() => navigate({ to: '/groups/$groupId', params: { groupId: groupId! } })}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                Go to group
              </button>
            </>
          )}

          {status === 'already' && (
            <>
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">You're already in this group</h1>
              <p className="text-sm text-gray-500 mb-6">{groupName}</p>
              <button
                onClick={() => navigate({ to: '/groups/$groupId', params: { groupId: groupId! } })}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                Go to group
              </button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-1">Can't join group</h1>
              <p className="text-sm text-gray-500 mb-6">{errorMsg}</p>
              <button
                onClick={() => navigate({ to: '/dashboard' })}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                Go home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
