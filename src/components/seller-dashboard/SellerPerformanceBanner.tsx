export function SellerPerformanceBanner() {
  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-7 lg:px-6 xl:h-full xl:min-h-0 xl:px-5 xl:py-0">
      <div className="relative flex min-h-[108px] flex-col items-center justify-center gap-5 xl:h-full xl:min-h-0">
        <div className="flex w-full items-center justify-center xl:absolute xl:inset-y-0 xl:left-0 xl:w-[34%]">
          <img
            src="/dashboard/seller-performance-art.png"
            alt="Arte NOX Fiança com casa, escudo e chave"
            className="mx-auto h-auto max-h-[170px] w-full max-w-[720px] min-w-0 object-contain object-center xl:h-[112px] xl:max-h-[112px] xl:max-w-[460px]"
          />
        </div>

        <p
          className="mx-auto w-full max-w-[820px] px-3 text-center text-2xl font-black uppercase leading-[1.05] tracking-[0.045em] text-neutral-950 sm:text-[30px] xl:absolute xl:left-1/2 xl:top-1/2 xl:w-[58%] xl:max-w-none xl:-translate-x-1/2 xl:-translate-y-1/2 xl:whitespace-nowrap xl:px-2 xl:text-[clamp(32px,2.25vw,40px)]"
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
