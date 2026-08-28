/**
 * Límite de tamaño de archivo para subir un scan.
 *
 * IMPORTANTE: esto NO es un límite de producto de AURAXP. Es una
 * restricción temporal del plan actual de Supabase (Free = 50MB por
 * archivo, hard cap del proveedor). Un usuario grabando 5-8s en 4K/60fps/
 * HDR puede superar 50MB fácilmente sin haber hecho nada mal -- por eso
 * el mensaje que se muestra habla de "la versión de prueba", no de una
 * regla permanente de la app.
 *
 * Al pasar el proyecto a Supabase Pro (u otro plan con un límite mayor),
 * subir este número Y actualizar el file_size_limit del bucket "scans" en
 * Supabase (ver supabase/migrations/20260828010000_scans_bucket_size_limit.sql)
 * -- deben mantenerse en sync. Centralizado acá para que ese cambio sea de
 * una sola línea, sin tocar el resto del flujo de subida.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Free: 50MB/archivo
