import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getSession, signOut } from '../lib/auth'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
  },
  component: DashboardPage,
})

interface Group {
  id: string
  name: string
  created_at: string
}

function DashboardPage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<Group[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadGroups()
  }, [])

  async function loadGroups() {
    setLoading(true)
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setGroups(data ?? [])
    }
    setLoading(false)
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setCreating(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .insert({ name: newGroupName.trim(), created_by: user.id })
      .select()
      .single()

    if (groupErr) {
      setError(groupErr.message)
      setCreating(false)
      return
    }

    // Add creator as member
    await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
    })

    setNewGroupName('')
    setCreating(false)
    loadGroups()
  }

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Split Money</h1>
        <button
          onClick={handleSignOut}
          className="text-sm text-gray-500 hover:text-gray-800"
        >
          Sign out
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={createGroup} className="flex gap-2 mb-8">
          <input
            type="text"
            placeholder="New group name..."
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={creating || !newGroupName.trim()}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create group'}
          </button>
        </form>

        {error && (
          <p className="mb-4 text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
        )}

        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">
            No groups yet. Create one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  to="/groups/$groupId"
                  params={{ groupId: g.id }}
                  className="block bg-white rounded-xl border px-5 py-4 hover:shadow-sm transition-shadow"
                >
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(g.created_at).toLocaleDateString()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
