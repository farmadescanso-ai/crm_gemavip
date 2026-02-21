# Migración paso a paso - Normalización prefijos BD

Ejecutar en phpMyAdmin en este orden. Tras cada archivo, verificar que no hay errores antes de continuar.

| # | Archivo | Descripción |
|---|---------|-------------|
| 0 | `00-DROP-FKs.sql` | Eliminar FKs (obligatorio antes de renombrar) |
| 1 | `01-provincias.sql` | Catálogo provincias |
| 2 | `02-tipos_clientes.sql` | Catálogo tipos cliente |
| 3 | `03-estdoClientes.sql` | Catálogo estado cliente |
| 4 | `04-marcas.sql` | Catálogo marcas |
| 5 | `05-idiomas.sql` | Catálogo idiomas |
| 6 | `06-monedas.sql` | Catálogo monedas |
| 7 | `07-paises.sql` | Catálogo países |
| 8 | `08-formas_pago.sql` | Catálogo formas de pago |
| 9 | `09-especialidades.sql` | Catálogo especialidades |
| 10 | `10-agenda_roles.sql` | Catálogo agenda roles |
| 11 | `11-agenda_especialidades.sql` | Catálogo agenda especialidades |
| 12 | `12-tiposcargorol.sql` | Catálogo tipo cargo/rol |
| 13 | `13-estados_pedido.sql` | Catálogo estados pedido |
| 14 | `14-descuentos_pedido.sql` | Catálogo descuentos pedido |
| 15 | `15-tipos_pedidos.sql` | Catálogo tipos pedido |
| 16 | `16-cooperativas.sql` | Catálogo cooperativas |
| 17 | `17-comerciales.sql` | Tabla core comerciales |
| 18 | `18-articulos.sql` | Tabla core artículos |
| 19 | `19-tarifasClientes.sql` | Tabla tarifas |
| 20 | `20-tarifasClientes_precios.sql` | Precios por tarifa |
| 21 | `21-agenda.sql` | Tabla agenda |
| 22 | `22-clientes.sql` | Tabla core clientes |
| 23 | `23-clientes_contactos.sql` | Cliente-contacto M:N |
| 24 | `24-direccionesEnvio.sql` | Direcciones envío |
| 25 | `25-pedidos.sql` | Tabla core pedidos |
| 26 | `26-pedidos_articulos.sql` | Líneas pedido |
| 27 | `27-visitas.sql` | Tabla visitas |
| 28 | `28-notificaciones.sql` | Notificaciones |
| 29 | `29-password_reset_tokens.sql` | Tokens reset |
| 30 | `30-variables_sistema.sql` | Variables sistema |
| 31 | `31-ADD-FKs.sql` | Recrear claves foráneas |
