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
      { title: 'Corretores | Venda mais com garantia locatÃ­cia | NOX FianÃ§a' },
      { name: 'description', content: 'Simule garantias, envie propostas, acompanhe contratos e receba comissÃµes em uma plataforma feita para corretores.' },
      { property: 'og:title', content: 'Corretores | Venda mais com garantia locatÃ­cia | NOX FianÃ§a' },
      { property: 'og:description', content: 'Simule garantias, envie propostas, acompanhe contratos e receba comissÃµes em uma plataforma feita para corretores.' },
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
        titulo: 'Venda mais locaÃ§Ãµes com a NOX FianÃ§a',
        subtitulo: 'Simule garantias, envie propostas, acompanhe contratos e receba comissÃµes em uma plataforma feita para corretores.',
        imagem: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1400&auto=format&fit=crop',
        imagemAlt: 'Corretor atendendo cliente em escritÃ³rio imobiliÃ¡rio',
        personagemImagem: '/assets/nox-corretor-personagens-chave-crop.webp',
        personagemAlt: 'Personagens NOX FianÃ§a, corretora e corretor, apresentando o app com casa e chaves',
        ctas: [
          { label: 'Criar conta de corretor', to: '/cadastro-corretor', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
        chips: ['AprovaÃ§Ã£o rÃ¡pida', 'ComissÃ£o por contrato', 'Plano de carreira'],
      }}
      comoFunciona={{
        titulo: 'Como funciona para corretores',
        passos: [
          { icon: FileSearch, t: 'Simule a fianÃ§a', d: 'Inicie uma consulta com os dados do inquilino e do imÃ³vel em poucos minutos.' },
          { icon: FileUp, t: 'Envie os documentos', d: 'Anexe contrato, vistoria e documentos exigidos diretamente pelo painel.' },
          { icon: ClipboardCheck, t: 'Acompanhe a aprovaÃ§Ã£o', d: 'Veja o status da anÃ¡lise em tempo real, com retorno Ã¡gil sobre a proposta.' },
          { icon: ListChecks, t: 'Escolha o plano', d: 'Defina junto ao cliente o melhor plano de garantia disponÃ­vel para o imÃ³vel.' },
          { icon: FileSignature, t: 'Finalize a proposta', d: 'Conclua a contrataÃ§Ã£o digital, deixe o contrato ativo e pronto para locaÃ§Ã£o.' },
          { icon: Wallet, t: 'Receba sua comissÃ£o', d: 'Acompanhe pagamentos e comissÃµes diretamente pelo painel financeiro.' },
        ],
      }}
      beneficios={{
        titulo: 'BenefÃ­cios para corretores',
        items: [
          { icon: Zap, t: 'Mais agilidade nas locaÃ§Ãµes', d: 'Reduza o tempo entre a visita e o fechamento do contrato.' },
          { icon: Wallet, t: 'ComissÃ£o por contrato', d: 'Receba comissÃµes em cada locaÃ§Ã£o ativada na plataforma.' },
          { icon: Trophy, t: 'Plano de carreira', d: 'Evolua nos nÃ­veis bronze, prata, ouro e diamante conforme produÃ§Ã£o.' },
          { icon: BarChart3, t: 'HistÃ³rico de consultas', d: 'Acompanhe todas as suas consultas e propostas em um sÃ³ lugar.' },
          { icon: ShieldCheck, t: 'Contratos ativos', d: 'Visualize o status, vigÃªncia e dados de cada contrato vinculado a vocÃª.' },
          { icon: Receipt, t: 'Painel financeiro', d: 'Acompanhe comissÃµes pagas, em aberto e previstas com transparÃªncia.' },
          { icon: Share2, t: 'IndicaÃ§Ãµes', d: 'Indique outros corretores e clientes e amplie seus ganhos.' },
          { icon: Headphones, t: 'Suporte especializado', d: 'Conte com atendimento Ã¡gil para tirar dÃºvidas e acelerar anÃ¡lises.' },
        ],
      }}
      destaque={{
        titulo: 'ComissÃµes e plano de carreira',
        descricao: 'Sua produÃ§Ã£o Ã© acompanhada de forma individual. Quanto mais contratos ativos, maiores os nÃ­veis e as comissÃµes.',
        cards: [
          { icon: TrendingUp, t: 'NÃ­veis Bronze a Diamante', d: 'Evolua nos nÃ­veis conforme sua produÃ§Ã£o mensal e tenha mais benefÃ­cios.' },
          { icon: Wallet, t: 'ComissÃ£o progressiva', d: 'Sua comissÃ£o acompanha sua evoluÃ§Ã£o e o volume de contratos ativos.' },
          { icon: Sparkles, t: 'BonificaÃ§Ãµes e ativaÃ§Ã£o', d: 'BonificaÃ§Ãµes conforme metas, com taxa de ativaÃ§Ã£o considerada na comissÃ£o quando aplicÃ¡vel.' },
        ],
      }}
      ferramentas={{
        titulo: 'Tudo no painel do corretor',
        subtitulo: 'Acesse seu painel para gerenciar consultas, contratos, comissÃµes e indicaÃ§Ãµes.',
        cards: [
          { icon: FileSearch, t: 'Nova consulta', items: ['AnÃ¡lise rÃ¡pida', 'Dados do imÃ³vel', 'Dados do inquilino', 'Status em tempo real'] },
          { icon: ListChecks, t: 'Minhas consultas', items: ['HistÃ³rico completo', 'Status', 'Documentos enviados', 'Reabrir propostas'] },
          { icon: ShieldCheck, t: 'Contratos ativos', items: ['VigÃªncia', 'ImÃ³vel', 'Plano contratado', 'VinculaÃ§Ã£o'] },
          { icon: Wallet, t: 'ComissÃµes', items: ['Pagas', 'Em aberto', 'Previstas', 'HistÃ³rico'] },
          { icon: Share2, t: 'IndicaÃ§Ã£o', items: ['Indicar corretor', 'Indicar cliente', 'Acompanhar status'] },
          { icon: UserCircle2, t: 'Perfil', items: ['Dados pessoais', 'Dados bancÃ¡rios', 'Documentos', 'NÃ­vel atual'] },
        ],
      }}
      faq={[
        { q: 'Como ganho comissÃ£o?', a: 'Cada contrato ativado pela sua consulta gera comissÃ£o, acompanhada pelo painel financeiro.' },
        { q: 'Como acompanho minhas consultas?', a: 'Pelo menu "Minhas consultas" vocÃª visualiza histÃ³rico, status e documentos de cada proposta.' },
        { q: 'Como funciona o plano de carreira?', a: 'Existem nÃ­veis bronze, prata, ouro e diamante, definidos conforme produÃ§Ã£o mensal e contratos ativos.' },
        { q: 'Posso indicar clientes?', a: 'Sim. Pela Ã¡rea de indicaÃ§Ã£o vocÃª indica clientes e corretores e acompanha o status.' },
        { q: 'Como envio documentos?', a: 'Os documentos sÃ£o anexados durante a consulta ou diretamente no contrato pelo painel.' },
      ]}
      ctaFinal={{
        titulo: 'Comece a vender garantia locatÃ­cia com a NOX',
        subtitulo: 'Crie sua conta de corretor e tenha aprovaÃ§Ã£o rÃ¡pida, comissÃµes transparentes e plano de carreira.',
        ctas: [
          { label: 'Criar conta de corretor', to: '/cadastro-corretor', variant: 'primary' },
          { label: 'Entrar no painel', to: '/login', variant: 'secondary' },
        ],
      }}
    />
  );
}
