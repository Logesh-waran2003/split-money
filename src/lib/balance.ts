export interface Split {
  expense_id: string
  user_id: string
  amount: number
  settled: boolean
}

export interface Expense {
  id: string
  paid_by: string
  amount: number
}

export interface Balance {
  from: string
  to: string
  amount: number
}

export interface Settlement {
  from_user: string
  to_user: string
  amount: number
}

/**
 * Compute net balances for a group.
 * Returns who owes whom and how much (consolidated, rounded to 2dp).
 * Settlements (cash/UPI payments recorded separately) reduce the net balances.
 */
export function computeBalances(
  expenses: Expense[],
  splits: Split[],
  settlements: Settlement[] = []
): Balance[] {
  // net[userId] = positive means they are owed money, negative means they owe money
  const net: Record<string, number> = {}

  for (const expense of expenses) {
    // payer gets credited the full amount
    net[expense.paid_by] = (net[expense.paid_by] ?? 0) + expense.amount

    // each split participant owes their share
    const relevantSplits = splits.filter(
      (s) => s.expense_id === expense.id && !s.settled
    )
    for (const split of relevantSplits) {
      net[split.user_id] = (net[split.user_id] ?? 0) - split.amount
    }
  }

  // Settlements reduce net balances: debtor paid, so their debt shrinks;
  // creditor received, so their credit shrinks
  for (const s of settlements) {
    net[s.from_user] = (net[s.from_user] ?? 0) + s.amount
    net[s.to_user]   = (net[s.to_user]   ?? 0) - s.amount
  }

  // Simplify: debtors pay creditors
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, amount: -v }))
    .sort((a, b) => b.amount - a.amount)

  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, amount: v }))
    .sort((a, b) => b.amount - a.amount)

  const result: Balance[] = []
  let d = 0
  let c = 0

  while (d < debtors.length && c < creditors.length) {
    const settle = Math.min(debtors[d].amount, creditors[c].amount)
    if (settle > 0.005) {
      result.push({
        from: debtors[d].id,
        to: creditors[c].id,
        amount: Math.round(settle * 100) / 100,
      })
    }
    debtors[d].amount -= settle
    creditors[c].amount -= settle
    if (debtors[d].amount < 0.005) d++
    if (creditors[c].amount < 0.005) c++
  }

  return result
}
