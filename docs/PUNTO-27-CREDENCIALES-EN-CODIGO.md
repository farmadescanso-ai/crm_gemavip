# Punto 27: Credenciales de BD en comentarios del código

**Auditoría:** Análisis CRM Gemavip  
**Problema:** URLs de phpMyAdmin o credenciales en comentarios exponen el panel de administración de BD si el repo se hace público o hay acceso no autorizado.

---

## Solución

**No incluir en el código fuente:**

- URLs de phpMyAdmin, Easypanel u otros paneles de administración
- Hosts, puertos o nombres de BD de producción
- Contraseñas, API keys o tokens

**Usar en su lugar:**

- Variables de entorno (`.env`, Vercel Environment Variables)
- `.env.example` con placeholders, sin valores reales
- Documentación externa (wiki, 1Password, etc.) para URLs de administración

---

## Estado actual

Los archivos `config/mysql-crm.js` y `config/mysql-crm-comisiones.js` usan `process.env.DB_*` para la configuración. No hay URLs sensibles en comentarios.

---

## Checklist para nuevos desarrolladores

- [ ] `.env` está en `.gitignore` y no se commitea
- [ ] No añadir URLs de phpMyAdmin ni paneles en comentarios
- [ ] Credenciales solo en variables de entorno
