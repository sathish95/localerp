import { nextNum, supabase } from '@/lib/supabase';

export const EXPENSE_CATEGORIES = [
  'Travel', 'Food & Beverage', 'Accommodation', 'Office Supplies', 'Software',
  'Marketing', 'Training', 'Medical', 'Utilities', 'Miscellaneous',
] as const;

export const TRAVEL_MODES = ['Flight', 'Train', 'Bus', 'Car', 'Cab', 'Other'] as const;

export type RequestStatus =
  | 'submitted' | 'manager_review' | 'ceo_review' | 'finance_review'
  | 'approved' | 'rejected' | 'closed' | 'cancelled' | 'draft';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: 'Draft', submitted: 'Pending Manager', manager_review: 'Pending CEO',
  ceo_review: 'Pending Finance', finance_review: 'In Finance Review',
  approved: 'Approved', rejected: 'Rejected', closed: 'Closed', cancelled: 'Cancelled',
};

export const STATUS_COLOR: Record<RequestStatus, string> = {
  draft: '#475569', submitted: '#b45309', manager_review: '#1d4ed8',
  ceo_review: '#dc2626', finance_review: '#065f46',
  approved: '#15803d', rejected: '#dc2626', closed: '#475569', cancelled: '#475569',
};

export type Project = { id: string; name: string; code?: string; budget?: number | null; spent?: number | null };

export type ExpenseRequest = {
  id: string; expense_number: string; title: string; category: string;
  description: string | null; expense_date: string; amount: number; total_amount: number;
  status: RequestStatus; project?: { name: string } | null;
};

export type TravelRequest = {
  id: string; request_number: string; from_location: string; to_location: string;
  travel_date: string; return_date: string | null; purpose: string; travel_mode: string;
  estimated_cost: number | null; status: RequestStatus; project?: { name: string } | null;
};

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from('projects').select('id,name,code,budget,spent').order('name');
  if (error) throw error;
  return data;
}

export async function listMyExpenses(userId: string): Promise<ExpenseRequest[]> {
  const { data, error } = await supabase
    .from('expense_requests')
    .select('id, expense_number, title, category, description, expense_date, amount, total_amount, status, project:projects(name)')
    .eq('requested_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as ExpenseRequest[];
}

export async function listMyTravel(userId: string): Promise<TravelRequest[]> {
  const { data, error } = await supabase
    .from('travel_requests')
    .select('id, request_number, from_location, to_location, travel_date, return_date, purpose, travel_mode, estimated_cost, status, project:projects(name)')
    .eq('requested_by', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as TravelRequest[];
}

// Uploads a local image URI (from expo-image-picker) to the same `invoices`
// storage bucket the web app's receipt upload uses, and returns its public URL.
async function uploadReceipt(userId: string, num: string, uri: string): Promise<{ url: string; name: string } | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
    const name = `${num}_receipt.${ext}`;
    const path = `receipts/${userId}/${name}`;
    const { error } = await supabase.storage.from('invoices').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
    if (error) throw error;
    const { data } = supabase.storage.from('invoices').getPublicUrl(path);
    return { url: data.publicUrl, name };
  } catch (e) {
    console.error('Receipt upload failed', e);
    return null;
  }
}

export async function createExpense(
  userId: string,
  form: { title: string; category: string; description: string; date: string; amount: string; projectId: string | null },
  receiptUri: string | null,
  projects: Project[]
) {
  const num = await nextNum('expense');
  const amt = parseFloat(form.amount) || 0;

  const project = form.projectId ? projects.find((p) => p.id === form.projectId) : null;
  if (project) {
    const remaining = (project.budget ?? 0) - (project.spent ?? 0);
    if (amt > remaining) throw new Error(`Amount ${amt.toLocaleString('en-IN')} exceeds project budget remaining (${remaining.toLocaleString('en-IN')})`);
  }

  const attachment = receiptUri ? await uploadReceipt(userId, num, receiptUri) : null;

  const { error } = await supabase.from('expense_requests').insert({
    expense_number: num, title: form.title, category: form.category, description: form.description || null,
    expense_date: form.date, amount: amt, gst_amount: 0, total_amount: amt,
    project_id: form.projectId || null, requested_by: userId, status: 'submitted',
    attachments: attachment ? [attachment] : [],
  });
  if (error) throw error;

  if (project) {
    await supabase.from('projects').update({ spent: (project.spent ?? 0) + amt }).eq('id', project.id);
  }
}

export async function createTravel(
  userId: string,
  form: { fromLocation: string; toLocation: string; travelDate: string; returnDate: string; purpose: string; mode: string; estimatedCost: string; projectId: string | null },
  projects: Project[]
) {
  const num = await nextNum('travel');
  const cost = form.estimatedCost ? parseFloat(form.estimatedCost) : null;

  const project = form.projectId ? projects.find((p) => p.id === form.projectId) : null;
  if (project && cost) {
    const remaining = (project.budget ?? 0) - (project.spent ?? 0);
    if (cost > remaining) throw new Error(`Estimated cost ${cost.toLocaleString('en-IN')} exceeds project budget remaining (${remaining.toLocaleString('en-IN')})`);
  }

  const { error } = await supabase.from('travel_requests').insert({
    request_number: num, from_location: form.fromLocation, to_location: form.toLocation,
    travel_date: form.travelDate, return_date: form.returnDate || null, purpose: form.purpose,
    travel_mode: form.mode, estimated_cost: cost, project_id: form.projectId || null,
    requested_by: userId, status: 'submitted',
  });
  if (error) throw error;

  if (project && cost) {
    await supabase.from('projects').update({ spent: (project.spent ?? 0) + cost }).eq('id', project.id);
  }
}
