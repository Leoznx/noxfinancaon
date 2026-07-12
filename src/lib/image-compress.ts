// Client-only: redimensiona e recomprime uma foto (ex.: câmera do celular, que
// facilmente passa de 5-10MB) antes de mandar como base64 pro servidor —
// mantém o payload da signup server function pequeno o suficiente pra não
// esbarrar em limite de tamanho de corpo de requisição.
const MAX_DIMENSION = 1440;
const JPEG_QUALITY = 0.75;

export interface CompressedImage {
  base64: string;
  mimeType: "image/jpeg";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a imagem."));
    };
    img.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // remove o prefixo "data:image/jpeg;base64,"
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Não foi possível processar a imagem."));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageToBase64(file: File): Promise<CompressedImage> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Não foi possível processar a imagem.");

  const base64 = await blobToBase64(blob);
  return { base64, mimeType: "image/jpeg" };
}
