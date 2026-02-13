-- =============================================================================
-- 1) Copiar tarifa MIRAFARMA al PVL de artículos (una sola sentencia)
--    Actualiza articulos.PVL con el precio que tiene cada artículo en MIRAFARMA.
-- =============================================================================

UPDATE articulos a
INNER JOIN tarifasClientes_precios t
  ON t.Id_Articulo = a.id
INNER JOIN tarifasClientes tf
  ON tf.Id = t.Id_Tarifa
  AND UPPER(TRIM(tf.NombreTarifa)) = 'MIRAFARMA'
SET a.PVL = t.Precio;


-- =============================================================================
-- 2) Tarifa Transfer con todos los precios a 0
--    Asegura que la tarifa 'Transfer' exista en tarifasClientes y que cada
--    artículo tenga en tarifasClientes_precios un precio 0 para esa tarifa.
--    Ajusta nombres de columnas (Id/id, NombreTarifa/Nombre, etc.) si tu BD difiere.
-- =============================================================================

-- 2.1) Crear tarifa Transfer si no existe (opcional; la app también puede crearla)
INSERT IGNORE INTO tarifasClientes (NombreTarifa, Activa)
SELECT 'Transfer', 1
WHERE NOT EXISTS (SELECT 1 FROM tarifasClientes WHERE UPPER(TRIM(NombreTarifa)) = 'TRANSFER');

-- 2.2) Insertar precio 0 para cada artículo en la tarifa Transfer (o actualizar si ya existe).
--      Requiere que tarifasClientes_precios tenga UNIQUE(Id_Tarifa, Id_Articulo) para ON DUPLICATE KEY.
INSERT INTO tarifasClientes_precios (Id_Tarifa, Id_Articulo, Precio)
SELECT tf.Id, a.id, 0
FROM tarifasClientes tf
CROSS JOIN articulos a
WHERE UPPER(TRIM(tf.NombreTarifa)) = 'TRANSFER'
ON DUPLICATE KEY UPDATE Precio = 0;

-- Si no tienes UNIQUE(Id_Tarifa, Id_Articulo), ejecuta en su lugar:
-- DELETE t FROM tarifasClientes_precios t
-- INNER JOIN tarifasClientes tf ON tf.Id = t.Id_Tarifa AND UPPER(TRIM(tf.NombreTarifa)) = 'TRANSFER';
-- INSERT INTO tarifasClientes_precios (Id_Tarifa, Id_Articulo, Precio)
-- SELECT tf.Id, a.id, 0 FROM tarifasClientes tf CROSS JOIN articulos a WHERE UPPER(TRIM(tf.NombreTarifa)) = 'TRANSFER';
