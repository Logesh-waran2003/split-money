import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getSession } from '../lib/auth'

export const Route = createFileRoute('/profile')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
  },
  component: ProfilePage,
})

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]
function avatarColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('')
}

function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2 transition shrink-0"
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}

function SavedBadge({ show }: { show: boolean }) {
  return show ? <span className="text-xs font-medium text-emerald-600">Saved!</span> : null
}

function ProfilePage() {
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState<string | null>(null)
  const [isEmailProvider, setIsEmailProvider] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [upiId, setUpiId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [savingName, setSavingName] = useState(false)
  const [savingPhone, setSavingPhone] = useState(false)
  const [savingUpi, setSavingUpi] = useState(false)
  const [savingPw, setSavingPw] = useState(false)
  const [savedName, setSavedName] = useState(false)
  const [savedPhone, setSavedPhone] = useState(false)
  const [savedUpi, setSavedUpi] = useState(false)
  const [savedPw, setSavedPw] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  useEffect(() => { loadProfile() }, [])

  async function loadProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const avatarUrl = user.user_metadata?.avatar_url as string | undefined
    if (avatarUrl) setGoogleAvatarUrl(avatarUrl)

    const provider = user.app_metadata?.provider as string | undefined
    setIsEmailProvider(!provider || provider === 'email')

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profile) {
      setDisplayName(profile.display_name ?? '')
      setPhone(profile.phone ?? '')
      setUpiId(profile.upi_id ?? '')
    }
  }

  function flash(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  async function saveName() {
    if (!userId) return
    setSavingName(true)
    await supabase.from('profiles').upsert({ id: userId, display_name: displayName })
    setSavingName(false)
    flash(setSavedName)
  }

  async function savePhone() {
    if (!userId) return
    setSavingPhone(true)
    await supabase.from('profiles').upsert({ id: userId, phone })
    setSavingPhone(false)
    flash(setSavedPhone)
  }

  async function saveUpi() {
    if (!userId) return
    setSavingUpi(true)
    await supabase.from('profiles').upsert({ id: userId, upi_id: upiId })
    setSavingUpi(false)
    flash(setSavedUpi)
  }

  async function savePassword() {
    setPwError(null)
    if (!newPassword) return
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match.'); return }
    if (newPassword.length < 6) { setPwError('Password must be at least 6 characters.'); return }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPw(false)
    if (error) {
      setPwError(error.message)
    } else {
      setNewPassword('')
      setConfirmPassword('')
      flash(setSavedPw)
    }
  }

  const nameForAvatar = displayName || 'You'
  const inputCls = 'flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-4">
        <Link to="/dashboard" className="text-gray-400 hover:text-gray-700 transition flex items-center gap-1 text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <h1 className="font-bold text-gray-900 text-lg">Profile</h1>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-4">
        {/* Avatar */}
        <div className="flex justify-center py-4">
          {googleAvatarUrl ? (
            <img src={googleAvatarUrl} alt={nameForAvatar} className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold"
              style={{ backgroundColor: avatarColor(nameForAvatar) }}
            >
              {initials(nameForAvatar) || '?'}
            </div>
          )}
        </div>

        {/* Display name */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Display name</h2>
          <div className="flex gap-2 items-center">
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()} placeholder="Your name" className={inputCls} />
            <SaveButton saving={savingName} onClick={saveName} />
          </div>
          <div className="mt-2 h-4"><SavedBadge show={savedName} /></div>
        </div>

        {/* Phone */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Phone number</h2>
          <p className="text-xs text-gray-400 mb-3">Used so friends can invite you by phone</p>
          <div className="flex gap-2 items-center">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && savePhone()} placeholder="+91 98765 43210" className={inputCls} />
            <SaveButton saving={savingPhone} onClick={savePhone} />
          </div>
          <div className="mt-2 h-4"><SavedBadge show={savedPhone} /></div>
        </div>

        {/* UPI ID */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">UPI ID</h2>
          <p className="text-xs text-gray-400 mb-3">Friends can pay you directly via GPay, PhonePe, Paytm when settling up</p>
          <div className="flex gap-2 items-center">
            <input type="text" value={upiId} onChange={(e) => setUpiId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveUpi()} placeholder="yourname@okaxis" className={inputCls} />
            <SaveButton saving={savingUpi} onClick={saveUpi} />
          </div>
          <div className="mt-2 h-4"><SavedBadge show={savedUpi} /></div>
        </div>

        {/* Change password — email provider only */}
        {isEmailProvider && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Change password</h2>
            <div className="space-y-3">
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && savePassword()} placeholder="Confirm new password"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
              {pwError && <p className="text-xs text-red-600">{pwError}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={savePassword}
                  disabled={savingPw || !newPassword}
                  className="text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2 transition"
                >
                  {savingPw ? 'Saving…' : 'Update password'}
                </button>
                <SavedBadge show={savedPw} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
