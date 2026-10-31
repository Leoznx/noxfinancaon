import { supabase } from "@/integrations/supabase/client";
import { defaultAvatarForName } from "@/lib/gender-avatar";

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isSystemDefaultAvatar(avatarUrl: string | null | undefined) {
  return !avatarUrl || avatarUrl.includes("/avatars/default-");
}

export async function uploadAdminProfileAvatar(targetUserId: string, file: File) {
  const contentType = file.type.toLowerCase();
  const extension = MIME_TO_EXTENSION[contentType];
  if (!extension) {
    throw new Error("Formato inválido. Envie um JPG, PNG ou WEBP.");
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Sessão expirada. Entre novamente para atualizar a foto.");
  }

  const path = `${authData.user.id}/admin-avatares/${targetUserId}-${Date.now()}.${extension}`;
  const bucket = supabase.storage.from("anexos");
  const { error: uploadError } = await bucket.upload(path, file, {
    upsert: false,
    contentType,
    cacheControl: "31536000",
  });
  if (uploadError) throw uploadError;

  const { data: signed, error: signError } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signError || !signed?.signedUrl) {
    await bucket.remove([path]);
    throw signError ?? new Error("Não foi possível gerar o acesso seguro da foto.");
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: signed.signedUrl })
    .eq("id", targetUserId);
  if (updateError) {
    await bucket.remove([path]);
    throw updateError;
  }

  return signed.signedUrl;
}

export async function restoreAdminProfileAvatar(
  targetUserId: string,
  fullName: string | null | undefined,
) {
  const avatarUrl = defaultAvatarForName(fullName);
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", targetUserId);
  if (error) throw error;
  return avatarUrl;
}
