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
      { title: 'Inquilino | Acesse faturas e documentos | NOX Fiança' },
      { name: 'description', content: 'Crie seu acesso de inquilino para consultar seguros ativos, documentos, boletos, faturas e vencimentos vinculados ao seu CPF.' },
      { property: 'og:title', content: 'Inquilino | Acesse faturas e documentos | NOX Fiança' },
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
        titulo: 'Seu contrato sempre à mão',
        subtitulo: 'Acesse documentos, faturas e informações do seu seguro fiança vinculados ao seu CPF.',
        imagem: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Inquilino acessando contrato digital pelo celular',
        personagemImagem: '/assets/nox-inquilino-personagens.png',
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
          { icon: UserCircle2, t: 'Crie sua conta com CPF', d: 'Faça seu cadastro informando seu CPF para iniciar o acesso.' },
          { icon: FileSearch, t: 'O sistema busca seus contratos', d: 'Localizamos automaticamente contratos e seguros vinculados ao seu CPF.' },
          { icon: FileText, t: 'Acesse documentos e faturas', d: 'Visualize contratos, apólices, vistorias, boletos e faturas no painel.' },
          { icon: CalendarClock, t: 'Acompanhe vencimentos', d: 'Veja parcelas pagas, em aberto, próximas e vencidas em tempo real.' },
        ],
      }}
      beneficios={{
        titulo: 'O que você encontra no painel',
        items: [
          { icon: ShieldCheck, t: 'Seguros ativos', d: 'Veja apólices, vigência e o imóvel vinculado a cada contrato.' },
          { icon: FileText, t: 'Documentos', d: 'Contrato, vistoria, apólice e termo de garantia em um só lugar.' },
          { icon: Receipt, t: 'Faturas', d: 'Parcelas, status de pagamento e histórico do contrato.' },
          { icon: Download, t: 'Boletos', d: 'Baixe boletos e copie a linha digitável quando o pagamento for seu.' },
          { icon: CalendarClock, t: 'Próximo vencimento', d: 'Acompanhe a próxima parcela a vencer com destaque no painel.' },
          { icon: UserCircle2, t: 'Meu perfil', d: 'Mantenha seus dados de contato e cadastrais sempre atualizados.' },
        ],
      }}
      destaque={{
        titulo: 'Documentos disponíveis',
        descricao: 'Conforme o contrato e o tipo de seguro, você encontra estes documentos no painel.',
        cards: [
          { icon: FileSignature, t: 'Contrato de Locação', d: 'Documento assinado entre as partes, sempre disponível para consulta.' },
          { icon: ClipboardList, t: 'Vistoria do Imóvel', d: 'Laudo de entrada com as condições do imóvel.' },
          { icon: ShieldCheck, t: 'Apólice NOX Fiança', d: 'Documento da garantia locatícia ativa do seu contrato.' },
          { icon: FileCheck2, t: 'Termo de Garantia', d: 'Termo com as condições e cobertura da garantia contratada.' },
        ],
      }}
      ferramentas={{
        titulo: 'Faturas e boletos',
        subtitulo: 'Acompanhe parcelas, vencimentos e baixe seus boletos quando o pagamento for diretamente seu.',
        cards: [
          { icon: Receipt, t: 'Parcelas', items: ['Pagas', 'Em aberto', 'A vencer', 'Vencidas'] },
          { icon: CalendarClock, t: 'Vencimentos', items: ['Próximo vencimento em destaque', 'Histórico', 'Alertas de parcela vencida'] },
          { icon: Download, t: 'Baixar boleto', items: ['Download em PDF', 'Disponível em parcelas em aberto', 'Atualização automática'] },
          { icon: Copy, t: 'Copiar linha digitável', items: ['Cópia rápida', 'Pagamento por internet banking', 'Sem digitar manualmente'] },
          { icon: FileSpreadsheet, t: 'Comprovantes', items: ['Pagamentos registrados', 'Status atualizado', 'Histórico do contrato'] },
          { icon: Building2, t: 'Cobrança via imobiliária', items: ['Acompanhe status mesmo sem boleto próprio', 'A imobiliária centraliza a cobrança'] },
        ],
      }}
      faq={[
        { q: 'Como vejo minhas faturas?', a: 'Faça login no painel do inquilino e acesse a aba Minhas Faturas para ver parcelas, vencimentos e status.' },
        { q: 'Como baixo meus documentos?', a: 'Na aba Documentos você visualiza e baixa contratos, vistorias, apólices e termos vinculados ao seu contrato.' },
        { q: 'O sistema encontra meu contrato pelo CPF?', a: 'Sim. Ao criar a conta, buscamos automaticamente seguros, contratos e documentos vinculados ao seu CPF.' },
        { q: 'E se eu não encontrar nenhum contrato?', a: 'Se não houver vínculo, entre em contato com sua imobiliária ou corretor para confirmar o cadastro na NOX.' },
        { q: 'Posso acessar mais de um contrato?', a: 'Sim. Todos os contratos vinculados ao seu CPF aparecem no painel.' },
        { q: 'O que vejo quando o pagamento é via imobiliária?', a: 'Nesse modelo, a imobiliária centraliza as cobranças. Você acompanha os documentos e o status, sem boleto próprio.' },
      ]}
      ctaFinal={{
        titulo: 'Crie seu acesso e acompanhe tudo em um só lugar',
        subtitulo: 'Tenha visão completa de seguros ativos, documentos, faturas e boletos vinculados ao seu CPF.',
        ctas: [
          { label: 'Criar acesso de inquilino', to: '/cadastro-inquilino', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
