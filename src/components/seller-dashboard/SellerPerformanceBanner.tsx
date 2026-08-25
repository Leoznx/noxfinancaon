export function SellerPerformanceBanner() {
  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-2xl border border-neutral-200 bg-[linear-gradient(100deg,#fff7d6_0%,#ffffff_48%,#fffcef_100%)] px-5 py-4 shadow-[0_1px_4px_rgba(0,0,0,0.03)] sm:px-7 lg:px-6 xl:h-full xl:min-h-0 xl:px-5 xl:py-2.5">
      <div className="relative grid min-h-[108px] items-center gap-5 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(440px,0.95fr)_minmax(560px,1.25fr)] xl:gap-4">
        <img
          src="/dashboard/seller-performance-art.png"
          alt="Arte NOX Fiança com casa, escudo e chave"
          className="mx-auto h-auto max-h-[170px] w-full max-w-[720px] min-w-0 object-contain object-center xl:max-h-[145px] xl:max-w-[620px] xl:object-left"
        />

        <p
          className="mx-auto w-full max-w-[820px] px-3 text-center text-2xl font-black uppercase leading-[1.05] tracking-[0.045em] text-neutral-950 sm:text-[30px] xl:max-w-none xl:whitespace-nowrap xl:px-2 xl:text-[clamp(32px,2.25vw,40px)]"
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
