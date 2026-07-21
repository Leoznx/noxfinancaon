import { createFileRoute } from '@tanstack/react-router';
import { PerfilLandingPro } from '@/components/landing/PerfilLandingPro';
import {
  Home, ShieldCheck, FileText, Users, FileSignature, ClipboardCheck, Receipt,
  AlertTriangle, BadgeCheck, KeyRound, LayoutDashboard, UserCircle2, ShieldAlert,
  Wallet, Building2,
} from 'lucide-react';

export const Route = createFileRoute('/proprietario')({
  head: () => ({
    meta: [
      { title: 'Proprietários | Proteção para aluguel | NOX Fiança' },
      { name: 'description', content: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imóveis com mais segurança.' },
      { property: 'og:title', content: 'Proprietários | Proteção para aluguel | NOX Fiança' },
      { property: 'og:description', content: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imóveis com mais segurança.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: '/proprietario' },
      { property: 'og:image', content: 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?q=80&w=1600&auto=format&fit=crop' },
    ],
    links: [{ rel: 'canonical', href: '/proprietario' }],
  }),
  component: ProprietarioPage,
});

function ProprietarioPage() {
  return (
    <PerfilLandingPro
      badge={{ icon: Home, label: 'Para Proprietários' }}
      hero={{
        titulo: 'Mais segurança para proteger seu aluguel',
        subtitulo: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imóveis.',
        imagem: 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Proprietário entregando chaves do imóvel',
        personagemImagem: '/assets/nox-proprietario-personagens-x.png',
        personagemAlt: 'Personagens NOX Fianca apresentando painel de pagamento para proprietarios com casa e mesa',
        ctas: [
          { label: 'Criar conta de proprietário', to: '/cadastro-proprietario', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Mais segurança', 'Documentos centralizados', 'Acompanhamento online'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para proprietários',
        passos: [
          { icon: KeyRound, t: 'Crie seu acesso', d: 'Cadastre-se como proprietário para acompanhar seus imóveis e contratos.' },
          { icon: Home, t: 'Vincule seus imóveis', d: 'Veja os contratos e imóveis vinculados ao seu CPF e à sua imobiliária.' },
          { icon: FileText, t: 'Acompanhe documentos', d: 'Tenha acesso aos documentos do contrato, vistoria e garantia.' },
          { icon: Users, t: 'Veja status dos inquilinos', d: 'Confira informações dos inquilinos vinculados aos seus imóveis.' },
          { icon: ShieldCheck, t: 'Acompanhe a garantia', d: 'Veja o status da garantia locatícia ativa em cada contrato.' },
          { icon: LayoutDashboard, t: 'Tudo pelo painel', d: 'Centralize informações dos imóveis em uma única plataforma.' },
        ],
      }}
      beneficios={{
        titulo: 'Benefícios para proprietários',
        items: [
          { icon: ShieldAlert, t: 'Mais segurança contra inadimplência', d: 'A garantia reduz riscos e dá mais previsibilidade ao aluguel.' },
          { icon: FileText, t: 'Documentos centralizados', d: 'Contrato, vistoria e apólice em um só lugar, sempre acessíveis.' },
          { icon: ShieldCheck, t: 'Contratos ativos', d: 'Veja vigência e dados dos contratos vinculados aos seus imóveis.' },
          { icon: Users, t: 'Acompanhamento de inquilinos', d: 'Saiba quem está locando cada imóvel e o status do contrato.' },
          { icon: BadgeCheck, t: 'Menos burocracia', d: 'Processo digital, sem papelada e sem deslocamento.' },
          { icon: ClipboardCheck, t: 'Mais transparência', d: 'Visualize cada etapa do contrato e da garantia com clareza.' },
          { icon: LayoutDashboard, t: 'Controle pelo painel', d: 'Tudo organizado em uma plataforma feita para o proprietário.' },
          { icon: Home, t: 'Vários imóveis', d: 'Acompanhe múltiplos contratos vinculados ao seu cadastro.' },
        ],
      }}
      destaque={{
        titulo: 'Proteção na locação',
        descricao: 'A garantia locatícia ajuda a tornar a locação mais segura, reduzindo riscos e trazendo mais previsibilidade para proprietários.',
        cards: [
          { icon: ShieldCheck, t: 'Garantia ativa', d: 'Cada contrato tem uma garantia vinculada, com vigência clara.' },
          { icon: AlertTriangle, t: 'Menos risco', d: 'Reduza incertezas e proteja a relação entre proprietário, inquilino e imobiliária.' },
          { icon: FileSignature, t: 'Contrato digital', d: 'Documentos organizados e acessíveis sempre que precisar.' },
        ],
      }}
      ferramentas={{
        titulo: 'O que o proprietário acompanha',
        subtitulo: 'Tudo organizado em um painel próprio para o proprietário.',
        cards: [
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['Vigência', 'Imóvel', 'Inquilino', 'Status'] },
          { icon: Users, t: 'Inquilinos vinculados', items: ['Dados básicos', 'Contrato', 'Histórico', 'Status'] },
          { icon: FileText, t: 'Documentos', items: ['Contrato de locação', 'Vistoria', 'Apólice', 'Termo de garantia'] },
          { icon: ShieldAlert, t: 'Status da garantia', items: ['Vigência', 'Apólice', 'Plano contratado', 'Renovações'] },
          { icon: Receipt, t: 'Faturas (quando aplicável)', items: ['Status', 'Histórico', 'Modelo de cobrança'] },
          { icon: AlertTriangle, t: 'Sinistros (quando disponível)', items: ['Abertura', 'Status', 'Documentos', 'Acompanhamento'] },
        ],
      }}
      faq={[
        { q: 'Como acompanho meus contratos?', a: 'Pelo painel do proprietário você visualiza os contratos ativos vinculados aos seus imóveis.' },
        { q: 'Vejo documentos do imóvel?', a: 'Sim. Contrato, vistoria e apólice ficam disponíveis na aba de documentos.' },
        { q: 'Posso acompanhar inquilinos?', a: 'Sim. Você visualiza os inquilinos vinculados a cada contrato ativo.' },
        { q: 'Como a garantia me protege?', a: 'A garantia locatícia ajuda a reduzir riscos e dar mais previsibilidade ao aluguel.' },
        { q: 'Como acesso meu painel?', a: 'Crie sua conta de proprietário e faça login para visualizar tudo o que está vinculado a você.' },
      ]}
      ctaFinal={{
        titulo: 'Acompanhe seus contratos com mais segurança',
        subtitulo: 'Crie sua conta de proprietário e tenha visão completa dos seus imóveis, contratos e garantias.',
        ctas: [
          { label: 'Criar conta de proprietário', to: '/cadastro-proprietario', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
