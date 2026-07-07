import { createFileRoute } from '@tanstack/react-router';
import { PerfilLandingPro } from '@/components/landing/PerfilLandingPro';
import {
  UserRound, FileSearch, FileUp, ListChecks, ClipboardCheck, Wallet, Trophy,
  TrendingUp, Zap, BarChart3, Users, Sparkles, Headphones, Share2,
  LayoutDashboard, FileSignature, UserCircle2, ShieldCheck, Receipt,
} from 'lucide-react';

export const Route = createFileRoute('/corretor')({
  head: () => ({
    meta: [
      { title: 'Corretores | Venda mais com garantia locatícia | NOX Fiança' },
      { name: 'description', content: 'Simule garantias, envie propostas, acompanhe contratos e receba comissões em uma plataforma feita para corretores.' },
      { property: 'og:title', content: 'Corretores | Venda mais com garantia locatícia | NOX Fiança' },
      { property: 'og:description', content: 'Simule garantias, envie propostas, acompanhe contratos e receba comissões em uma plataforma feita para corretores.' },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: '/corretor' },
      { property: 'og:image', content: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1600&auto=format&fit=crop' },
    ],
    links: [{ rel: 'canonical', href: '/corretor' }],
  }),
  component: CorretorPage,
});

function CorretorPage() {
  return (
    <PerfilLandingPro
      badge={{ icon: UserRound, label: 'Para Corretores' }}
      hero={{
        titulo: 'Venda mais locações com a NOX Fiança',
        subtitulo: 'Simule garantias, envie propostas, acompanhe contratos e receba comissões em uma plataforma feita para corretores.',
        imagem: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Corretor atendendo cliente em escritório imobiliário',
        ctas: [
          { label: 'Criar conta de corretor', to: '/cadastro', search: { perfil: 'corretor' }, variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['Aprovação rápida', 'Comissão por contrato', 'Plano de carreira'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para corretores',
        passos: [
          { icon: FileSearch, t: 'Simule a fiança', d: 'Inicie uma consulta com os dados do inquilino e do imóvel em poucos minutos.' },
          { icon: FileUp, t: 'Envie os documentos', d: 'Anexe contrato, vistoria e documentos exigidos diretamente pelo painel.' },
          { icon: ClipboardCheck, t: 'Acompanhe a aprovação', d: 'Veja o status da análise em tempo real, com retorno ágil sobre a proposta.' },
          { icon: ListChecks, t: 'Escolha o plano', d: 'Defina junto ao cliente o melhor plano de garantia disponível para o imóvel.' },
          { icon: FileSignature, t: 'Finalize a proposta', d: 'Conclua a contratação digital, deixe o contrato ativo e pronto para locação.' },
          { icon: Wallet, t: 'Receba sua comissão', d: 'Acompanhe pagamentos e comissões diretamente pelo painel financeiro.' },
        ],
      }}
      beneficios={{
        titulo: 'Benefícios para corretores',
        items: [
          { icon: Zap, t: 'Mais agilidade nas locações', d: 'Reduza o tempo entre a visita e o fechamento do contrato.' },
          { icon: Wallet, t: 'Comissão por contrato', d: 'Receba comissões em cada locação ativada na plataforma.' },
          { icon: Trophy, t: 'Plano de carreira', d: 'Evolua nos níveis bronze, prata, ouro e diamante conforme produção.' },
          { icon: BarChart3, t: 'Histórico de consultas', d: 'Acompanhe todas as suas consultas e propostas em um só lugar.' },
          { icon: ShieldCheck, t: 'Contratos ativos', d: 'Visualize o status, vigência e dados de cada contrato vinculado a você.' },
          { icon: Receipt, t: 'Painel financeiro', d: 'Acompanhe comissões pagas, em aberto e previstas com transparência.' },
          { icon: Share2, t: 'Indicações', d: 'Indique outros corretores e clientes e amplie seus ganhos.' },
          { icon: Headphones, t: 'Suporte especializado', d: 'Conte com atendimento ágil para tirar dúvidas e acelerar análises.' },
        ],
      }}
      destaque={{
        titulo: 'Comissões e plano de carreira',
        descricao: 'Sua produção é acompanhada de forma individual. Quanto mais contratos ativos, maiores os níveis e as comissões.',
        cards: [
          { icon: TrendingUp, t: 'Níveis Bronze a Diamante', d: 'Evolua nos níveis conforme sua produção mensal e tenha mais benefícios.' },
          { icon: Wallet, t: 'Comissão progressiva', d: 'Sua comissão acompanha sua evolução e o volume de contratos ativos.' },
          { icon: Sparkles, t: 'Bonificações e ativação', d: 'Bonificações conforme metas, com taxa de ativação considerada na comissão quando aplicável.' },
        ],
      }}
      ferramentas={{
        titulo: 'Tudo no painel do corretor',
        subtitulo: 'Acesse seu painel para gerenciar consultas, contratos, comissões e indicações.',
        cards: [
          { icon: FileSearch, t: 'Nova consulta', items: ['Análise rápida', 'Dados do imóvel', 'Dados do inquilino', 'Status em tempo real'] },
          { icon: ListChecks, t: 'Minhas consultas', items: ['Histórico completo', 'Status', 'Documentos enviados', 'Reabrir propostas'] },
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['Vigência', 'Imóvel', 'Plano contratado', 'Vinculação'] },
          { icon: Wallet, t: 'Comissões', items: ['Pagas', 'Em aberto', 'Previstas', 'Histórico'] },
          { icon: Share2, t: 'Indicação', items: ['Indicar corretor', 'Indicar cliente', 'Acompanhar status'] },
          { icon: UserCircle2, t: 'Perfil', items: ['Dados pessoais', 'Dados bancários', 'Documentos', 'Nível atual'] },
        ],
      }}
      faq={[
        { q: 'Como ganho comissão?', a: 'Cada contrato ativado pela sua consulta gera comissão, acompanhada pelo painel financeiro.' },
        { q: 'Como acompanho minhas consultas?', a: 'Pelo menu "Minhas consultas" você visualiza histórico, status e documentos de cada proposta.' },
        { q: 'Como funciona o plano de carreira?', a: 'Existem níveis bronze, prata, ouro e diamante, definidos conforme produção mensal e contratos ativos.' },
        { q: 'Posso indicar clientes?', a: 'Sim. Pela área de indicação você indica clientes e corretores e acompanha o status.' },
        { q: 'Como envio documentos?', a: 'Os documentos são anexados durante a consulta ou diretamente no contrato pelo painel.' },
      ]}
      ctaFinal={{
        titulo: 'Comece a vender garantia locatícia com a NOX',
        subtitulo: 'Crie sua conta de corretor e tenha aprovação rápida, comissões transparentes e plano de carreira.',
        ctas: [
          { label: 'Criar conta de corretor', to: '/cadastro', search: { perfil: 'corretor' }, variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
