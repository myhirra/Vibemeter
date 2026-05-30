// Pure cost-attribution logic — no DB import, so it's unit-testable directly
// under `node --test`. The DB query that produces the contributions lives in
// stats.ts (`costByProject`), which imports the fold from here.
//
// "Where did my cost go?" — the question a single total or a top-5-sessions
// list can't answer. This groups API-equivalent spend by project.

export interface ProjectCost {
  project: string;
  claudeUsd: number;
  codexUsd: number;
  totalUsd: number;
  sessions: number;
}

/** One session's cost contribution before grouping. `project` is already a
 * basename (or a redacted label); cost fields are USD. */
export interface ProjectCostContribution {
  project: string;
  claudeUsd: number;
  codexUsd: number;
}

/**
 * Merge per-session contributions into per-project totals, sorted by total
 * spend descending. Blank project names collapse into a single `—` bucket.
 */
export function groupCostByProject(rows: ProjectCostContribution[]): ProjectCost[] {
  const byProject = new Map<string, ProjectCost>();
  for (const r of rows) {
    const project = r.project.trim() || '—';
    const cur = byProject.get(project) ?? {
      project,
      claudeUsd: 0,
      codexUsd: 0,
      totalUsd: 0,
      sessions: 0,
    };
    cur.claudeUsd += r.claudeUsd;
    cur.codexUsd += r.codexUsd;
    cur.totalUsd += r.claudeUsd + r.codexUsd;
    cur.sessions += 1;
    byProject.set(project, cur);
  }
  return [...byProject.values()]
    .map((p) => ({
      ...p,
      claudeUsd: Math.round(p.claudeUsd * 100) / 100,
      codexUsd: Math.round(p.codexUsd * 100) / 100,
      totalUsd: Math.round(p.totalUsd * 100) / 100,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}
