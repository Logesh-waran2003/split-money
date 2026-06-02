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

interface Profile {
  id: string
  display_name: string
  avatar_url?: string
}

// Deterministic avatar color from any string
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

function DashboardPage() {
  const navigate = useNavigate()

  const [groups, setGroups] = useState<Group[]>([])
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [profileRes, groupsRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, avatar_url').eq('id', user.id).single(),
      supabase.from('groups').select('id, name, created_at').order('created_at', { ascending: false }),
    ])

    if (profileRes.data) setCurrentProfile(profileRes.data)
    const groupList = groupsRes.data ?? []
    setGroups(groupList)

    if (groupList.length > 0) {
      const { data: membersData } = await supabase
        .from('group_members')
        .select('group_id')
        .in('group_id', groupList.map((g) => g.id))

      const counts = (membersData ?? []).reduce<Record<string, number>>((acc, m) => {
        acc[m.group_id] = (acc[m.group_id] ?? 0) + 1
        return acc
      }, {})
      setMemberCounts(counts)
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

    await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id })

    setNewGroupName('')
    setShowNewGroup(false)
    setCreating(false)
    loadAll()
  }

  async function handleSignOut() {
    await signOut()
    navigate({ to: '/login' })
  }

  const displayName = currentProfile?.display_name ?? 'You'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg width="32" height="32" viewBox="0 0 48 48" fill="none">
            <circle cx="17" cy="24" r="14" fill="#6366f1" opacity="0.85" />
            <circle cx="31" cy="24" r="14" fill="#6366f1" opacity="0.55" />
          </svg>
          <span className="font-bold text-gray-900 text-base">split money</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Link to="/profile">
              {currentProfile?.avatar_url ? (
                <img
                  src={currentProfile.avatar_url}
                  alt={displayName}
                  className="w-8 h-8 rounded-full object-cover shrink-0 hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition"
                />
              ) : (
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 hover:ring-2 hover:ring-indigo-400 hover:ring-offset-1 transition"
                  style={{ backgroundColor: avatarColor(displayName) }}
                >
                  {initials(displayName) || '?'}
                </div>
              )}
            </Link>
            <span className="text-sm font-medium text-gray-700 hidden sm:block">{displayName}</span>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 hover:text-gray-700 transition"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Section heading + new group button */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Your groups</h2>
          <button
            onClick={() => setShowNewGroup((v) => !v)}
            className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3.5 py-1.5 font-medium transition"
          >
            + New group
          </button>
        </div>

        {/* Inline new group form */}
        {showNewGroup && (
          <div className="mb-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm font-medium text-gray-700 mb-3">Group name</p>
            <form onSubmit={createGroup} className="flex gap-2">
              <input
                type="text"
                autoFocus
                placeholder="e.g. Goa trip, Flatmates…"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
              <button
                type="submit"
                disabled={creating || !newGroupName.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition"
              >
                {creating ? '…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNewGroup(false); setNewGroupName('') }}
                className="text-sm text-gray-400 hover:text-gray-700 px-2 transition"
              >
                Cancel
              </button>
            </form>
          </div>
        )}

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 h-20 animate-pulse" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-20">
            <div className="flex justify-center mb-4">
              <svg width="48" height="48" fill="none" viewBox="0 0 48 48">
                <circle cx="17" cy="20" r="8" stroke="#d1d5db" strokeWidth="2" />
                <circle cx="31" cy="20" r="8" stroke="#d1d5db" strokeWidth="2" />
                <path d="M4 38c0-5.5 5.8-10 13-10m14 0c7.2 0 13 4.5 13 10" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-gray-500 font-medium mb-1">No groups yet</p>
            <p className="text-sm text-gray-400 mb-5">Create a group to start tracking expenses</p>
            <button
              onClick={() => setShowNewGroup(true)}
              className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 py-2.5 font-semibold transition"
            >
              Create your first group
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {groups.map((g) => {
              const count = memberCounts[g.id] ?? 0
              return (
                <li key={g.id}>
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: g.id }}
                    className="flex items-center gap-4 bg-white rounded-2xl border border-gray-100 px-5 py-4 hover:shadow-md transition-shadow"
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: avatarColor(g.name) }}
                    >
                      {g.name[0]?.toUpperCase() ?? '#'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{g.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {count} {count === 1 ? 'member' : 'members'}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
