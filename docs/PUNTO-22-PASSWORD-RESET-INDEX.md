# Punto 22: Índice en password_reset_tokens (comercial_id, used)

**Auditoría:** Análisis CRM Gemavip  
**Problema:** La tabla `password_reset_tokens` no tenía índice en `(comercial_id, used)`, usado en consultas como `WHERE comercial_id = ? AND used = 0`.

---

## Solución

Añadir índice compuesto para optimizar:

- `invalidateTokensByComercialId` — `UPDATE ... WHERE comercial_id = ? AND used = 0`
- Consultas de rate limiting por comercial

---

## Script de migración

```bash
# BD con columnas originales (comercial_id)
mysql -u usuario -p nombre_bd < scripts/add-index-password-reset-tokens.sql
```

**Script:** `scripts/add-index-password-reset-tokens.sql`

Si la BD está migrada (`pwdres_com_id`), comenta la primera línea y descomenta la alternativa.

---

## Instalaciones nuevas

El script `crear-tabla-password-reset-tokens.sql` ya incluye el índice en el `CREATE TABLE`.
