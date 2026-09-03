export function SellerPerformanceBanner() {
  return (
    <section className="relative min-h-[132px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-3 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:min-h-[150px] sm:px-6 sm:py-4 xl:h-full xl:min-h-0 xl:px-5 xl:py-0">
      <div className="relative grid min-h-[106px] grid-cols-[minmax(0,1.08fr)_minmax(128px,0.92fr)] items-center gap-2 sm:min-h-[116px] sm:grid-cols-[minmax(0,1fr)_minmax(210px,1fr)] sm:gap-5 xl:block xl:h-full xl:min-h-0">
        <div className="flex min-w-0 items-center justify-center xl:absolute xl:inset-y-0 xl:left-0 xl:w-[34%]">
          <img
            src="/dashboard/seller-performance-art.png"
            alt="Arte NOX Fiança com casa, escudo e chave"
            className="mx-auto h-auto max-h-[106px] w-full min-w-0 object-contain object-center sm:max-h-[130px] xl:h-[112px] xl:max-h-[112px] xl:max-w-[460px]"
          />
        </div>

        <p
          className="min-w-0 text-center text-[clamp(17px,5vw,23px)] font-black uppercase leading-[1.02] tracking-[0.025em] text-neutral-950 sm:text-[28px] xl:absolute xl:left-1/2 xl:top-1/2 xl:w-[58%] xl:max-w-none xl:-translate-x-1/2 xl:-translate-y-1/2 xl:whitespace-nowrap xl:px-2 xl:text-[clamp(32px,2.25vw,40px)]"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          A proteção que{" "}
          <span className="underline decoration-yellow-400 decoration-[3px] underline-offset-[7px]">
            não
          </span>{" "}
          dorme
        </p>
      </div>
    </section>
  );
}
