import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { getSession } from '../../lib/auth'
import { computeBalances } from '../../lib/balance'
import type { Expense, Split } from '../../lib/balance'
import QRCode from 'react-qr-code'

const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  food:          { emoji: '🍔', label: 'Food' },
  transport:     { emoji: '🚗', label: 'Transport' },
  rent:          { emoji: '🏠', label: 'Rent' },
  utilities:     { emoji: '💡', label: 'Utilities' },
  entertainment: { emoji: '🎬', label: 'Entertainment' },
  shopping:      { emoji: '🛍️', label: 'Shopping' },
  health:        { emoji: '💊', label: 'Health' },
  travel:        { emoji: '✈️', label: 'Travel' },
  other:         { emoji: '📦', label: 'Other' },
}

function CategoryPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(CATEGORY_META).map(([key, { emoji, label }]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 transition ${
            value === key
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span>{emoji}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

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
  phone?: string
  upi_id?: string
}

interface ExpenseRow {
  id: string
  description: string
  amount: number
  paid_by: string
  category: string
  created_at: string
}

interface SplitRow {
  id: string
  expense_id: string
  user_id: string
  amount: number
  settled: boolean
}

interface PendingInvite {
  id: string
  phone: string
  created_at: string
}

interface SettlementRow {
  from_user: string
  to_user: string
  amount: number
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
  const [groupCreatedBy, setGroupCreatedBy] = useState<string | null>(null)
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
  const [category, setCategory] = useState('other')
  const [adding, setAdding] = useState(false)

  // Edit / delete expense
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ description: string; amount: string; category: string } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [expenseMenuId, setExpenseMenuId] = useState<string | null>(null)

  // Group actions menu
  const [showMenu, setShowMenu] = useState(false)

  // Rename
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // Leave group
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  // Delete group
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Invite by email
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{
    type: 'success' | 'not_found' | 'already_member' | 'error'
    message: string
  } | null>(null)
  const [inviteTab, setInviteTab] = useState<'email' | 'phone'>('email')
  const [invitePhone, setInvitePhone] = useState('')
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])

  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [settleModal, setSettleModal] = useState<{ toUserId: string; amount: number } | null>(null)
  const [settling, setSettling] = useState(false)

  useEffect(() => {
    loadAll()
  }, [groupId])

  async function loadAll() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    setCurrentUserId(user?.id ?? null)

    const [groupRes, membersRes, expensesRes] = await Promise.all([
      supabase.from('groups').select('name, created_by').eq('id', groupId).single(),
      supabase.from('group_members').select('user_id').eq('group_id', groupId),
      supabase.from('expenses').select('id, description, amount, paid_by, category, created_at').eq('group_id', groupId).order('created_at', { ascending: false }),
    ])

    if (groupRes.error) { setError(groupRes.error.message); setLoading(false); return }
    setGroupName(groupRes.data.name)
    setGroupCreatedBy(groupRes.data.created_by)

    const memberList: Member[] = membersRes.data ?? []
    setMembers(memberList)

    // Load profiles for all members in one shot
    if (memberList.length > 0) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name, phone, upi_id')
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

    const { data: pendingData } = await supabase
      .from('group_invites')
      .select('id, phone, created_at')
      .eq('group_id', groupId)
      .eq('status', 'pending')
    setPendingInvites(pendingData ?? [])

    const { data: settlementsData } = await supabase
      .from('settlements')
      .select('from_user, to_user, amount')
      .eq('group_id', groupId)
    setSettlements(settlementsData ?? [])

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
      .insert({ group_id: groupId, paid_by: currentUserId, amount: parsed, description: desc.trim(), category })
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
    setCategory('other')
    setAdding(false)
    setShowModal(false)
    loadAll()
  }

  async function deleteExpense(expenseId: string, expenseDescription: string) {
    if (!currentUserId) return
    const { error: delErr } = await supabase.from('expenses').delete().eq('id', expenseId)
    if (delErr) { setError(delErr.message); return }
    await supabase.from('activity').insert({
      group_id: groupId,
      user_id: currentUserId,
      action: 'expense_deleted',
      meta: { description: `Deleted expense: ${expenseDescription}` },
    })
    setDeleteConfirmId(null)
    setExpenseMenuId(null)
    loadAll()
  }

  async function saveEditExpense(expenseId: string) {
    if (!editForm || !currentUserId) return
    const parsed = parseFloat(editForm.amount)
    if (!editForm.description.trim() || isNaN(parsed) || parsed <= 0) return

    setEditSaving(true)
    const { error: updErr } = await supabase
      .from('expenses')
      .update({ description: editForm.description.trim(), amount: parsed, category: editForm.category })
      .eq('id', expenseId)
    if (updErr) { setError(updErr.message); setEditSaving(false); return }

    // Re-split equally
    await supabase.from('expense_splits').delete().eq('expense_id', expenseId)
    const share = Math.round((parsed / members.length) * 100) / 100
    const splitRows = members.map((m) => ({
      expense_id: expenseId,
      user_id: m.user_id,
      amount: share,
      settled: false,
    }))
    await supabase.from('expense_splits').insert(splitRows)

    await supabase.from('activity').insert({
      group_id: groupId,
      user_id: currentUserId,
      action: 'expense_edited',
      meta: { description: `Edited expense: ${editForm.description.trim()}` },
    })

    setEditSaving(false)
    setEditingExpenseId(null)
    setEditForm(null)
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

  async function inviteByPhone() {
    if (!invitePhone.trim()) return
    setInviting(true)
    setInviteResult(null)

    const { data: userId } = await supabase.rpc('find_user_by_phone', {
      phone_input: invitePhone.trim(),
    })

    if (userId) {
      const alreadyMember = members.some((m) => m.user_id === userId)
      if (alreadyMember) {
        setInviteResult({ type: 'already_member', message: 'Already in this group.' })
      } else {
        const { error: addErr } = await supabase
          .from('group_members')
          .insert({ group_id: groupId, user_id: userId })
        if (addErr) {
          setInviteResult({ type: 'error', message: addErr.message })
        } else {
          setInviteResult({ type: 'success', message: 'Added to group!' })
          setInvitePhone('')
          loadAll()
        }
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('group_invites').insert({
        group_id: groupId,
        invited_by: user!.id,
        phone: invitePhone.trim(),
      })
      const msg = `Hey! ${displayName(currentUserId!)} added you to "${groupName}" on Split Money to track shared expenses. Sign up here: ${window.location.origin}`
      const waUrl = `https://wa.me/${invitePhone.trim().replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
      window.open(waUrl, '_blank')
      setInviteResult({
        type: 'not_found',
        message: `Invite saved. WhatsApp opened — they'll be added automatically when they sign up with this number.`,
      })
      setInvitePhone('')
      loadAll()
    }
    setInviting(false)
  }

  function whatsappReminderLink(debtorName: string, amount: number, groupName: string): string {
    const msg = `Hey ${debtorName}, just a reminder you owe me ₹${amount.toFixed(2)} for ${groupName} expenses on Split Money. Settle up when you can! 🙏`
    return `https://wa.me/?text=${encodeURIComponent(msg)}`
  }

  function displayName(userId: string): string {
    return profiles[userId]?.display_name || userId.slice(0, 8)
  }

  async function markSettled() {
    if (!currentUserId || !settleModal) return
    setSettling(true)
    await supabase.from('settlements').insert({
      group_id: groupId,
      from_user: currentUserId,
      to_user: settleModal.toUserId,
      amount: settleModal.amount,
      note: 'Settled',
    })
    setSettling(false)
    setSettleModal(null)
    loadAll()
  }

  async function handleRenameGroup() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === groupName) { setEditingName(false); return }
    await supabase.from('groups').update({ name: trimmed }).eq('id', groupId)
    setGroupName(trimmed)
    setEditingName(false)
  }

  async function handleLeave() {
    if (!currentUserId) return
    await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', currentUserId)
    navigate({ to: '/dashboard' })
  }

  async function handleDeleteGroup() {
    setDeleting(true)
    await supabase.from('groups').delete().eq('id', groupId)
    navigate({ to: '/dashboard' })
  }

  const balances = computeBalances(
    expenses.map((e): Expense => ({ id: e.id, paid_by: e.paid_by, amount: e.amount })),
    splits.map((s): Split => ({ expense_id: s.expense_id, user_id: s.user_id, amount: s.amount, settled: s.settled })),
    settlements.map((s) => ({ from_user: s.from_user, to_user: s.to_user, amount: Number(s.amount) }))
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

        {/* Group name / inline rename */}
        {editingName ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameGroup(); if (e.key === 'Escape') setEditingName(false) }}
              className="flex-1 border border-indigo-300 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-0"
            />
            <button onClick={handleRenameGroup} className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 transition shrink-0">Save</button>
            <button onClick={() => setEditingName(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700 transition shrink-0">Cancel</button>
          </div>
        ) : (
          <h1 className="font-bold text-gray-900 text-lg flex-1 truncate">{groupName || '…'}</h1>
        )}

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

        {/* ⋯ actions menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
              {currentUserId === groupCreatedBy && (
                <button
                  onClick={() => { setNameInput(groupName); setEditingName(true); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Rename group
                </button>
              )}
              {currentUserId !== groupCreatedBy && (
                <button
                  onClick={() => { setShowLeaveConfirm(true); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Leave group
                </button>
              )}
              {currentUserId === groupCreatedBy && (
                <button
                  onClick={() => { setShowDeleteConfirm(true); setShowMenu(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete group
                </button>
              )}
            </div>
          )}
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
                      {b.from === currentUserId && b.to !== currentUserId && (
                        <button
                          onClick={() => setSettleModal({ toUserId: b.to, amount: b.amount })}
                          className="inline-flex items-center gap-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-full px-2.5 py-1 transition"
                        >
                          Settle up
                        </button>
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
                const isOwner = ex.paid_by === currentUserId
                const catMeta = CATEGORY_META[ex.category] ?? CATEGORY_META.other
                const isEditingThis = editingExpenseId === ex.id
                const isDeletingThis = deleteConfirmId === ex.id
                const menuOpen = expenseMenuId === ex.id
                return (
                  <li key={ex.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                    {/* Main row */}
                    <div className="px-5 py-4 flex items-center gap-4">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                        style={{ backgroundColor: avatarColor(ex.description) }}
                      >
                        {ex.description[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          <span className="mr-1.5">{catMeta.emoji}</span>{ex.description}
                        </p>
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
                      {isOwner && (
                        <div className="relative shrink-0">
                          <button
                            onClick={() => setExpenseMenuId(menuOpen ? null : ex.id)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                            aria-label="Expense options"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                            </svg>
                          </button>
                          {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-20">
                              <button
                                onClick={() => {
                                  setEditingExpenseId(ex.id)
                                  setEditForm({ description: ex.description, amount: String(ex.amount), category: ex.category })
                                  setDeleteConfirmId(null)
                                  setExpenseMenuId(null)
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <span>✏️</span> Edit
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteConfirmId(ex.id)
                                  setEditingExpenseId(null)
                                  setEditForm(null)
                                  setExpenseMenuId(null)
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <span>🗑️</span> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Delete confirm */}
                    {isDeletingThis && (
                      <div className="px-5 py-3 bg-red-50 border-t border-red-100">
                        <p className="text-sm text-red-700 mb-2.5">Delete this expense? This can't be undone.</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => deleteExpense(ex.id, ex.description)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl py-1.5 text-xs font-semibold transition"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-1.5 text-xs font-medium hover:bg-white transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Inline edit */}
                    {isEditingThis && editForm && (
                      <div className="px-5 py-4 border-t border-gray-100 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                          <input
                            autoFocus
                            type="text"
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹)</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={editForm.amount}
                            onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1.5">Category</label>
                          <CategoryPicker value={editForm.category} onChange={(c) => setEditForm({ ...editForm, category: c })} />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => saveEditExpense(ex.id)}
                            disabled={editSaving}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-2 text-xs font-semibold transition"
                          >
                            {editSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingExpenseId(null); setEditForm(null) }}
                            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-xs font-medium hover:bg-gray-50 transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
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
                    {profiles[m.user_id]?.phone && (
                      <p className="text-xs text-gray-400 truncate">{profiles[m.user_id].phone}</p>
                    )}
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
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-5 space-y-4">
            {/* Tab toggle */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              <button
                onClick={() => { setInviteTab('email'); setInviteResult(null) }}
                className={`text-sm font-medium rounded-lg px-4 py-1.5 transition ${
                  inviteTab === 'email'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                By email
              </button>
              <button
                onClick={() => { setInviteTab('phone'); setInviteResult(null) }}
                className={`text-sm font-medium rounded-lg px-4 py-1.5 transition ${
                  inviteTab === 'phone'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                By phone
              </button>
            </div>

            {/* Email tab */}
            {inviteTab === 'email' && (
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
            )}

            {/* Phone tab */}
            {inviteTab === 'phone' && (
              <div className="flex gap-2">
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={invitePhone}
                  onChange={(e) => { setInvitePhone(e.target.value); setInviteResult(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && inviteByPhone()}
                  className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
                <button
                  onClick={inviteByPhone}
                  disabled={inviting || !invitePhone.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition shrink-0"
                >
                  {inviting ? 'Inviting…' : 'Invite'}
                </button>
              </div>
            )}

            {/* Result message */}
            {inviteResult && (
              <div
                className={`text-sm rounded-xl px-4 py-3 ${
                  inviteResult.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : inviteResult.type === 'not_found'
                    ? 'bg-amber-50 text-amber-700'
                    : inviteResult.type === 'already_member'
                    ? 'bg-gray-50 text-gray-600'
                    : 'bg-red-50 text-red-600'
                }`}
              >
                {inviteResult.type === 'not_found' && inviteTab === 'email' ? (
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

          {/* Pending phone invites */}
          {pendingInvites.length > 0 && (
            <div className="mt-3 bg-white rounded-2xl border border-gray-100 px-5 py-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Pending invites ({pendingInvites.length})
              </h3>
              <ul className="space-y-2">
                {pendingInvites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-700">{inv.phone}</span>
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2.5 py-0.5 shrink-0">
                      Waiting for signup
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Leave confirm */}
        {showLeaveConfirm && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <p className="text-sm font-medium text-amber-800 mb-3">Leave this group?</p>
            <p className="text-xs text-amber-600 mb-4">You'll lose access to all expenses and balances in this group.</p>
            <div className="flex gap-2">
              <button
                onClick={handleLeave}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-2 text-sm font-semibold transition"
              >
                Leave group
              </button>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Danger zone — creator only */}
        {currentUserId === groupCreatedBy && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Danger zone</h2>
            <div className="bg-white rounded-2xl border border-red-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Delete group</p>
                  <p className="text-xs text-gray-400 mt-0.5">Permanently removes all expenses, balances, and history</p>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-sm text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 rounded-xl px-4 py-2 font-medium transition shrink-0"
                >
                  Delete
                </button>
              </div>
            </div>
          </section>
        )}
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Category</label>
                <CategoryPicker value={category} onChange={setCategory} />
              </div>
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

      {/* Settle Modal */}
      {settleModal && (() => {
        const payee = profiles[settleModal.toUserId]
        const payeeName = displayName(settleModal.toUserId)
        const theirUpiId = payee?.upi_id
        const isAndroid = /android/i.test(navigator.userAgent)
        const upiString = theirUpiId
          ? `upi://pay?pa=${encodeURIComponent(theirUpiId)}&pn=${encodeURIComponent(payeeName)}&am=${settleModal.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Split Money - ${groupName}`)}`
          : null

        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm px-4 pb-4 sm:pb-0"
            onClick={(e) => { if (e.target === e.currentTarget) setSettleModal(null) }}
          >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-900">Settle up</h2>
                <button onClick={() => setSettleModal(null)} className="text-gray-400 hover:text-gray-700 transition">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-5">
                You owe <span className="font-semibold text-gray-900">{payeeName}</span>{' '}
                <span className="font-bold text-gray-900">₹{settleModal.amount.toFixed(2)}</span>
              </p>

              {upiString ? (
                <div className="mb-5 space-y-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pay via UPI</p>
                  {isAndroid ? (
                    <div className="space-y-3">
                      <a
                        href={upiString}
                        target="_blank"
                        rel="noopener"
                        className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold transition"
                      >
                        Pay ₹{settleModal.amount.toFixed(2)} via UPI
                      </a>
                      <div className="flex flex-col items-center gap-2 py-3">
                        <QRCode value={upiString} size={160} />
                        <p className="text-xs text-gray-400">Scan with GPay, PhonePe, or any UPI app</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-3">
                      <QRCode value={upiString} size={160} />
                      <p className="text-xs text-gray-400">Scan with GPay, PhonePe, or any UPI app</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-400 text-center">UPI ID: {theirUpiId}</p>
                </div>
              ) : (
                <div className="mb-5 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                  <p className="text-sm text-amber-700">
                    {payeeName} hasn't added a UPI ID yet. Pay them directly and mark as settled.
                  </p>
                </div>
              )}

              <button
                onClick={markSettled}
                disabled={settling}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                {settling ? 'Recording…' : 'Mark as settled'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Delete group confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete "{groupName}"?</h2>
            <p className="text-sm text-gray-500 mb-6">This will permanently delete all expenses, splits, settlements, and history. This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteGroup}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition"
              >
                {deleting ? 'Deleting…' : 'Delete group'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
