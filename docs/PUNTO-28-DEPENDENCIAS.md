# Punto 28: Dependencias desactualizadas o innecesarias

**Auditoría:** Análisis CRM Gemavip  
**Problema:** Algunos paquetes npm son innecesarios o tienen licencias restrictivas.

---

## Estado actual

El `package.json` actual **no incluye** los paquetes problemáticos citados:

| Paquete | Problema | Estado |
|---------|----------|--------|
| `crypto` | Módulo nativo de Node.js; el npm `crypto` es redundante | ✅ No está en deps. El código usa `require('crypto')` (built-in) |
| `form-data` | axios ya incluye manejo de FormData | ✅ No está en deps |
| `xlsx` | Licencia AGPL-3.0 desde v0.17+ | ✅ No está en deps. Se usa **exceljs** (MIT) |

---

## Recomendaciones

1. **No instalar** el paquete npm `crypto`; usar siempre `require('crypto')` (Node built-in).
2. **Excel:** Mantener **exceljs**; evitar `xlsx` por AGPL-3.0 en uso comercial.
3. **FormData:** Si se necesita con axios, usar el FormData nativo del navegador o `form-data` solo si es imprescindible.
4. **Auditoría periódica:** `npm audit` y revisar dependencias obsoletas con `npm outdated`.
