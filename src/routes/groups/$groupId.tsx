import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'
import { computeBalances } from '../../lib/balance'
import type { Expense, Split } from '../../lib/balance'

export const Route = createFileRoute('/groups/$groupId')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
  },
  component: GroupPage,
})

interface Member {
  user_id: string
}

interface Profile {
  id: string
  display_name: string
}

interface ExpenseRow {
  id: string
  description: string
  amount: number
  paid_by: string
  created_at: string
}

interface SplitRow {
  id: string
  expense_id: string
  user_id: string
  amount: number
  settled: boolean
}

// Deterministic color + initials helpers
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

function Avatar({ name, size = 8 }: { name: string; size?: number }) {
  const sizeClass = `w-${size} h-${size}`
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ backgroundColor: avatarColor(name), fontSize: size * 1.75 }}
    >
      {initials(name) || '?'}
    </div>
  )
}

function GroupPage() {
  const { groupId } = Route.useParams()
  const navigate = useNavigate()

  const [groupName, setGroupName] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [splits, setSplits] = useState<SplitRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add expense modal
  const [showModal, setShowModal] = useState(false)
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [adding, setAdding] = useState(false)

  // Invite by email
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{
    type: 'success' | 'not_found' | 'already_member' | 'error'
    message: string
  } | null>(null)

  useEffect(() => {
    loadAll()
  }, [groupId])

  async function loadAll() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    setCurrentUserId(user?.id ?? null)

    const [groupRes, membersRes, expensesRes] = await Promise.all([
      supabase.from('groups').select('name').eq('id', groupId).single(),
      supabase.from('group_members').select('user_id').eq('group_id', groupId),
      supabase.from('expenses').select('*').eq('group_id', groupId).order('created_at', { ascending: false }),
    ])

    if (groupRes.error) { setError(groupRes.error.message); setLoading(false); return }
    setGroupName(groupRes.data.name)

    const memberList: Member[] = membersRes.data ?? []
    setMembers(memberList)

    // Load profiles for all members in one shot
    if (memberList.length > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', memberList.map((m) => m.user_id))
      const profileMap = (profileData ?? []).reduce<Record<string, Profile>>((acc, p) => {
        acc[p.id] = p
        return acc
      }, {})
      setProfiles(profileMap)
    }

    const expenseList: ExpenseRow[] = expensesRes.data ?? []
    setExpenses(expenseList)

    if (expenseList.length > 0) {
      const { data: splitData } = await supabase
        .from('expense_splits')
        .select('*')
        .in('expense_id', expenseList.map((e) => e.id))
      setSplits(splitData ?? [])
    } else {
      setSplits([])
    }

    setLoading(false)
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    if (!desc.trim() || !amount || !currentUserId) return
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0) return

    setAdding(true)
    setError(null)

    const { data: expense, error: expErr } = await supabase
      .from('expenses')
      .insert({ group_id: groupId, paid_by: currentUserId, amount: parsed, description: desc.trim() })
      .select()
      .single()

    if (expErr) { setError(expErr.message); setAdding(false); return }

    const share = Math.round((parsed / members.length) * 100) / 100
    const splitRows = members.map((m) => ({
      expense_id: expense.id,
      user_id: m.user_id,
      amount: share,
      settled: false,
    }))
    const { error: splitErr } = await supabase.from('expense_splits').insert(splitRows)
    if (splitErr) setError(splitErr.message)

    setDesc('')
    setAmount('')
    setAdding(false)
    setShowModal(false)
    loadAll()
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteResult(null)

    const { data: userId, error } = await supabase.rpc('find_user_by_email', {
      email_input: inviteEmail.trim(),
    })

    if (error) {
      setInviteResult({ type: 'error', message: error.message })
      setInviting(false)
      return
    }
    if (!userId) {
      setInviteResult({
        type: 'not_found',
        message: `No account found for ${inviteEmail}. Share this link so they can sign up: ${window.location.origin}`,
      })
      setInviting(false)
      return
    }

    const alreadyMember = members.some((m) => m.user_id === userId)
    if (alreadyMember) {
      setInviteResult({ type: 'already_member', message: 'Already in this group.' })
      setInviting(false)
      return
    }

    const { error: addErr } = await supabase
      .from('group_members')
      .insert({ group_id: groupId, user_id: userId })

    if (addErr) {
      setInviteResult({ type: 'error', message: addErr.message })
      setInviting(false)
      return
    }

    setInviteResult({ type: 'success', message: 'Added successfully!' })
    setInviteEmail('')
    setInviting(false)
    loadAll()
  }

  function whatsappReminderLink(debtorName: string, amount: number, groupName: string): string {
    const msg = `Hey ${debtorName}, just a reminder you owe me ₹${amount.toFixed(2)} for ${groupName} expenses on Split Money. Settle up when you can! 🙏`
    return `https://wa.me/?text=${encodeURIComponent(msg)}`
  }

  function displayName(userId: string): string {
    return profiles[userId]?.display_name || userId.slice(0, 8)
  }

  const balances = computeBalances(
    expenses.map((e): Expense => ({ id: e.id, paid_by: e.paid_by, amount: e.amount })),
    splits.map((s): Split => ({ expense_id: s.expense_id, user_id: s.user_id, amount: s.amount, settled: s.settled }))
  )

  // Net for current user: positive = owed, negative = owes
  const myNet = currentUserId
    ? balances.reduce((sum, b) => {
        if (b.to === currentUserId) return sum + b.amount
        if (b.from === currentUserId) return sum - b.amount
        return sum
      }, 0)
    : 0

  const memberAvatarPreview = members.slice(0, 3)
  const extraMembers = members.length > 3 ? members.length - 3 : 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate({ to: '/dashboard' })}
          className="text-gray-400 hover:text-gray-700 transition flex items-center gap-1 text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="font-bold text-gray-900 text-lg flex-1 truncate">{groupName || '…'}</h1>
        {/* Stacked member avatars */}
        <div className="flex items-center">
          <div className="flex -space-x-2">
            {memberAvatarPreview.map((m) => (
              <div
                key={m.user_id}
                title={displayName(m.user_id)}
                className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: avatarColor(displayName(m.user_id)) }}
              >
                {initials(displayName(m.user_id))}
              </div>
            ))}
            {extraMembers > 0 && (
              <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
                +{extraMembers}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="ml-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl px-4 py-2 transition shrink-0"
        >
          Add expense
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Balance summary card */}
        {!loading && (
          <div
            className={`rounded-2xl px-6 py-5 ${
              myNet > 0.005
                ? 'bg-emerald-50 border border-emerald-100'
                : myNet < -0.005
                ? 'bg-amber-50 border border-amber-100'
                : 'bg-gray-100 border border-gray-200'
            }`}
          >
            <p className={`text-lg font-bold mb-0.5 ${myNet > 0.005 ? 'text-emerald-700' : myNet < -0.005 ? 'text-amber-700' : 'text-gray-500'}`}>
              {myNet > 0.005
                ? `You are owed ₹${myNet.toFixed(2)}`
                : myNet < -0.005
                ? `You owe ₹${Math.abs(myNet).toFixed(2)}`
                : 'All settled up!'}
            </p>
            {balances.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {balances.map((b, i) => (
                  <li key={i} className="text-sm text-gray-600 flex justify-between items-center gap-2">
                    <span>
                      <span className={b.from === currentUserId ? 'font-semibold text-gray-900' : ''}>{displayName(b.from)}</span>
                      <span className="text-gray-400 mx-1.5">→</span>
                      <span className={b.to === currentUserId ? 'font-semibold text-gray-900' : ''}>{displayName(b.to)}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold text-gray-700">₹{b.amount.toFixed(2)}</span>
                      {b.from !== currentUserId && b.to === currentUserId && (
                        <a
                          href={whatsappReminderLink(displayName(b.from), b.amount, groupName)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-white bg-[#25D366] hover:bg-[#1ebe5d] rounded-full px-2.5 py-1 transition"
                          title="Remind on WhatsApp"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                          </svg>
                          Remind
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Expenses list */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Expenses</h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 h-16 animate-pulse" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 px-5 py-10 text-center">
              <p className="text-gray-400 text-sm">No expenses yet.</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-3 text-sm text-indigo-600 font-medium hover:underline"
              >
                Add the first one
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {expenses.map((ex) => {
                const iPaid = ex.paid_by === currentUserId
                return (
                  <li key={ex.id} className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ backgroundColor: avatarColor(ex.description) }}
                    >
                      {ex.description[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{ex.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        paid by{' '}
                        <span className={iPaid ? 'text-indigo-600 font-medium' : 'text-gray-600'}>
                          {iPaid ? 'you' : displayName(ex.paid_by)}
                        </span>
                        <span className="mx-1">·</span>
                        {new Date(ex.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <span className={`text-sm font-bold shrink-0 ${iPaid ? 'text-emerald-600' : 'text-gray-700'}`}>
                      ₹{Number(ex.amount).toFixed(2)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Members */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Members ({members.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {members.map((m) => {
              const name = displayName(m.user_id)
              const isMe = m.user_id === currentUserId
              return (
                <div
                  key={m.user_id}
                  className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                    style={{ backgroundColor: avatarColor(name) }}
                  >
                    {initials(name) || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                    {isMe && <p className="text-xs text-indigo-500">you</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Invite to group */}
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Invite to group
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5">
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Email address…"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteResult(null) }}
                onKeyDown={(e) => e.key === 'Enter' && inviteMember()}
                className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
              <button
                onClick={inviteMember}
                disabled={inviting || !inviteEmail.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shrink-0"
              >
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>

            {inviteResult && (
              <div
                className={`mt-3 text-sm rounded-xl px-4 py-3 ${
                  inviteResult.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : inviteResult.type === 'not_found'
                    ? 'bg-amber-50 text-amber-700'
                    : inviteResult.type === 'already_member'
                    ? 'bg-gray-50 text-gray-600'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                {inviteResult.type === 'not_found' ? (
                  <span>
                    No account found.{' '}
                    <button
                      onClick={() => navigator.clipboard.writeText(window.location.origin)}
                      className="underline font-medium hover:no-underline"
                    >
                      Copy signup link
                    </button>
                    {' '}and share it with them.
                  </span>
                ) : (
                  inviteResult.message
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Add Expense Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm px-4 pb-4 sm:pb-0"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">Add expense</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-700 transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={addExpense} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. Dinner, Cab, Hotel…"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (₹)</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
              <p className="text-xs text-gray-400">
                Split equally among {members.length} {members.length === 1 ? 'member' : 'members'}
                {members.length > 0 && amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
                  <> · ₹{(parseFloat(amount) / members.length).toFixed(2)} each</>
                )}
              </p>
              <button
                type="submit"
                disabled={adding}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                {adding ? 'Adding…' : 'Add expense'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
