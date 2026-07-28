import { createFileRoute } from '@tanstack/react-router';
import { PerfilLandingPro } from '@/components/landing/PerfilLandingPro';
import {
  KeyRound, UserCircle2, FileSearch, LayoutDashboard, ShieldCheck, FileText,
  Receipt, CalendarClock, FileCheck2, FileSignature, ClipboardList, BadgeCheck,
  Download, Copy, FileSpreadsheet, Building2,
} from 'lucide-react';

export const Route = createFileRoute('/inquilino/')({
  head: () => ({
    meta: [
      { title: 'Inquilino | Acesse faturas e documentos | NOX FianÃ§a' },
      { name: 'description', content: 'Crie seu acesso de inquilino para consultar seguros ativos, documentos, boletos, faturas e vencimentos vinculados ao seu CPF.' },
      { property: 'og:title', content: 'Inquilino | Acesse faturas e documentos | NOX FianÃ§a' },
      { property: 'og:description', content: 'Crie seu acesso de inquilino para consultar seguros ativos, documentos, boletos, faturas e vencimentos vinculados ao seu CPF.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: '/inquilino' },
      { property: 'og:image', content: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1600&auto=format&fit=crop' },
    ],
    links: [{ rel: 'canonical', href: '/inquilino' }],
  }),
  component: InquilinoLanding,
});

function InquilinoLanding() {
  return (
    <PerfilLandingPro
      hideFooterCta

      badge={{ icon: KeyRound, label: 'Para Inquilinos' }}
      hero={{
        titulo: 'Seu contrato sempre Ã  mÃ£o',
        subtitulo: 'Acesse documentos, faturas e informaÃ§Ãµes do seu seguro fianÃ§a vinculados ao seu CPF.',
        imagem: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Inquilino acessando contrato digital pelo celular',
        personagemImagem: '/assets/nox-inquilino-personagens.webp',
        personagemAlt: 'Personagens NOX Fianca apresentando o app do inquilino com faturas, casa e chaves',
        ctas: [
          { label: 'Criar acesso de inquilino', to: '/cadastro-inquilino', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Acesso pelo CPF', 'Documentos online', 'Faturas e boletos'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para o inquilino',
        passos: [
          { icon: UserCircle2, t: 'Crie sua conta com CPF', d: 'FaÃ§a seu cadastro informando seu CPF para iniciar o acesso.' },
          { icon: FileSearch, t: 'O sistema busca seus contratos', d: 'Localizamos automaticamente contratos e seguros vinculados ao seu CPF.' },
          { icon: FileText, t: 'Acesse documentos e faturas', d: 'Visualize contratos, apÃ³lices, vistorias, boletos e faturas no painel.' },
          { icon: CalendarClock, t: 'Acompanhe vencimentos', d: 'Veja parcelas pagas, em aberto, prÃ³ximas e vencidas em tempo real.' },
        ],
      }}
      beneficios={{
        titulo: 'O que vocÃª encontra no painel',
        items: [
          { icon: ShieldCheck, t: 'Seguros ativos', d: 'Veja apÃ³lices, vigÃªncia e o imÃ³vel vinculado a cada contrato.' },
          { icon: FileText, t: 'Documentos', d: 'Contrato, vistoria, apÃ³lice e termo de garantia em um sÃ³ lugar.' },
          { icon: Receipt, t: 'Faturas', d: 'Parcelas, status de pagamento e histÃ³rico do contrato.' },
          { icon: Download, t: 'Boletos', d: 'Baixe boletos e copie a linha digitÃ¡vel quando o pagamento for seu.' },
          { icon: CalendarClock, t: 'PrÃ³ximo vencimento', d: 'Acompanhe a prÃ³xima parcela a vencer com destaque no painel.' },
          { icon: UserCircle2, t: 'Meu perfil', d: 'Mantenha seus dados de contato e cadastrais sempre atualizados.' },
        ],
      }}
      destaque={{
        titulo: 'Documentos disponÃ­veis',
        descricao: 'Conforme o contrato e o tipo de seguro, vocÃª encontra estes documentos no painel.',
        cards: [
          { icon: FileSignature, t: 'Contrato de LocaÃ§Ã£o', d: 'Documento assinado entre as partes, sempre disponÃ­vel para consulta.' },
          { icon: ClipboardList, t: 'Vistoria do ImÃ³vel', d: 'Laudo de entrada com as condiÃ§Ãµes do imÃ³vel.' },
          { icon: ShieldCheck, t: 'ApÃ³lice NOX FianÃ§a', d: 'Documento da garantia locatÃ­cia ativa do seu contrato.' },
          { icon: FileCheck2, t: 'Termo de Garantia', d: 'Termo com as condiÃ§Ãµes e cobertura da garantia contratada.' },
        ],
      }}
      ferramentas={{
        titulo: 'Faturas e boletos',
        subtitulo: 'Acompanhe parcelas, vencimentos e baixe seus boletos quando o pagamento for diretamente seu.',
        cards: [
          { icon: Receipt, t: 'Parcelas', items: ['Pagas', 'Em aberto', 'A vencer', 'Vencidas'] },
          { icon: CalendarClock, t: 'Vencimentos', items: ['PrÃ³ximo vencimento em destaque', 'HistÃ³rico', 'Alertas de parcela vencida'] },
          { icon: Download, t: 'Baixar boleto', items: ['Download em PDF', 'DisponÃ­vel em parcelas em aberto', 'AtualizaÃ§Ã£o automÃ¡tica'] },
          { icon: Copy, t: 'Copiar linha digitÃ¡vel', items: ['CÃ³pia rÃ¡pida', 'Pagamento por internet banking', 'Sem digitar manualmente'] },
          { icon: FileSpreadsheet, t: 'Comprovantes', items: ['Pagamentos registrados', 'Status atualizado', 'HistÃ³rico do contrato'] },
          { icon: Building2, t: 'CobranÃ§a via imobiliÃ¡ria', items: ['Acompanhe status mesmo sem boleto prÃ³prio', 'A imobiliÃ¡ria centraliza a cobranÃ§a'] },
        ],
      }}
      faq={[
        { q: 'Como vejo minhas faturas?', a: 'FaÃ§a login no painel do inquilino e acesse a aba Minhas Faturas para ver parcelas, vencimentos e status.' },
        { q: 'Como baixo meus documentos?', a: 'Na aba Documentos vocÃª visualiza e baixa contratos, vistorias, apÃ³lices e termos vinculados ao seu contrato.' },
        { q: 'O sistema encontra meu contrato pelo CPF?', a: 'Sim. Ao criar a conta, buscamos automaticamente seguros, contratos e documentos vinculados ao seu CPF.' },
        { q: 'E se eu nÃ£o encontrar nenhum contrato?', a: 'Se nÃ£o houver vÃ­nculo, entre em contato com sua imobiliÃ¡ria ou corretor para confirmar o cadastro na NOX.' },
        { q: 'Posso acessar mais de um contrato?', a: 'Sim. Todos os contratos vinculados ao seu CPF aparecem no painel.' },
        { q: 'O que vejo quando o pagamento Ã© via imobiliÃ¡ria?', a: 'Nesse modelo, a imobiliÃ¡ria centraliza as cobranÃ§as. VocÃª acompanha os documentos e o status, sem boleto prÃ³prio.' },
      ]}
      ctaFinal={{
        titulo: 'Crie seu acesso e acompanhe tudo em um sÃ³ lugar',
        subtitulo: 'Tenha visÃ£o completa de seguros ativos, documentos, faturas e boletos vinculados ao seu CPF.',
        ctas: [
          { label: 'Criar acesso de inquilino', to: '/cadastro-inquilino', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
