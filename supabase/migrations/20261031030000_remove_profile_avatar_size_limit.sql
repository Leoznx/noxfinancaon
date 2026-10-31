-- Fotos de perfil não possuem um limite de tamanho específico da aplicação.
-- O projeto continua aceitando somente os formatos de imagem cadastrados no
-- bucket privado e sujeito apenas aos limites operacionais da infraestrutura.
UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE id = 'anexos';
