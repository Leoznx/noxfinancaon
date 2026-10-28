import { fetchDashboardStats, type DashboardStats } from "@/lib/dashboard-stats";
import { loadSessionResource, peekSessionResource } from "@/lib/session-resource-cache";

const DASHBOARD_CACHE_MAX_AGE_MS = 2 * 60_000;
const dashboardOverviewKey = (userId: string) => `dashboard:overview:${userId}`;

export function peekDashboardOverview(userId: string) {
  return peekSessionResource<DashboardStats>(dashboardOverviewKey(userId));
}

export function loadDashboardOverview(userId: string, force = false) {
  return loadSessionResource(
    dashboardOverviewKey(userId),
    () => fetchDashboardStats(null),
    { force, maxAgeMs: DASHBOARD_CACHE_MAX_AGE_MS },
  );
}
