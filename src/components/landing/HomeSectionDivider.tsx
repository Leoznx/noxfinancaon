export const HomeSectionDivider = () => (
  <div
    role="separator"
    aria-orientation="horizontal"
    className="pointer-events-none relative z-10 mx-auto h-px w-[calc(100%_-_2.5rem)] max-w-7xl"
  >
    <div className="absolute left-1/2 top-1/2 h-3 w-2/3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FACC15]/15 blur-md" />
    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FACC15] to-transparent opacity-90" />
  </div>
);
