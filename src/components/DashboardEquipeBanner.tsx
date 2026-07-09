// Peça de arte pronta — não recriar isso em CSS. Só visual por enquanto (a
// funcionalidade de convite de equipe sem senha ainda não existe).
export function DashboardEquipeBanner() {
  return (
    <img
      src="/dashboard/banner-equipe.png"
      alt="Você no controle — gerencie quem acessa sua dashboard. Sem senha. Sem risco."
      className="w-full h-auto rounded-2xl"
    />
  );
}
