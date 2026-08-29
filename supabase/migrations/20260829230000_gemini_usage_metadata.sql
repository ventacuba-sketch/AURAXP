-- Costo real por Scan: guarda el `usageMetadata` crudo que devuelve
-- Gemini junto al resultado (promptTokenCount/candidatesTokenCount/
-- totalTokenCount, y el desglose de tokens de video si Gemini lo manda) --
-- necesario para medir costo real con usuarios reales en vez de estimarlo
-- a ciegas (ver auditoría de escala). Se llena solo desde process-scan
-- (service_role) -- mismo criterio que gemini_raw/stats/etc: nace NULL,
-- nadie del lado del cliente puede escribirla (no está en el GRANT
-- INSERT/UPDATE de `scans` para `authenticated`, ver init_schema.sql).
-- NULL en un scan duplicado (dedupe por hash) es correcto: ese scan en
-- particular no volvió a llamar a Gemini, así que no tiene costo nuevo
-- que registrar.

alter table scans add column gemini_usage_metadata jsonb;
