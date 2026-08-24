import { createFileRoute } from "@tanstack/react-router";

const JOB_TABS = ["vagas", "curriculos"] as const;

export const Route = createFileRoute("/admin/vagas")({
  validateSearch: (search): { tab?: (typeof JOB_TABS)[number] } =>
    JOB_TABS.includes(search.tab as (typeof JOB_TABS)[number])
      ? { tab: search.tab as (typeof JOB_TABS)[number] }
      : {},
});
