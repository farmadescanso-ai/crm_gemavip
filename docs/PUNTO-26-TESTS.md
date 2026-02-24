# Punto 26: Sin tests automatizados

**Auditoría:** Análisis CRM Gemavip  
**Problema:** No había suite de tests. Cualquier cambio podía romper funcionalidad sin detectarse.

---

## Solución aplicada

### Framework

- **Jest** — tests unitarios e integración
- **Supertest** — tests HTTP de endpoints

### Tests incluidos

| Archivo | Qué prueba |
|---------|------------|
| `tests/lib/utils.test.js` | `toNum`, `escapeHtml` (lib/utils) |
| `tests/lib/pagination.test.js` | `parsePagination` (lib/pagination) |
| `tests/health.test.js` | GET /health (smoke test) |

### Ejecución

```bash
npm test
npm run test:watch   # modo watch para desarrollo
```

### Cobertura

Los tests de `lib/` no requieren BD. El test de `/health` carga la app completa; si falla al cargar (ej. sin `.env`), se omiten con `describe.skip`.

### Ampliación

Para añadir tests:

1. **Unitarios:** lógica pura en `lib/`, helpers, etc.
2. **API:** `supertest` contra rutas en `routes/api/`.
3. **Integración:** con BD de test (`.env.test`).
