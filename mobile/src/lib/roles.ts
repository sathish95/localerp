// Mirrors the role helpers in the web app's src/App.jsx so screen- and
// tab-level role checks read the same on both platforms. Module access is
// handled separately by get_effective_modules() (see @/lib/modules);
// these are only for "who sees this screen at all" gates.

export const IT_AGENT_ROLES = ['admin', 'ceo', 'manager', 'department_head'] as const;

export const isAdmin = (role?: string | null) =>
  !!role && ['admin', 'ceo'].includes(role);

export const isManager = (role?: string | null) =>
  !!role && ['admin', 'ceo', 'manager', 'department_head'].includes(role);

export const isFinance = (role?: string | null) =>
  !!role && ['admin', 'ceo', 'finance'].includes(role);

export const isHR = (role?: string | null) =>
  !!role && ['admin', 'ceo', 'hr'].includes(role);

// Anyone who works IT Helpdesk tickets (matches it_helpdesk_is_agent() in SQL).
export const isItAgent = (role?: string | null) =>
  !!role && (IT_AGENT_ROLES as readonly string[]).includes(role);
