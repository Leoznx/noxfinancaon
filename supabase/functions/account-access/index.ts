import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const publicClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
const verifyRedirect = 'noxfianca://email-verificado';
const resetRedirect = 'noxfianca://redefinir-senha';
const RESEND_MIN_INTERVAL_MS = 60_000;
const RESEND_MAX_PER_HOUR = 5;

const FEMALE_FIRST_NAMES = new Set([
  'ana', 'maria', 'larice', 'gislaine', 'beatriz', 'julia', 'juliana', 'mariana',
  'amanda', 'camila', 'fernanda', 'gabriela', 'rafaela', 'simone', 'cintia',
  'geovania', 'gervania', 'antonella', 'eduarda', 'larissa', 'bruna', 'leticia',
  'isabela', 'isabella', 'laura', 'sophia', 'sofia', 'helena', 'alice',
  'valentina', 'luiza', 'manuela', 'yasmin', 'giovanna', 'vitoria',
]);

const MALE_FIRST_NAMES = new Set([
  'gabriel', 'elian', 'vinicius', 'carlos', 'joao', 'leonardo', 'vitor',
  'josue', 'jeziel', 'adair', 'pedro', 'lucas', 'rafael', 'raffa', 'gustavo',
  'matheus', 'mateus', 'felipe', 'bruno', 'daniel', 'eduardo', 'fernando',
  'henrique', 'miguel', 'arthur', 'davi', 'enzo', 'theo', 'heitor', 'bernardo',
  'samuel', 'nicolas', 'guilherme', 'ricardo', 'rodrigo', 'marcelo', 'andre',
]);

function defaultAvatarForName(fullName: unknown) {
  const firstName = String(fullName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() ?? '';
  const gender = FEMALE_FIRST_NAMES.has(firstName)
    ? 'female'
    : MALE_FIRST_NAMES.has(firstName)
      ? 'male'
      : 'male';
  return `/avatars/default-${gender}.png`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { action, payload } = await request.json();
    if (action === 'list-signup-agencies') return json(await listSignupAgencies());
    if (action === 'signup') return json(await signup(payload));
    if (action === 'password-reset') {
      await passwordReset(String(payload?.email ?? ''));
      return json({ ok: true });
    }
    if (action === 'resend-verification') {
      await resendVerification(String(payload?.email ?? ''));
      return json({ ok: true });
    }
    return json({ ok: false, error: 'dados_invalidos' }, 400);
  } catch (error) {
    console.error('[account-access]', error);
    return json({ ok: false, error: 'erro' }, 500);
  }
});

async function listSignupAgencies() {
  const { data, error } = await admin
    .from('imobiliarias')
    .select('id, razao_social')
    .order('razao_social', { ascending: true });

  if (error) throw error;

  return {
    ok: true,
    agencies: (data ?? []).map((agency: { id: string; razao_social: string }) => ({
      id: agency.id,
      razaoSocial: agency.razao_social,
    })),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function signup(input: any) {
  const role = String(input?.role ?? '');
  const email = String(input?.email ?? '').trim().toLowerCase();
  const senha = String(input?.senha ?? '');
  const telefone = String(input?.telefone ?? '');
  if (!validSignupInput(input, role, email, senha, telefone)) {
    return { ok: false, error: 'dados_invalidos' };
  }

  const { data: existing } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existing) return { ok: false, error: 'ja_existe' };

  const nome = role === 'imobiliaria' ? String(input.razaoSocial ?? '') : String(input.nome ?? '');
  const metadata: Record<string, unknown> = { nome, role, telefone };
  if (role === 'inquilino') metadata.cpf = digits(input.cpf);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'signup',
    email,
    password: senha,
    options: { data: metadata, redirectTo: verifyRedirect },
  });
  if (linkError || !linkData.user) {
    return { ok: false, error: /already.*registered/i.test(linkError?.message ?? '') ? 'ja_existe' : 'erro' };
  }

  const userId = linkData.user.id;
  const status = role === 'inquilino' ? 'ativo' : 'pendente_aprovacao';
  await admin.from('profiles').update({ nome, telefone, role, status }).eq('id', userId);

  // Mesmo padrão do site: usa o primeiro nome da pessoa e nunca substitui uma
  // foto que já tenha sido definida. Para imobiliária, considera o responsável.
  const avatarName = role === 'imobiliaria' ? input.responsavelNome : nome;
  await admin
    .from('profiles')
    .update({ avatar_url: defaultAvatarForName(avatarName) })
    .eq('id', userId)
    .is('avatar_url', null);

  let linkedConsultas = 0;
  if (role === 'inquilino') {
    const cpf = digits(input.cpf);
    const { data: byCpf } = await admin.from('inquilinos').select('id, profile_id').eq('cpf', cpf).maybeSingle();
    if (byCpf?.profile_id && byCpf.profile_id !== userId) {
      await admin.auth.admin.deleteUser(userId);
      return { ok: false, error: 'ja_existe' };
    }
    await admin.from('inquilinos').upsert({ profile_id: userId, nome, cpf, tipo: 'PF' }, { onConflict: 'cpf' });
    const { data: consultas } = await admin.from('consultas_credito').update({ tenant_user_id: userId }).eq('tenant_document', cpf).is('tenant_user_id', null).select('id');
    const ids = (consultas ?? []).map((item: any) => item.id);
    linkedConsultas = ids.length;
    if (ids.length) {
      await admin.from('faturas_inquilino').update({ tenant_user_id: userId }).in('consulta_id', ids);
      await admin.from('documentos_proposta').update({ tenant_user_id: userId }).in('consulta_id', ids);
    }
  } else if (role === 'imobiliaria') {
    await admin.from('imobiliarias').insert({
      razao_social: input.razaoSocial,
      nome_fantasia: input.nomeFantasia || null,
      cnpj: input.cnpj,
      creci: input.creciJuridico,
      cargo: input.cargo || null,
      cidade: input.cidade,
      estado: input.estado,
      contato_nome: input.responsavelNome,
      contato_email: email,
      contato_telefone: telefone,
    });
  } else if (role === 'corretor') {
    await admin.from('corretores').insert({
      profile_id: userId,
      cpf: input.cpf,
      creci: input.creci,
      cidade: input.cidade,
      estado: input.estado,
      vinculado_imobiliaria: Boolean(input.vinculadoImobiliaria),
      imobiliaria_id: input.imobiliariaId || null,
    });
  } else {
    await admin.from('proprietarios').insert({ profile_id: userId, nome, cpf_cnpj: input.cpfCnpj, email, telefone });
  }

  await sendTemplateOrFallback('verification', email, nome, linkData.properties.action_link);
  return { ok: true, userId, linkedConsultas };
}

async function passwordReset(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return;
  try {
    const { data: profile } = await admin.from('profiles').select('nome').ilike('email', email).maybeSingle();
    if (!profile) return;
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: resetRedirect } });
    if (error || !data.properties.action_link) return;
    await sendTemplateOrFallback('reset', email, profile.nome || 'cliente', data.properties.action_link);
  } catch (error) {
    console.error('[account-access] password-reset', error);
  }
}

async function resendVerification(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return;
  try {
    const { data: profile } = await admin.from('profiles').select('id, nome').ilike('email', email).maybeSingle();
    if (!profile) return;
    const { data: userResult } = await admin.auth.admin.getUserById(profile.id);
    if (!userResult.user || userResult.user.email_confirmed_at) return;

    const now = Date.now();
    const { data: recentSends } = await admin
      .from('email_verification_sends')
      .select('sent_at')
      .eq('email', email)
      .gte('sent_at', new Date(now - 60 * 60 * 1000).toISOString());
    const sends = (recentSends ?? []) as { sent_at: string }[];
    const sentTooRecently = sends.some(
      (send) => now - new Date(send.sent_at).getTime() < RESEND_MIN_INTERVAL_MS,
    );
    if (sentTooRecently || sends.length >= RESEND_MAX_PER_HOUR) return;

    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: verifyRedirect } });
    if (error || !data.properties.action_link) return;
    const sent = await sendTemplateOrFallback(
      'verification',
      email,
      profile.nome || 'cliente',
      data.properties.action_link,
    );
    if (sent) {
      await admin.from('email_verification_sends').insert({ email });
    }
  } catch (error) {
    console.error('[account-access] resend-verification', error);
  }
}

async function sendTemplateOrFallback(
  type: 'verification' | 'reset',
  email: string,
  nome: string,
  link: string,
): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  const templateId = Deno.env.get(type === 'verification' ? 'RESEND_VERIFY_TEMPLATE_ID' : 'RESEND_RESET_PASSWORD_TEMPLATE_ID');
  if (apiKey && from && templateId) {
    const variables = type === 'verification' ? { nome, verification_link: link } : { nome, reset_link: link };
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: type === 'verification' ? 'Verifique seu e-mail | NOX Fiança' : 'Redefina sua senha | NOX Fiança',
        reply_to: Deno.env.get('RESEND_REPLY_TO') || undefined,
        template: { id: templateId, variables },
      }),
    });
    if (response.ok) return true;
    console.error('[account-access] Resend', await response.text());
  }
  if (type === 'verification') {
    const { error } = await publicClient.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: verifyRedirect },
    });
    return !error;
  }
  const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo: resetRedirect });
  return !error;
}

function digits(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

function validSignupInput(input: any, role: string, email: string, senha: string, telefone: string) {
  if (!['imobiliaria', 'corretor', 'proprietario', 'inquilino'].includes(role)) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return false;
  if (digits(telefone).length < 10) return false;
  if (role === 'imobiliaria') {
    return String(input.razaoSocial ?? '').trim().length >= 3 && digits(input.cnpj).length === 14 && String(input.creciJuridico ?? '').trim().length >= 4 && String(input.responsavelNome ?? '').trim().length >= 3;
  }
  if (role === 'corretor') {
    return String(input.nome ?? '').trim().length >= 3 && digits(input.cpf).length === 11 && String(input.creci ?? '').trim().length >= 4 && String(input.cidade ?? '').trim().length >= 2 && String(input.estado ?? '').length === 2 && (!input.vinculadoImobiliaria || Boolean(input.imobiliariaId));
  }
  if (role === 'proprietario') {
    const documentLength = digits(input.cpfCnpj).length;
    return String(input.nome ?? '').trim().length >= 3 && [11, 14].includes(documentLength) && String(input.cidade ?? '').trim().length >= 2 && String(input.estado ?? '').length === 2;
  }
  return String(input.nome ?? '').trim().length >= 3 && digits(input.cpf).length === 11;
}
