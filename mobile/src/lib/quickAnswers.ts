import { rupee, supabase } from '@/lib/supabase';
import { listMyTasks } from '@/lib/tasks';
import { listMyExpenses, listMyTravel } from '@/lib/requests';
import { getMyMonth } from '@/lib/timesheet';
import { isFinance, isHR, isManager } from '@/lib/roles';
import type { Profile } from '@/context/AuthContext';

// Canned instant-answer questions for the mobile chat bubble (native port
// of src/lib/quickAnswers.js's org-wide set, plus a new "personal" set
// scoped to the signed-in user — the web bubble has no personal
// questions since it's answering on behalf of whoever's looking, but
// mobile is always exactly one person's device, so "my tasks"/"my
// hours" is the natural default rather than only org-wide aggregates.
//
// Capability is role-gated (per the user's choice: everyone gets the
// chat icon, but the question set differs by role) — every role gets
// the personal set; the org-wide financial/ops set additionally
// requires isManager/isFinance/isHR, matching this app's existing role
// gates (mirrors @/lib/roles.ts) rather than inventing a new scheme.

export type QuickQuestion = {
  id: string;
  label: string;
  run: (profile: Profile) => Promise<string>;
};

async function safeRun(id: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const detail = e?.message || e?.details || e?.hint || e?.code || 'unknown error';
    return `Sorry, I couldn't fetch that right now (${detail}).`;
  }
}

const EXP_TRV_TERMINAL = ['approved', 'rejected'];
const PR_TERMINAL = ['draft', 'approved', 'rejected'];
const LEAVE_TERMINAL = ['approved', 'rejected'];
const PERSONAL_TERMINAL = ['approved', 'rejected', 'closed', 'cancelled'];

function pendingSummary(rows: { status: string }[], terminal: string[], noun: string): string {
  const pending = rows.filter((r) => !terminal.includes(r.status));
  const byStatus: Record<string, number> = {};
  pending.forEach((r) => { const k = r.status || 'unknown'; byStatus[k] = (byStatus[k] || 0) + 1; });
  const breakdown = Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(', ');
  const count = pending.length;
  return `There ${count === 1 ? 'is' : 'are'} ${count} ${noun}${count === 1 ? '' : 's'} pending${breakdown ? ` (${breakdown})` : ''}.`;
}

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  return { start, end };
}

// ── Personal — every role ──
export const PERSONAL_QUESTIONS: QuickQuestion[] = [
  {
    id: 'my-open-tasks',
    label: 'How many open tasks do I have?',
    run: (profile) => safeRun('my-open-tasks', async () => {
      const tasks = await listMyTasks(profile.id);
      if (!tasks.length) return "You're all caught up — no open tasks assigned to you.";
      const overdue = tasks.filter((t) => t.planned_end_date && new Date(t.planned_end_date) < new Date());
      return `You have ${tasks.length} open task${tasks.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}.`;
    }),
  },
  {
    id: 'my-hours-this-month',
    label: 'How many hours have I logged this month?',
    run: (profile) => safeRun('my-hours-this-month', async () => {
      const now = new Date();
      const { logs } = await getMyMonth(profile.id, now.getMonth() + 1, now.getFullYear());
      const total = logs.reduce((s, l) => s + (l.hours_worked ?? 0), 0);
      return `You've logged ${total.toFixed(1)}h this month across ${logs.length} session${logs.length === 1 ? '' : 's'}.`;
    }),
  },
  {
    id: 'my-pending-expenses',
    label: 'Do I have any pending expense requests?',
    run: (profile) => safeRun('my-pending-expenses', async () => {
      const expenses = await listMyExpenses(profile.id);
      const pending = expenses.filter((e) => !PERSONAL_TERMINAL.includes(e.status));
      if (!pending.length) return "No pending expense requests — you're all clear.";
      const total = pending.reduce((s, e) => s + (e.total_amount || 0), 0);
      return `You have ${pending.length} pending expense request${pending.length === 1 ? '' : 's'} totalling ${rupee(total)}.`;
    }),
  },
  {
    id: 'my-pending-travel',
    label: 'Do I have any pending travel requests?',
    run: (profile) => safeRun('my-pending-travel', async () => {
      const travel = await listMyTravel(profile.id);
      const pending = travel.filter((t) => !PERSONAL_TERMINAL.includes(t.status));
      if (!pending.length) return 'No pending travel requests.';
      return `You have ${pending.length} pending travel request${pending.length === 1 ? '' : 's'}.`;
    }),
  },
];

// ── Org-wide — managers, finance, HR ──
export const ORG_QUESTIONS: QuickQuestion[] = [
  {
    id: 'pending-expenses',
    label: 'How many expense approvals are pending?',
    run: () => safeRun('pending-expenses', async () => {
      const { data, error } = await supabase.from('expense_requests').select('status');
      if (error) throw error;
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'expense request');
    }),
  },
  {
    id: 'pending-pr',
    label: 'How many purchase requisitions are pending?',
    run: () => safeRun('pending-pr', async () => {
      const { data, error } = await supabase.from('purchase_requisitions').select('status');
      if (error) throw error;
      return pendingSummary(data || [], PR_TERMINAL, 'purchase requisition');
    }),
  },
  {
    id: 'pending-leave',
    label: 'How many leave requests are pending?',
    run: () => safeRun('pending-leave', async () => {
      const { data, error } = await supabase.from('leave_requests').select('status');
      if (error) throw error;
      return pendingSummary(data || [], LEAVE_TERMINAL, 'leave request');
    }),
  },
  {
    id: 'pending-travel',
    label: 'How many travel requests are pending?',
    run: () => safeRun('pending-travel', async () => {
      const { data, error } = await supabase.from('travel_requests').select('status');
      if (error) throw error;
      return pendingSummary(data || [], EXP_TRV_TERMINAL, 'travel request');
    }),
  },
  {
    id: 'over-budget-projects',
    label: 'Which projects are over budget?',
    run: () => safeRun('over-budget-projects', async () => {
      const { data, error } = await supabase.from('projects').select('id,name,budget,spent');
      if (error) throw error;
      const over = (data || []).filter((p) => (p.spent || 0) > (p.budget || 0)).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));
      if (!over.length) return 'No projects are currently over budget.';
      const top = over.slice(0, 5).map((p) => `• ${p.name} — over by ${rupee(p.spent - p.budget)}`).join('\n');
      return `${over.length} project${over.length === 1 ? ' is' : 's are'} over budget:\n${top}${over.length > 5 ? `\n…and ${over.length - 5} more` : ''}`;
    }),
  },
  {
    id: 'budget-vs-spent',
    label: "What's the total budget vs spent across all projects?",
    run: () => safeRun('budget-vs-spent', async () => {
      const { data, error } = await supabase.from('projects').select('budget,spent');
      if (error) throw error;
      const budget = (data || []).reduce((s, p) => s + (p.budget || 0), 0);
      const spent = (data || []).reduce((s, p) => s + (p.spent || 0), 0);
      const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
      return `Total project budget is ${rupee(budget)}, with ${rupee(spent)} spent so far (${pct}% utilized).`;
    }),
  },
  {
    id: 'spend-this-month',
    label: 'How much have we spent this month?',
    run: () => safeRun('spend-this-month', async () => {
      const { start, end } = monthBounds();
      const [expR, invR] = await Promise.all([
        supabase.from('expense_requests').select('total_amount,amount').gte('created_at', start).lt('created_at', end),
        supabase.from('invoices').select('total_amount').gte('created_at', start).lt('created_at', end),
      ]);
      if (expR.error) throw expR.error;
      if (invR.error) throw invR.error;
      const expTotal = (expR.data || []).reduce((s, e) => s + (e.total_amount || e.amount || 0), 0);
      const invTotal = (invR.data || []).reduce((s, i) => s + (i.total_amount || 0), 0);
      return `This month's spend so far: ${rupee(expTotal + invTotal)} (${rupee(expTotal)} expenses + ${rupee(invTotal)} invoices).`;
    }),
  },
  {
    id: 'pending-invoices',
    label: 'How much is pending in invoices?',
    run: () => safeRun('pending-invoices', async () => {
      const { data, error } = await supabase.from('invoices').select('total_amount,status');
      if (error) throw error;
      const pending = (data || []).filter((i) => !['paid', 'rejected'].includes(i.status)).reduce((s, i) => s + (i.total_amount || 0), 0);
      return `${rupee(pending)} is currently pending across unpaid invoices.`;
    }),
  },
  {
    id: 'department-budget-health',
    label: 'Which department is most over budget?',
    run: () => safeRun('department-budget-health', async () => {
      const [deptR, budR] = await Promise.all([
        supabase.from('departments').select('id,name'),
        supabase.from('budgets').select('allocated,spent,department_id'),
      ]);
      if (deptR.error) throw deptR.error;
      if (budR.error) throw budR.error;
      const depts = deptR.data || [];
      const budgets = budR.data || [];
      if (!depts.length) return 'No departments are configured yet.';
      const rows = depts.map((dep) => {
        const deptBudgets = budgets.filter((b) => b.department_id === dep.id);
        const allocated = deptBudgets.reduce((s, b) => s + (b.allocated || 0), 0);
        const spent = deptBudgets.reduce((s, b) => s + (b.spent || 0), 0);
        const pct = allocated > 0 ? Math.round((spent / allocated) * 100) : null;
        return { name: dep.name, pct };
      }).filter((r): r is { name: string; pct: number } => r.pct != null).sort((a, b) => b.pct - a.pct);
      if (!rows.length) return 'No department has a budget allocated yet.';
      const worst = rows[0];
      return `${worst.name} is the most utilized department budget at ${worst.pct}%.${rows.length > 1 ? ` Next: ${rows.slice(1, 4).map((r) => `${r.name} (${r.pct}%)`).join(', ')}.` : ''}`;
    }),
  },
  {
    id: 'active-employees',
    label: 'How many active employees do we have?',
    run: () => safeRun('active-employees', async () => {
      const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).neq('is_active', false);
      if (error) throw error;
      return `There are ${count || 0} active employees.`;
    }),
  },
];

// The question set this profile's role gets — personal for everyone,
// org-wide financial/ops questions added on top for leadership roles.
export function questionsForRole(role?: string | null): QuickQuestion[] {
  const canSeeOrgInsights = isManager(role) || isFinance(role) || isHR(role);
  return canSeeOrgInsights ? [...PERSONAL_QUESTIONS, ...ORG_QUESTIONS] : PERSONAL_QUESTIONS;
}
