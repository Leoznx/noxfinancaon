export interface RequisitosSenha {
  minLength: boolean;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
}

/** Regra compartilhada para cadastro, recuperação e troca de senha. */
export function checarRequisitosSenha(senha: string): RequisitosSenha {
  return {
    minLength: senha.length >= 12 && senha.length <= 128,
    hasLowercase: /[a-z]/.test(senha),
    hasUppercase: /[A-Z]/.test(senha),
    hasNumber: /[0-9]/.test(senha),
  };
}

export function senhaAtendeRequisitos(senha: string): boolean {
  const r = checarRequisitosSenha(senha);
  return r.minLength && r.hasLowercase && r.hasUppercase && r.hasNumber;
}
