/**
 * Goal planner (Layer 3). Builds a concrete monthly savings plan grounded in
 * the user's real average monthly surplus, and tracks progress against target.
 */
import type { Goal, GoalPlanStep, Transaction } from '@/data/types';
import { inMonth, totalExpense, totalIncome } from '@/data/analytics';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function averageMonthlySurplus(txns: Transaction[], months = 3): number {
  const now = new Date();
  let total = 0;
  let counted = 0;
  for (let m = 1; m <= months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const key = d.toISOString().slice(0, 7);
    const inM = inMonth(txns, key);
    if (!inM.length) continue;
    total += totalIncome(inM) - totalExpense(inM);
    counted++;
  }
  return counted ? Math.round(total / counted) : 0;
}

export interface GoalPlan {
  steps: GoalPlanStep[];
  monthlyTarget: number;
  monthsLeft: number;
  feasible: boolean;
  surplus: number;
  summary: string;
}

export function buildGoalPlan(goal: Goal, txns: Transaction[]): GoalPlan {
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const monthsLeft = goal.deadline ? Math.max(1, monthsBetween(new Date(), new Date(goal.deadline))) : 6;
  const monthlyTarget = Math.ceil(remaining / monthsLeft / 100) * 100;
  const surplus = averageMonthlySurplus(txns);
  const feasible = surplus >= monthlyTarget;

  const steps: GoalPlanStep[] = [];
  const now = new Date();
  let projected = goal.currentAmount;
  for (let i = 0; i < monthsLeft; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const contribution = i === monthsLeft - 1 ? Math.max(0, goal.targetAmount - projected) : monthlyTarget;
    projected += contribution;
    steps.push({
      month: d.toISOString().slice(0, 7),
      contribution,
      note: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  const summary = feasible
    ? `Set aside ${inr(monthlyTarget)}/month for ${monthsLeft} month${monthsLeft > 1 ? 's' : ''} to reach ${inr(goal.targetAmount)} by your deadline. Your recent surplus averages ${inr(surplus)}/month, so this is comfortably on track.`
    : `Reaching ${inr(goal.targetAmount)} needs ${inr(monthlyTarget)}/month, but your recent surplus averages only ${inr(surplus)}/month. Consider trimming a category or extending the deadline by a couple of months.`;

  return { steps, monthlyTarget, monthsLeft, feasible, surplus, summary };
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function goalProgressPct(goal: Goal): number {
  return goal.targetAmount ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100) : 0;
}
