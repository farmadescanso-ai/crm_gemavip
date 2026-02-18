-- Diagnóstico rápido de integridad para la tabla `clientes` y relaciones típicas.
-- Ejecuta estas queries en la BD para detectar valores huérfanos o faltantes.

-- 1) Clientes con CodigoPostal informado pero Id_CodigoPostal vacío
SELECT COUNT(*) AS clientes_con_cp_sin_id_cp
FROM clientes
WHERE TRIM(COALESCE(CodigoPostal,'')) <> ''
  AND (Id_CodigoPostal IS NULL OR Id_CodigoPostal = 0);

-- 2) Clientes con Id_CodigoPostal que no existe en codigos_postales
SELECT COUNT(*) AS clientes_id_cp_huerfano
FROM clientes c
LEFT JOIN codigos_postales cp ON cp.id = c.Id_CodigoPostal
WHERE c.Id_CodigoPostal IS NOT NULL
  AND c.Id_CodigoPostal <> 0
  AND cp.id IS NULL;

-- 3) Clientes con Id_Provincia huérfano
SELECT COUNT(*) AS clientes_id_provincia_huerfano
FROM clientes c
LEFT JOIN provincias p ON p.id = c.Id_Provincia
WHERE c.Id_Provincia IS NOT NULL
  AND c.Id_Provincia <> 0
  AND p.id IS NULL;

-- 4) Clientes con Id_Pais huérfano
SELECT COUNT(*) AS clientes_id_pais_huerfano
FROM clientes c
LEFT JOIN paises pa ON pa.id = c.Id_Pais
WHERE c.Id_Pais IS NOT NULL
  AND c.Id_Pais <> 0
  AND pa.id IS NULL;

-- 5) Clientes con Id_EstdoCliente huérfano (estado cliente)
SELECT COUNT(*) AS clientes_estado_huerfano
FROM clientes c
LEFT JOIN estdoClientes e ON e.id = c.Id_EstdoCliente
WHERE c.Id_EstdoCliente IS NOT NULL
  AND c.Id_EstdoCliente <> 0
  AND e.id IS NULL;

-- 6) Clientes con Delegado (Id_Cial) huérfano
SELECT COUNT(*) AS clientes_delegado_huerfano
FROM clientes c
LEFT JOIN comerciales co ON co.id = c.Id_Cial
WHERE c.Id_Cial IS NOT NULL
  AND c.Id_Cial <> 0
  AND co.id IS NULL;

-- 7) Catálogos típicos (si existen en tu BD)
-- Tipos de cliente
SELECT COUNT(*) AS clientes_tipo_cliente_huerfano
FROM clientes c
LEFT JOIN tipos_clientes tc ON tc.id = c.Id_TipoCliente
WHERE c.Id_TipoCliente IS NOT NULL
  AND c.Id_TipoCliente <> 0
  AND tc.id IS NULL;

-- Formas de pago
SELECT COUNT(*) AS clientes_forma_pago_huerfano
FROM clientes c
LEFT JOIN formas_pago fp ON fp.id = c.Id_FormaPago
WHERE c.Id_FormaPago IS NOT NULL
  AND c.Id_FormaPago <> 0
  AND fp.id IS NULL;

-- Idiomas
SELECT COUNT(*) AS clientes_idioma_huerfano
FROM clientes c
LEFT JOIN idiomas i ON i.id = c.Id_Idioma
WHERE c.Id_Idioma IS NOT NULL
  AND c.Id_Idioma <> 0
  AND i.id IS NULL;

-- Monedas
SELECT COUNT(*) AS clientes_moneda_huerfano
FROM clientes c
LEFT JOIN monedas m ON m.id = c.Id_Moneda
WHERE c.Id_Moneda IS NOT NULL
  AND c.Id_Moneda <> 0
  AND m.id IS NULL;

