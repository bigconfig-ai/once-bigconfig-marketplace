import type { PackageRecord } from './pb';

export const LANGUAGE_OPTIONS = [
  { slug: 'typescript', label: 'TypeScript' },
  { slug: 'python', label: 'Python' },
  { slug: 'clojure', label: 'Clojure' },
] as const;

export type PackageLanguage = (typeof LANGUAGE_OPTIONS)[number]['slug'];

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.map((language) => [language.slug, language.label])
);

export interface PackageLanguageEntry {
  language: string;
  label: string;
  branch: string;
}

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

export function packageLanguageBranches(
  pkg: Pick<PackageRecord, 'language_branches' | 'languages'> | Record<string, any>
): Record<string, string> {
  const raw = pkg?.language_branches;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const branches: Record<string, string> = {};
  for (const [language, branch] of Object.entries(raw)) {
    if (typeof branch === 'string' && branch.trim()) {
      branches[language] = branch.trim();
    }
  }
  return branches;
}

export function packageLanguages(
  pkg: Pick<PackageRecord, 'language_branches' | 'languages'> | Record<string, any>
): string[] {
  if (Array.isArray(pkg?.languages) && pkg.languages.length > 0) {
    return pkg.languages.filter((language: unknown): language is string => typeof language === 'string');
  }
  return Object.keys(packageLanguageBranches(pkg));
}

export function packageLanguageEntries(
  pkg: Pick<PackageRecord, 'language_branches' | 'languages'> | Record<string, any>
): PackageLanguageEntry[] {
  const branches = packageLanguageBranches(pkg);
  const languages = packageLanguages(pkg);
  const known = LANGUAGE_OPTIONS.flatMap((option) => {
    const branch = branches[option.slug];
    return languages.includes(option.slug) && branch
      ? [{ language: option.slug, label: option.label, branch }]
      : [];
  });
  const knownSet = new Set(known.map((entry) => entry.language));
  const unknown = languages.flatMap((language) => {
    const branch = branches[language];
    return !knownSet.has(language) && branch
      ? [{ language, label: languageLabel(language), branch }]
      : [];
  });
  return [...known, ...unknown];
}
