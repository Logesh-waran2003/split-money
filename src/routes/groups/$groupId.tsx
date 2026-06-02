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
  email?: string
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

function GroupPage() {
  const { groupId } = Route.useParams()
  const navigate = useNavigate()

  const [groupName, setGroupName] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [splits, setSplits] = useState<SplitRow[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New expense form
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [adding, setAdding] = useState(false)

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
    setMembers(membersRes.data ?? [])

    const expenseList: ExpenseRow[] = expensesRes.data ?? []
    setExpenses(expenseList)

    // Load splits for these expenses
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
      .insert({
        group_id: groupId,
        paid_by: currentUserId,
        amount: parsed,
        description: desc.trim(),
      })
      .select()
      .single()

    if (expErr) { setError(expErr.message); setAdding(false); return }

    // Split equally among all members
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
    loadAll()
  }

  const balances = computeBalances(
    expenses.map((e): Expense => ({ id: e.id, paid_by: e.paid_by, amount: e.amount })),
    splits.map((s): Split => ({ expense_id: s.expense_id, user_id: s.user_id, amount: s.amount, settled: s.settled }))
  )

  const shortId = (uid: string) => uid.slice(0, 8)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => navigate({ to: '/dashboard' })}
          className="text-sm text-gray-400 hover:text-gray-700"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold">{groupName || 'Group'}</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        {/* Add expense */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Add Expense
          </h2>
          <form onSubmit={addExpense} className="flex gap-2">
            <input
              type="text"
              placeholder="Description"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Amount"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={adding}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? '...' : 'Add'}
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-1">Split equally among {members.length} member{members.length !== 1 ? 's' : ''}</p>
        </section>

        {/* Balances */}
        {balances.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Who Owes Who
            </h2>
            <ul className="space-y-2">
              {balances.map((b, i) => (
                <li key={i} className="bg-white rounded-xl border px-5 py-3 text-sm flex justify-between">
                  <span>
                    <span className="font-mono text-gray-500">{shortId(b.from)}</span>
                    <span className="text-gray-400 mx-2">owes</span>
                    <span className="font-mono text-gray-500">{shortId(b.to)}</span>
                  </span>
                  <span className="font-semibold text-orange-600">₹{b.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Members */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Members ({members.length})
          </h2>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="text-sm font-mono text-gray-600 bg-white rounded-lg border px-4 py-2">
                {m.user_id === currentUserId ? (
                  <span>{shortId(m.user_id)} <span className="text-blue-500 text-xs">(you)</span></span>
                ) : shortId(m.user_id)}
              </li>
            ))}
          </ul>
        </section>

        {/* Expenses */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Expenses
          </h2>
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : expenses.length === 0 ? (
            <p className="text-sm text-gray-400">No expenses yet.</p>
          ) : (
            <ul className="space-y-2">
              {expenses.map((ex) => (
                <li key={ex.id} className="bg-white rounded-xl border px-5 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium">{ex.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        paid by <span className="font-mono">{shortId(ex.paid_by)}</span>
                        {ex.paid_by === currentUserId && (
                          <span className="text-blue-500 ml-1">(you)</span>
                        )}
                        {' · '}
                        {new Date(ex.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-sm font-semibold">₹{Number(ex.amount).toFixed(2)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}
