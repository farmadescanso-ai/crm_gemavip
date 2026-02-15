-- Tabla de tramos de descuento para pedidos (DTO sobre Subtotal)
-- Regla de evaluación propuesta:
-- - importe_desde: inclusivo (>=)
-- - importe_hasta: exclusivo (<). Si es NULL, no tiene límite superior.
--
-- Ejemplo: [150, 300) => 5% ; [300, 500) => 7.5% ; [500, +inf) => 10%

CREATE TABLE IF NOT EXISTS `descuentos_pedido` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `importe_desde` DECIMAL(10,2) NOT NULL,
  `importe_hasta` DECIMAL(10,2) NULL,
  `dto_pct` DECIMAL(5,2) NOT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  `orden` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_desc_pedido_importes` CHECK (`importe_hasta` IS NULL OR `importe_hasta` > `importe_desde`),
  CONSTRAINT `chk_desc_pedido_dto` CHECK (`dto_pct` >= 0 AND `dto_pct` <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX `idx_desc_pedido_activo_orden` ON `descuentos_pedido` (`activo`, `orden`, `importe_desde`);

-- Seed inicial (opcional). Si ya tienes datos, NO ejecutes este bloque.
-- INSERT INTO `descuentos_pedido` (`importe_desde`, `importe_hasta`, `dto_pct`, `activo`, `orden`) VALUES
-- (150.00, 300.00, 5.00, 1, 10),
-- (300.00, 500.00, 7.50, 1, 20),
-- (500.00, NULL, 10.00, 1, 30);

