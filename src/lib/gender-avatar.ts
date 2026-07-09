// Detecta gênero pelo primeiro nome pra escolher a foto de perfil padrão de
// novos cadastros (só é usado uma vez, na criação da conta — nunca sobrescreve
// avatar_url já definido). Lista de nomes deliberadamente pequena e específica
// pro público da NOX Fiança; nomes não reconhecidos caem no fallback masculino.

const FEMALE_FIRST_NAMES = new Set([
  "ana", "maria", "larice", "gislaine", "beatriz", "julia", "juliana", "mariana",
  "amanda", "camila", "fernanda", "gabriela", "rafaela", "simone", "cintia",
  "geovania", "gervania", "antonella", "eduarda", "larissa", "bruna", "leticia",
  "isabela", "isabella", "laura", "sophia", "sofia", "helena", "alice",
  "valentina", "luiza", "manuela", "yasmin", "giovanna", "vitoria",
]);

const MALE_FIRST_NAMES = new Set([
  "gabriel", "elian", "vinicius", "carlos", "joao", "leonardo", "vitor",
  "josue", "jeziel", "adair", "pedro", "lucas", "rafael", "raffa", "gustavo",
  "matheus", "mateus", "felipe", "bruno", "daniel", "eduardo", "fernando",
  "henrique", "miguel", "arthur", "davi", "enzo", "theo", "heitor", "bernardo",
  "samuel", "nicolas", "guilherme", "ricardo", "rodrigo", "marcelo", "andre",
]);

export const DEFAULT_AVATARS = {
  female: "/avatars/default-female.png",
  male: "/avatars/default-male.png",
} as const;

function firstNameNormalized(fullName: string | null | undefined): string {
  return (fullName ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() ?? "";
}

export function detectGenderFromName(fullName: string | null | undefined): "female" | "male" {
  const first = firstNameNormalized(fullName);
  if (FEMALE_FIRST_NAMES.has(first)) return "female";
  if (MALE_FIRST_NAMES.has(first)) return "male";
  return "male"; // fallback — nenhuma lista bateu
}

export function defaultAvatarForName(fullName: string | null | undefined): string {
  return DEFAULT_AVATARS[detectGenderFromName(fullName)];
}
