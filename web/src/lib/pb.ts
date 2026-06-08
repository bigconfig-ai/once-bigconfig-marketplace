import PocketBase, { type RecordModel } from 'pocketbase';

const url = import.meta.env.PUBLIC_PB_URL ?? '';

export const pb = new PocketBase(url);

const FIELD_LABELS: Record<string, string> = {
  tags: 'Tags',
  github_url: 'GitHub URL',
  description: 'Description',
  docker_image: 'Docker image',
  languages: 'Languages',
  language_branches: 'Language branches',
};

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

export function formatPbError(err: any, fallback = 'Request failed.'): string {
  const fields = err?.data?.data;
  if (fields && typeof fields === 'object') {
    const parts: string[] = [];
    for (const [field, info] of Object.entries(fields as Record<string, { code?: string; message?: string }>)) {
      const label = FIELD_LABELS[field] ?? field;
      if (info?.code === 'validation_too_many_values') {
        parts.push(`${label}: too many values selected (max 10).`);
      } else if (info?.message) {
        parts.push(`${label}: ${info.message}`);
      }
    }
    if (parts.length) return parts.join(' ');
  }
  return err?.message || fallback;
}

export interface ApplicationRecord extends PackageRecord {
  docker_image: string;
}

export interface PackageRecord extends RecordModel {
  github_url: string;
  name: string;
  description: string;
  tags: string[];
  languages?: string[];
  language_branches?: Record<string, string> | null;
  submitter: string;
  status: 'pending' | 'approved' | 'rejected';
  stars: number;
  default_branch: string;
  pushed_at: string;
  og_image: string;
  expand?: {
    submitter?: { id: string; name: string; avatar: string };
  };
}
