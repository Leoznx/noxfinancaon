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
      { title: 'ProprietÃ¡rios | ProteÃ§Ã£o para aluguel | NOX FianÃ§a' },
      { name: 'description', content: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imÃ³veis com mais seguranÃ§a.' },
      { property: 'og:title', content: 'ProprietÃ¡rios | ProteÃ§Ã£o para aluguel | NOX FianÃ§a' },
      { property: 'og:description', content: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imÃ³veis com mais seguranÃ§a.' },
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
      badge={{ icon: Home, label: 'Para ProprietÃ¡rios' }}
      hero={{
        titulo: 'Mais seguranÃ§a para proteger seu aluguel',
        subtitulo: 'Acompanhe contratos, documentos, inquilinos e garantias vinculadas aos seus imÃ³veis.',
        imagem: 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'ProprietÃ¡rio entregando chaves do imÃ³vel',
        personagemImagem: '/assets/nox-proprietario-personagens-x.webp',
        personagemAlt: 'Personagens NOX Fianca apresentando painel de pagamento para proprietarios com casa e mesa',
        ctas: [
          { label: 'Criar conta de proprietÃ¡rio', to: '/cadastro-proprietario', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Mais seguranÃ§a', 'Documentos centralizados', 'Acompanhamento online'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para proprietÃ¡rios',
        passos: [
          { icon: KeyRound, t: 'Crie seu acesso', d: 'Cadastre-se como proprietÃ¡rio para acompanhar seus imÃ³veis e contratos.' },
          { icon: Home, t: 'Vincule seus imÃ³veis', d: 'Veja os contratos e imÃ³veis vinculados ao seu CPF e Ã  sua imobiliÃ¡ria.' },
          { icon: FileText, t: 'Acompanhe documentos', d: 'Tenha acesso aos documentos do contrato, vistoria e garantia.' },
          { icon: Users, t: 'Veja status dos inquilinos', d: 'Confira informaÃ§Ãµes dos inquilinos vinculados aos seus imÃ³veis.' },
          { icon: ShieldCheck, t: 'Acompanhe a garantia', d: 'Veja o status da garantia locatÃ­cia ativa em cada contrato.' },
          { icon: LayoutDashboard, t: 'Tudo pelo painel', d: 'Centralize informaÃ§Ãµes dos imÃ³veis em uma Ãºnica plataforma.' },
        ],
      }}
      beneficios={{
        titulo: 'BenefÃ­cios para proprietÃ¡rios',
        items: [
          { icon: ShieldAlert, t: 'Mais seguranÃ§a contra inadimplÃªncia', d: 'A garantia reduz riscos e dÃ¡ mais previsibilidade ao aluguel.' },
          { icon: FileText, t: 'Documentos centralizados', d: 'Contrato, vistoria e apÃ³lice em um sÃ³ lugar, sempre acessÃ­veis.' },
          { icon: ShieldCheck, t: 'Contratos ativos', d: 'Veja vigÃªncia e dados dos contratos vinculados aos seus imÃ³veis.' },
          { icon: Users, t: 'Acompanhamento de inquilinos', d: 'Saiba quem estÃ¡ locando cada imÃ³vel e o status do contrato.' },
          { icon: BadgeCheck, t: 'Menos burocracia', d: 'Processo digital, sem papelada e sem deslocamento.' },
          { icon: ClipboardCheck, t: 'Mais transparÃªncia', d: 'Visualize cada etapa do contrato e da garantia com clareza.' },
          { icon: LayoutDashboard, t: 'Controle pelo painel', d: 'Tudo organizado em uma plataforma feita para o proprietÃ¡rio.' },
          { icon: Home, t: 'VÃ¡rios imÃ³veis', d: 'Acompanhe mÃºltiplos contratos vinculados ao seu cadastro.' },
        ],
      }}
      destaque={{
        titulo: 'ProteÃ§Ã£o na locaÃ§Ã£o',
        descricao: 'A garantia locatÃ­cia ajuda a tornar a locaÃ§Ã£o mais segura, reduzindo riscos e trazendo mais previsibilidade para proprietÃ¡rios.',
        cards: [
          { icon: ShieldCheck, t: 'Garantia ativa', d: 'Cada contrato tem uma garantia vinculada, com vigÃªncia clara.' },
          { icon: AlertTriangle, t: 'Menos risco', d: 'Reduza incertezas e proteja a relaÃ§Ã£o entre proprietÃ¡rio, inquilino e imobiliÃ¡ria.' },
          { icon: FileSignature, t: 'Contrato digital', d: 'Documentos organizados e acessÃ­veis sempre que precisar.' },
        ],
      }}
      ferramentas={{
        titulo: 'O que o proprietÃ¡rio acompanha',
        subtitulo: 'Tudo organizado em um painel prÃ³prio para o proprietÃ¡rio.',
        cards: [
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['VigÃªncia', 'ImÃ³vel', 'Inquilino', 'Status'] },
          { icon: Users, t: 'Inquilinos vinculados', items: ['Dados bÃ¡sicos', 'Contrato', 'HistÃ³rico', 'Status'] },
          { icon: FileText, t: 'Documentos', items: ['Contrato de locaÃ§Ã£o', 'Vistoria', 'ApÃ³lice', 'Termo de garantia'] },
          { icon: ShieldAlert, t: 'Status da garantia', items: ['VigÃªncia', 'ApÃ³lice', 'Plano contratado', 'RenovaÃ§Ãµes'] },
          { icon: Receipt, t: 'Faturas (quando aplicÃ¡vel)', items: ['Status', 'HistÃ³rico', 'Modelo de cobranÃ§a'] },
          { icon: AlertTriangle, t: 'Sinistros (quando disponÃ­vel)', items: ['Abertura', 'Status', 'Documentos', 'Acompanhamento'] },
        ],
      }}
      faq={[
        { q: 'Como acompanho meus contratos?', a: 'Pelo painel do proprietÃ¡rio vocÃª visualiza os contratos ativos vinculados aos seus imÃ³veis.' },
        { q: 'Vejo documentos do imÃ³vel?', a: 'Sim. Contrato, vistoria e apÃ³lice ficam disponÃ­veis na aba de documentos.' },
        { q: 'Posso acompanhar inquilinos?', a: 'Sim. VocÃª visualiza os inquilinos vinculados a cada contrato ativo.' },
        { q: 'Como a garantia me protege?', a: 'A garantia locatÃ­cia ajuda a reduzir riscos e dar mais previsibilidade ao aluguel.' },
        { q: 'Como acesso meu painel?', a: 'Crie sua conta de proprietÃ¡rio e faÃ§a login para visualizar tudo o que estÃ¡ vinculado a vocÃª.' },
      ]}
      ctaFinal={{
        titulo: 'Acompanhe seus contratos com mais seguranÃ§a',
        subtitulo: 'Crie sua conta de proprietÃ¡rio e tenha visÃ£o completa dos seus imÃ³veis, contratos e garantias.',
        ctas: [
          { label: 'Criar conta de proprietÃ¡rio', to: '/cadastro-proprietario', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
