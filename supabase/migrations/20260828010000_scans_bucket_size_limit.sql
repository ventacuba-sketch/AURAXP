-- ============================================================
-- Límite de tamaño explícito para el bucket "scans"
-- ============================================================
-- El bucket se creó sin file_size_limit propio (ver init_schema.sql), así
-- que cada subida caía al límite global del proyecto (Dashboard > Storage
-- > Settings).
--
-- 50 MB acá NO es un límite de producto de AURAXP -- es el hard cap real
-- del plan Supabase Free (máximo por archivo). Un clip de 5-8s grabado en
-- 4K/60fps/HDR puede superar esto fácilmente sin que el usuario haya hecho
-- nada mal; el cliente (src/utils/uploadLimits.ts) valida contra este
-- mismo número y muestra un mensaje que dice explícitamente "versión de
-- prueba", no una regla permanente.
--
-- Al pasar a Supabase Pro (u otro plan con más margen), subir este valor
-- Y el de MAX_UPLOAD_BYTES en src/utils/uploadLimits.ts -- deben quedar en
-- sync. La solución de fondo a futuro es comprimir/descalar el video
-- client-side antes de subirlo (ver compressVideoIfNeeded en
-- src/services/scanService.ts), no seguir subiendo este número.
update storage.buckets
set file_size_limit = 50 * 1024 * 1024 -- 50 MB, en bytes -- hard cap de Supabase Free
where id = 'scans';
