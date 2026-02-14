# Roles: Comercial y Administrador

La aplicación distingue dos roles a efectos de permisos en la interfaz web y en la API.

## Cómo se determina el rol

- El rol se obtiene del usuario en sesión (`req.session.user`), que se rellena en el **login** desde la base de datos (tabla `comerciales`, campo `Roll`).
- `Roll` puede ser un JSON array (ej. `["Admin"]` o `["Comercial"]`), una cadena separada por comas, o un valor único.
- Se considera **Administrador** si en `user.roles` (o el valor normalizado de `Roll`) hay algún elemento que contenga la palabra `"admin"` (sin importar mayúsculas/minúsculas).
- Cualquier otro usuario se trata como **Comercial** (incluido cuando no tiene roles o el array está vacío).

## Administrador

- **Dashboard:** Ve totales globales (clientes, pedidos, visitas, comerciales). Ve los 10 clientes con más facturación y los 10 últimos pedidos de toda la base.
- **Clientes:** Ve y gestiona todos los clientes (sin filtrar por comercial).
- **Pedidos:** Ve y gestiona todos los pedidos. Puede asignar cualquier comercial. Puede editar pedidos en estado distinto de "Pendiente" (salvo "Pagado", que no es editable). Puede borrar pedidos.
- **Visitas:** Ve todas las visitas.
- **Artículos:** CRUD completo (crear, editar, borrar).
- **Comerciales:** Acceso a la lista y gestión de comerciales (solo administradores).
- **API Docs:** Solo administradores pueden acceder a `/api/docs`.

## Comercial

- **Dashboard:** Ve solo sus totales (sus clientes, sus pedidos, sus visitas). Ve sus últimos clientes y últimos pedidos.
- **Clientes:** Solo ve y gestiona los clientes asignados a su `Id_Cial` (o equivalente).
- **Pedidos:** Solo ve y puede crear/editar/borrar sus propios pedidos (donde `Id_Cial` / comercial coincide con su id). Solo puede editar pedidos en estado **"Pendiente"**.
- **Visitas:** Solo ve sus visitas (filtro por comercial).
- **Artículos:** Solo lectura (lista y ficha). No puede crear, editar ni borrar artículos.
- **Comerciales / API Docs:** Sin acceso.

## Resumen de rutas protegidas por rol

| Recurso        | Comercial              | Administrador   |
|----------------|------------------------|-----------------|
| `/comerciales` | ❌ 403                 | ✅              |
| `/api/docs`    | ❌ 403                 | ✅              |
| `/articulos/new`, edit, delete | ❌ 403 | ✅              |
| Pedidos de otros | ❌ 404 (no encontrado) | ✅              |
| Clientes de otros | No visibles (filtro)  | Todos           |
| Visitas de otros | No visibles (filtro)  | Todas           |

## Implementación técnica

- **Auth compartido:** `lib/auth.js` exporta `isAdminUser(user)`, `requireLogin`, `normalizeRoles`, `getCommonNavLinksForRoles`, `getRoleNavLinksForRoles` y `createLoadPedidoAndCheckOwner('id')`.
- **Web:** Las rutas usan `requireLogin` y, donde aplica, `requireAdmin` o el middleware `loadPedidoAndCheckOwner` (que comprueba que el pedido sea del usuario o que sea admin).
- **API REST:** Los routers en `routes/api/` usan `isAdminUser(req.session?.user)` y `assertPedidoAccess` (en pedidos) para acotar resultados y devolver 403/404 según el rol.
