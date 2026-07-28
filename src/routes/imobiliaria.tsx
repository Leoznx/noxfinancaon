import { createFileRoute } from '@tanstack/react-router';
import { PerfilLandingPro } from '@/components/landing/PerfilLandingPro';
import {
  Building2, UserCircle2, Users, FileSearch, ListChecks, ShieldCheck, Receipt,
  Wallet, BarChart3, LayoutDashboard, Briefcase, FileSignature, TrendingUp,
  CreditCard, Banknote,
} from 'lucide-react';

export const Route = createFileRoute('/imobiliaria')({
  head: () => ({
    meta: [
      { title: 'ImobiliÃ¡rias | GestÃ£o de garantia locatÃ­cia | NOX FianÃ§a' },
      { name: 'description', content: 'Controle corretores, consultas, contratos, faturas e garantias locatÃ­cias em um painel completo para imobiliÃ¡rias.' },
      { property: 'og:title', content: 'ImobiliÃ¡rias | GestÃ£o de garantia locatÃ­cia | NOX FianÃ§a' },
      { property: 'og:description', content: 'Controle corretores, consultas, contratos, faturas e garantias locatÃ­cias em um painel completo para imobiliÃ¡rias.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: '/imobiliaria' },
      { property: 'og:image', content: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1600&auto=format&fit=crop' },
    ],
    links: [{ rel: 'canonical', href: '/imobiliaria' }],
  }),
  component: ImobiliariaPage,
});

function ImobiliariaPage() {
  return (
    <PerfilLandingPro
      badge={{ icon: Building2, label: 'Para ImobiliÃ¡rias' }}
      hero={{
        titulo: 'GestÃ£o de garantias para imobiliÃ¡rias que querem escalar locaÃ§Ãµes',
        subtitulo: 'Controle corretores, consultas, contratos, faturas e garantias locatÃ­cias em um painel completo.',
        imagem: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Equipe de imobiliÃ¡ria trabalhando em escritÃ³rio moderno',
        personagemImagem: '/assets/nox-imobiliaria-personagens-crop.webp',
        personagemAlt: 'Personagens NOX Fianca apresentando painel para imobiliarias com predio e tablet',
        ocultarBadge: true,
        chipsCentralizados: true,
        ctas: [
          { label: 'Cadastrar imobiliÃ¡ria', to: '/cadastro-imobiliaria', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Equipe centralizada', 'Faturamento organizado', 'Mais controle financeiro'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para imobiliÃ¡rias',
        passos: [
          { icon: Building2, t: 'Cadastre sua imobiliÃ¡ria', d: 'Crie a conta da imobiliÃ¡ria e configure os dados da empresa.' },
          { icon: Users, t: 'Vincule corretores', d: 'Convide e vincule corretores por e-mail ou CPF para centralizar a operaÃ§Ã£o.' },
          { icon: FileSearch, t: 'Acompanhe consultas', d: 'Visualize as consultas enviadas pelos corretores em tempo real.' },
          { icon: ShieldCheck, t: 'Gerencie contratos ativos', d: 'Tenha visÃ£o centralizada de contratos ativos, vigÃªncias e imÃ³veis.' },
          { icon: CreditCard, t: 'Escolha o modelo de cobranÃ§a', d: 'Defina se a cobranÃ§a serÃ¡ via imobiliÃ¡ria ou direto com o inquilino.' },
          { icon: BarChart3, t: 'Acompanhe o faturamento', d: 'Veja receitas, repasses e indicadores no painel financeiro da empresa.' },
        ],
      }}
      beneficios={{
        titulo: 'BenefÃ­cios para imobiliÃ¡rias',
        items: [
          { icon: Users, t: 'GestÃ£o de corretores', d: 'Acompanhe a produÃ§Ã£o de cada corretor vinculado Ã  sua imobiliÃ¡ria.' },
          { icon: ShieldCheck, t: 'Contratos centralizados', d: 'Todos os contratos ativos em uma sÃ³ visÃ£o, fÃ¡cil de acompanhar.' },
          { icon: Receipt, t: 'Faturamento organizado', d: 'Visualize receitas e cobranÃ§as vinculadas Ã  imobiliÃ¡ria com clareza.' },
          { icon: CreditCard, t: 'CobranÃ§a via imobiliÃ¡ria', d: 'Modelo onde a imobiliÃ¡ria centraliza as cobranÃ§as recorrentes.' },
          { icon: UserCircle2, t: 'CobranÃ§a via inquilino', d: 'Modelo onde o inquilino paga direto a NOX, com status acompanhado pela imobiliÃ¡ria.' },
          { icon: BarChart3, t: 'RelatÃ³rios de equipe', d: 'Indicadores de produÃ§Ã£o, conversÃ£o e contratos ativados por corretor.' },
          { icon: Wallet, t: 'Mais controle financeiro', d: 'Acompanhe comissÃµes da empresa de forma separada da carreira individual.' },
          { icon: TrendingUp, t: 'Mais seguranÃ§a para locaÃ§Ãµes', d: 'Reduza inadimplÃªncia e ofereÃ§a garantias profissionais para sua carteira.' },
        ],
      }}
      destaque={{
        titulo: 'Modelos de cobranÃ§a',
        descricao: 'Escolha como cada contrato serÃ¡ cobrado e acompanhe tudo pelo painel.',
        cards: [
          { icon: Building2, t: 'Pagamento via ImobiliÃ¡ria', d: 'A imobiliÃ¡ria centraliza as cobranÃ§as recorrentes e acompanha todos os contratos ativos.' },
          { icon: UserCircle2, t: 'Pagamento via Inquilino', d: 'O inquilino paga diretamente a NOX, enquanto a imobiliÃ¡ria acompanha o status do contrato.' },
          { icon: Banknote, t: 'Repasses transparentes', d: 'Veja o histÃ³rico de receitas, repasses e taxas vinculadas a cada contrato.' },
        ],
      }}
      ferramentas={{
        titulo: 'Tudo no painel da imobiliÃ¡ria',
        subtitulo: 'Centralize operaÃ§Ã£o comercial, contratos e financeiro em um sÃ³ lugar.',
        cards: [
          { icon: FileSearch, t: 'Nova consulta', items: ['Dados do imÃ³vel', 'Dados do inquilino', 'Documentos', 'VinculaÃ§Ã£o ao corretor'] },
          { icon: ListChecks, t: 'Minhas consultas', items: ['HistÃ³rico geral', 'Status', 'AprovaÃ§Ãµes', 'Documentos'] },
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['VigÃªncia', 'ImÃ³vel', 'Inquilino', 'Plano contratado'] },
          { icon: Users, t: 'Meus corretores', items: ['VÃ­nculo por CPF ou e-mail', 'ProduÃ§Ã£o individual', 'HistÃ³rico', 'Status'] },
          { icon: Receipt, t: 'Faturamento', items: ['Faturas', 'Repasses', 'Modelos de cobranÃ§a', 'Status de pagamento'] },
          { icon: Wallet, t: 'ComissÃµes', items: ['ComissÃ£o da empresa', 'Acompanhamento separado', 'HistÃ³rico', 'RelatÃ³rios'] },
          { icon: Briefcase, t: 'Perfil empresa', items: ['Dados cadastrais', 'ResponsÃ¡veis', 'Documentos', 'ConfiguraÃ§Ãµes'] },
        ],
      }}
      faq={[
        { q: 'Posso vincular corretores?', a: 'Sim. O vÃ­nculo Ã© feito por e-mail ou CPF, mantendo a produÃ§Ã£o individual de cada corretor.' },
        { q: 'Como funciona cobranÃ§a via imobiliÃ¡ria?', a: 'A imobiliÃ¡ria centraliza as cobranÃ§as recorrentes dos contratos ativos vinculados a ela.' },
        { q: 'Como acompanho contratos?', a: 'Pelo menu de contratos ativos Ã© possÃ­vel ver vigÃªncia, imÃ³vel, inquilino e plano contratado.' },
        { q: 'A comissÃ£o dos corretores mistura com a imobiliÃ¡ria?', a: 'NÃ£o. A comissÃ£o da empresa Ã© acompanhada separadamente do plano de carreira individual dos corretores.' },
        { q: 'Posso ver faturas dos contratos?', a: 'Sim. A Ã¡rea de faturamento mostra faturas, repasses e o status de pagamento.' },
      ]}
      ctaFinal={{
        titulo: 'Leve sua imobiliÃ¡ria para uma gestÃ£o digital de garantias',
        subtitulo: 'Cadastre sua imobiliÃ¡ria e centralize corretores, contratos e faturamento em um sÃ³ painel.',
        ctas: [
          { label: 'Cadastrar imobiliÃ¡ria', to: '/cadastro-imobiliaria', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
