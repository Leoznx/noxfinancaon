import { Skeleton } from "@/components/ui/skeleton";

export function CommissionsSkeleton() {
  return (
    <div className="space-y-5" aria-label="Carregando dados de comissões" aria-busy="true">
      <div className="grid min-h-[280px] gap-6 rounded-[18px] border border-[#F3E39A] bg-[#FFFDF5] p-6 xl:grid-cols-[minmax(0,1fr)_385px]">
        <div className="space-y-5 py-2">
          <div className="flex gap-3"><Skeleton className="h-8 w-32 rounded-full" /><Skeleton className="h-8 w-56 rounded-full" /></div>
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="grid grid-cols-3 gap-6"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        </div>
        <Skeleton className="min-h-[218px] rounded-[22px] bg-neutral-900/90" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[98px] rounded-2xl" />)}
      </div>
      <div className="rounded-[18px] border border-[#E9E9E9] bg-white p-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-4 h-[150px] w-full rounded-2xl" />
      </div>
    </div>
  );
}
