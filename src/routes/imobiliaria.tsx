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
      { title: 'Imobiliárias | Gestão de garantia locatícia | NOX Fiança' },
      { name: 'description', content: 'Controle corretores, consultas, contratos, faturas e garantias locatícias em um painel completo para imobiliárias.' },
      { property: 'og:title', content: 'Imobiliárias | Gestão de garantia locatícia | NOX Fiança' },
      { property: 'og:description', content: 'Controle corretores, consultas, contratos, faturas e garantias locatícias em um painel completo para imobiliárias.' },
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
      badge={{ icon: Building2, label: 'Para Imobiliárias' }}
      hero={{
        titulo: 'Gestão de garantias para imobiliárias que querem escalar locações',
        subtitulo: 'Controle corretores, consultas, contratos, faturas e garantias locatícias em um painel completo.',
        imagem: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Equipe de imobiliária trabalhando em escritório moderno',
        personagemImagem: '/assets/nox-imobiliaria-personagens-crop.png',
        personagemAlt: 'Personagens NOX Fianca apresentando painel para imobiliarias com predio e tablet',
        ocultarBadge: true,
        chipsCentralizados: true,
        ctas: [
          { label: 'Cadastrar imobiliária', to: '/cadastro-imobiliaria', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Equipe centralizada', 'Faturamento organizado', 'Mais controle financeiro'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para imobiliárias',
        passos: [
          { icon: Building2, t: 'Cadastre sua imobiliária', d: 'Crie a conta da imobiliária e configure os dados da empresa.' },
          { icon: Users, t: 'Vincule corretores', d: 'Convide e vincule corretores por e-mail ou CPF para centralizar a operação.' },
          { icon: FileSearch, t: 'Acompanhe consultas', d: 'Visualize as consultas enviadas pelos corretores em tempo real.' },
          { icon: ShieldCheck, t: 'Gerencie contratos ativos', d: 'Tenha visão centralizada de contratos ativos, vigências e imóveis.' },
          { icon: CreditCard, t: 'Escolha o modelo de cobrança', d: 'Defina se a cobrança será via imobiliária ou direto com o inquilino.' },
          { icon: BarChart3, t: 'Acompanhe o faturamento', d: 'Veja receitas, repasses e indicadores no painel financeiro da empresa.' },
        ],
      }}
      beneficios={{
        titulo: 'Benefícios para imobiliárias',
        items: [
          { icon: Users, t: 'Gestão de corretores', d: 'Acompanhe a produção de cada corretor vinculado à sua imobiliária.' },
          { icon: ShieldCheck, t: 'Contratos centralizados', d: 'Todos os contratos ativos em uma só visão, fácil de acompanhar.' },
          { icon: Receipt, t: 'Faturamento organizado', d: 'Visualize receitas e cobranças vinculadas à imobiliária com clareza.' },
          { icon: CreditCard, t: 'Cobrança via imobiliária', d: 'Modelo onde a imobiliária centraliza as cobranças recorrentes.' },
          { icon: UserCircle2, t: 'Cobrança via inquilino', d: 'Modelo onde o inquilino paga direto a NOX, com status acompanhado pela imobiliária.' },
          { icon: BarChart3, t: 'Relatórios de equipe', d: 'Indicadores de produção, conversão e contratos ativados por corretor.' },
          { icon: Wallet, t: 'Mais controle financeiro', d: 'Acompanhe comissões da empresa de forma separada da carreira individual.' },
          { icon: TrendingUp, t: 'Mais segurança para locações', d: 'Reduza inadimplência e ofereça garantias profissionais para sua carteira.' },
        ],
      }}
      destaque={{
        titulo: 'Modelos de cobrança',
        descricao: 'Escolha como cada contrato será cobrado e acompanhe tudo pelo painel.',
        cards: [
          { icon: Building2, t: 'Pagamento via Imobiliária', d: 'A imobiliária centraliza as cobranças recorrentes e acompanha todos os contratos ativos.' },
          { icon: UserCircle2, t: 'Pagamento via Inquilino', d: 'O inquilino paga diretamente a NOX, enquanto a imobiliária acompanha o status do contrato.' },
          { icon: Banknote, t: 'Repasses transparentes', d: 'Veja o histórico de receitas, repasses e taxas vinculadas a cada contrato.' },
        ],
      }}
      ferramentas={{
        titulo: 'Tudo no painel da imobiliária',
        subtitulo: 'Centralize operação comercial, contratos e financeiro em um só lugar.',
        cards: [
          { icon: FileSearch, t: 'Nova consulta', items: ['Dados do imóvel', 'Dados do inquilino', 'Documentos', 'Vinculação ao corretor'] },
          { icon: ListChecks, t: 'Minhas consultas', items: ['Histórico geral', 'Status', 'Aprovações', 'Documentos'] },
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['Vigência', 'Imóvel', 'Inquilino', 'Plano contratado'] },
          { icon: Users, t: 'Meus corretores', items: ['Vínculo por CPF ou e-mail', 'Produção individual', 'Histórico', 'Status'] },
          { icon: Receipt, t: 'Faturamento', items: ['Faturas', 'Repasses', 'Modelos de cobrança', 'Status de pagamento'] },
          { icon: Wallet, t: 'Comissões', items: ['Comissão da empresa', 'Acompanhamento separado', 'Histórico', 'Relatórios'] },
          { icon: Briefcase, t: 'Perfil empresa', items: ['Dados cadastrais', 'Responsáveis', 'Documentos', 'Configurações'] },
        ],
      }}
      faq={[
        { q: 'Posso vincular corretores?', a: 'Sim. O vínculo é feito por e-mail ou CPF, mantendo a produção individual de cada corretor.' },
        { q: 'Como funciona cobrança via imobiliária?', a: 'A imobiliária centraliza as cobranças recorrentes dos contratos ativos vinculados a ela.' },
        { q: 'Como acompanho contratos?', a: 'Pelo menu de contratos ativos é possível ver vigência, imóvel, inquilino e plano contratado.' },
        { q: 'A comissão dos corretores mistura com a imobiliária?', a: 'Não. A comissão da empresa é acompanhada separadamente do plano de carreira individual dos corretores.' },
        { q: 'Posso ver faturas dos contratos?', a: 'Sim. A área de faturamento mostra faturas, repasses e o status de pagamento.' },
      ]}
      ctaFinal={{
        titulo: 'Leve sua imobiliária para uma gestão digital de garantias',
        subtitulo: 'Cadastre sua imobiliária e centralize corretores, contratos e faturamento em um só painel.',
        ctas: [
          { label: 'Cadastrar imobiliária', to: '/cadastro-imobiliaria', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
