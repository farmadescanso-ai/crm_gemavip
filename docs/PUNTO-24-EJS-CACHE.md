# Punto 24: EJS sin caché en producción

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Express no activa el caché de vistas en producción automáticamente con EJS. Cada render re-lee el archivo del disco.

---

## Solución aplicada

En `api/index.js`:

```javascript
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view cache', process.env.NODE_ENV === 'production');
```

- **Desarrollo:** `view cache` = false → las vistas se recompilan en cada request (útil para ver cambios sin reiniciar).
- **Producción:** `view cache` = true → las vistas compiladas se cachean en memoria, evitando lecturas de disco repetidas.
