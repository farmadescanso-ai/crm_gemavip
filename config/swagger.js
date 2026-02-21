// Configuración de Swagger/OpenAPI para documentación de la API
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CRM Gemavip API',
      version: '1.0.0',
      description: 'API REST para el CRM comercial de Gemavip.',
      contact: {
        name: 'Gemavip',
        email: 'soporte@gemavip.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: '/api',
        description: 'Misma instancia (relativo al host)'
      },
      {
        url: 'http://localhost:3000/api',
        description: 'Desarrollo local'
      },
      {
        url: 'https://crm-gemavip.vercel.app/api',
        description: 'Producción (Vercel)'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description:
            'API Key para acceso programático (si está configurada en el servidor). En Swagger UI usa "Authorize" y pega tu API key.'
        },
        SessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'crm_session',
          description: 'Cookie de sesión (login web).'
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
          description: 'Artículo. Tras migración: art_id, art_sku, art_nombre, etc.',
          properties: {
            id: { type: 'integer', example: 1, description: 'Alias: art_id' },
            art_id: { type: 'integer', example: 1 },
            SKU: { type: 'string', example: '216959', description: 'Alias: art_sku' },
            art_sku: { type: 'string', example: '216959' },
            Nombre: { type: 'string', example: 'Aceite De Ducha Atopic 500 Ml', description: 'Alias: art_nombre' },
            art_nombre: { type: 'string', example: 'Aceite De Ducha Atopic 500 Ml' },
            Presentacion: { type: 'string', example: '500 ml.' },
            Unidades_Caja: { type: 'integer', example: 12 },
            PVL: { type: 'number', format: 'decimal', example: 8.00 },
            IVA: { type: 'number', format: 'decimal', example: 21.00 },
            Imagen: { type: 'string', format: 'uri' },
            Id_Marca: { type: 'integer', nullable: true, description: 'Alias: art_mar_id' },
            art_mar_id: { type: 'integer', nullable: true },
            EAN13: { type: 'integer', example: 5600885285148 },
            Activo: { type: 'boolean', example: true }
          }
        },
        Cliente: {
          type: 'object',
          description: 'Cliente. Tras migración BD: cli_id, cli_nombre_razon_social, etc. Se mantienen aliases legacy.',
          properties: {
            id: { type: 'integer', description: 'Alias: cli_id' },
            cli_id: { type: 'integer', description: 'PK normalizada' },
            Nombre_Razon_Social: { type: 'string', description: 'Alias: cli_nombre_razon_social' },
            cli_nombre_razon_social: { type: 'string' },
            DNI_CIF: { type: 'string', nullable: true, description: 'Alias: cli_dni_cif' },
            cli_dni_cif: { type: 'string', nullable: true },
            Direccion: { type: 'string', nullable: true },
            cli_direccion: { type: 'string', nullable: true },
            Poblacion: { type: 'string', nullable: true },
            cli_poblacion: { type: 'string', nullable: true },
            CodigoPostal: { type: 'string', nullable: true },
            cli_codigo_postal: { type: 'string', nullable: true },
            Telefono: { type: 'string', nullable: true },
            cli_telefono: { type: 'string', nullable: true },
            Email: { type: 'string', nullable: true },
            cli_email: { type: 'string', nullable: true },
            OK_KO: { type: 'integer', example: 1 },
            cli_ok_ko: { type: 'integer', example: 1 }
          }
        },
        Pedido: {
          type: 'object',
          description: 'Pedido. Tras migración: ped_id, ped_numero, ped_cli_id, ped_com_id, etc.',
          properties: {
            id: { type: 'integer', description: 'Alias: ped_id' },
            ped_id: { type: 'integer' },
            NumPedido: { type: 'string', description: 'Alias: ped_numero' },
            ped_numero: { type: 'string' },
            FechaPedido: { type: 'string', format: 'date', description: 'Alias: ped_fecha' },
            ped_fecha: { type: 'string', format: 'date' },
            Cliente_id: { type: 'integer', description: 'Alias: ped_cli_id' },
            ped_cli_id: { type: 'integer' },
            ComercialId: { type: 'integer', description: 'Alias: ped_com_id' },
            ped_com_id: { type: 'integer' },
            Total: { type: 'number', format: 'decimal' },
            ped_total: { type: 'number', format: 'decimal' },
            Estado: { type: 'string' },
            ped_estado_txt: { type: 'string' }
          }
        },
        Visita: {
          type: 'object',
          description: 'Visita. Tras migración: vis_id, vis_tipo, vis_fecha, vis_cli_id, vis_com_id, etc.',
          properties: {
            id: { type: 'integer', description: 'Alias: vis_id' },
            vis_id: { type: 'integer' },
            TipoVisita: { type: 'string', description: 'Alias: vis_tipo' },
            vis_tipo: { type: 'string' },
            Fecha: { type: 'string', format: 'date', description: 'Alias: vis_fecha' },
            vis_fecha: { type: 'string', format: 'date' },
            Hora: { type: 'string' },
            vis_hora: { type: 'string' },
            ClienteId: { type: 'integer', nullable: true, description: 'Alias: vis_cli_id' },
            vis_cli_id: { type: 'integer', nullable: true },
            ComercialId: { type: 'integer', description: 'Alias: vis_com_id' },
            vis_com_id: { type: 'integer' },
            Estado: { type: 'string' },
            vis_estado: { type: 'string' }
          }
        },
        Comercial: {
          type: 'object',
          description: 'Comercial. Tras migración: com_id, com_nombre, com_email, etc.',
          properties: {
            Id: { type: 'integer', description: 'Alias: com_id' },
            com_id: { type: 'integer' },
            Nombre: { type: 'string', description: 'Alias: com_nombre' },
            com_nombre: { type: 'string' },
            Email: { type: 'string', description: 'Alias: com_email' },
            com_email: { type: 'string' },
            DNI: { type: 'string', nullable: true },
            com_dni: { type: 'string', nullable: true },
            Movil: { type: 'string', nullable: true },
            com_movil: { type: 'string', nullable: true },
            Roll: { type: 'string' },
            com_roll: { type: 'string' }
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
  apis: [
    path.join(__dirname, '..', 'routes', 'api', '**', '*.js'),
    // Documentar también endpoints globales como /health
    path.join(__dirname, '..', 'api', 'index.js')
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

