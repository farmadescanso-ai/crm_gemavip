// Configuración de Swagger/OpenAPI para documentación de la API
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Farmadescaso CRM API',
      version: '1.0.0',
      description: 'API REST para el sistema CRM de Farmadescaso',
      contact: {
        name: 'Farmadescaso 2021 SL',
        email: 'info@farmadescaso.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api',
        description: 'Servidor de desarrollo'
      },
      {
        url: 'https://api.farmadescaso.com/api',
        description: 'Servidor de producción'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API Key para autenticación. Obtén tu API key desde /api/keys/generate'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'string',
              example: 'Error message'
            },
            message: {
              type: 'string',
              example: 'Detailed error message'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              example: 'Operation successful'
            }
          }
        },
        Articulo: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            SKU: { type: 'string', example: '216959' },
            Nombre: { type: 'string', example: 'Aceite De Ducha Atopic 500 Ml' },
            Presentacion: { type: 'string', example: '500 ml.' },
            Unidades_Caja: { type: 'integer', example: 12 },
            PVL: { type: 'number', format: 'decimal', example: 8.00 },
            IVA: { type: 'number', format: 'decimal', example: 21.00 },
            Imagen: { type: 'string', format: 'uri' },
            Id_Marca: { type: 'integer', nullable: true },
            EAN13: { type: 'integer', example: 5600885285148 },
            Activo: { type: 'boolean', example: true }
          }
        },
        Cliente: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            Nombre_Razon_Social: { type: 'string' },
            DNI_CIF: { type: 'string', nullable: true },
            Direccion: { type: 'string', nullable: true },
            Poblacion: { type: 'string', nullable: true },
            CodigoPostal: { type: 'string', nullable: true },
            Telefono: { type: 'string', nullable: true },
            Email: { type: 'string', nullable: true },
            OK_KO: { type: 'integer', example: 1 }
          }
        },
        Pedido: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            NumPedido: { type: 'string' },
            FechaPedido: { type: 'string', format: 'date' },
            Cliente_id: { type: 'integer' },
            ComercialId: { type: 'integer' },
            Total: { type: 'number', format: 'decimal' },
            Estado: { type: 'string' }
          }
        },
        Visita: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            TipoVisita: { type: 'string' },
            Fecha: { type: 'string', format: 'date' },
            Hora: { type: 'string' },
            ClienteId: { type: 'integer', nullable: true },
            ComercialId: { type: 'integer' },
            Estado: { type: 'string' }
          }
        },
        Comercial: {
          type: 'object',
          properties: {
            Id: { type: 'integer' },
            Nombre: { type: 'string' },
            Email: { type: 'string' },
            DNI: { type: 'string', nullable: true },
            Movil: { type: 'string', nullable: true },
            Roll: { type: 'string' }
          }
        },
        Cooperativa: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            Nombre: { type: 'string' },
            Email: { type: 'string' },
            Telefono: { type: 'string', nullable: true },
            Contacto: { type: 'string', nullable: true }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  },
  apis: [path.join(__dirname, '..', 'routes', 'api', '**', '*.js')]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

