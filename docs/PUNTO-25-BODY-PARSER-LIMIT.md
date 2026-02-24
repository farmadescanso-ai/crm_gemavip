# Punto 25: Body parser sin límite en rutas API públicas

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Un límite de 2MB permite ataques de denegación de servicio (DoS) enviando cuerpos grandes en login, registro y otras rutas públicas.

---

## Solución aplicada

En `api/index.js`:

```javascript
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
```

- **JSON:** 50kb es suficiente para login, API REST (clientes, pedidos, visitas, etc.).
- **URL-encoded:** 50kb para formularios HTML (login, registro-visitas, CRUD).

---

## Rutas que necesitan más

Si en el futuro se añade una ruta de **upload de Excel** u otro payload grande:

```javascript
router.post('/api/upload', express.json({ limit: '5mb' }), handler);
// o con multer para multipart
```

Por ahora no existe tal ruta; los Excel se generan en servidor.
