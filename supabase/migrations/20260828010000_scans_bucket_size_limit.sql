-- ============================================================
-- Límite de tamaño explícito para el bucket "scans"
-- ============================================================
-- El bucket se creó sin file_size_limit propio (ver init_schema.sql), así
-- que cada subida caía al límite global del proyecto (Dashboard > Storage
-- > Settings), pensado para cualquier tipo de archivo y no calibrado para
-- el flujo real de AURAXP (clips de hasta 8 segundos grabados con la
-- cámara del teléfono).
--
-- 60 MB cubre con margen los formatos de grabación estándar de un
-- teléfono moderno en 8 segundos:
--   - 4K/60fps H.264 o HEVC (el modo más pesado de uso normal): ~25 MB
--   - 1080p slow-motion (240fps):                                ~23 MB
-- y dobla ese peor caso realista para dar margen sin abrir la puerta a
-- modos de captura fuera de alcance para esta app (ProRes, 8K), que
-- pueden pesar cientos de MB para un clip de 8 segundos.
update storage.buckets
set file_size_limit = 60 * 1024 * 1024 -- 60 MB, en bytes
where id = 'scans';
