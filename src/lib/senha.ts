export interface RequisitosSenha {
  minLength: boolean;
  hasLetter: boolean;
  hasNumber: boolean;
}

/** Mesma regra já usada no cadastro (min 8, pelo menos uma letra e um número). */
export function checarRequisitosSenha(senha: string): RequisitosSenha {
  return {
    minLength: senha.trim().length >= 8,
    hasLetter: /[a-zA-Z]/.test(senha),
    hasNumber: /[0-9]/.test(senha),
  };
}

export function senhaAtendeRequisitos(senha: string): boolean {
  const r = checarRequisitosSenha(senha);
  return r.minLength && r.hasLetter && r.hasNumber;
}
