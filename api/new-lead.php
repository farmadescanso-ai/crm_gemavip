<?php
/**
 * Endpoint para crear nuevos leads
 * POST /api/new-lead.php
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Manejar preflight OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Solo aceptar POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse([
        'success' => false,
        'message' => 'Método no permitido. Use POST.'
    ], 405);
}

try {
    // Obtener datos del POST
    $input = json_decode(file_get_contents('php://input'), true);
    
    // Si no hay JSON, intentar obtener de $_POST
    if (!$input) {
        $input = $_POST;
    }
    
    // Validar campos requeridos
    $required = ['nombre', 'email', 'telefono'];
    $missing = [];
    
    foreach ($required as $field) {
        if (empty($input[$field])) {
            $missing[] = $field;
        }
    }
    
    if (!empty($missing)) {
        jsonResponse([
            'success' => false,
            'message' => 'Faltan campos requeridos: ' . implode(', ', $missing)
        ], 400);
    }
    
    // Sanitizar datos
    $nombre = sanitize($input['nombre']);
    $email = filter_var($input['email'], FILTER_SANITIZE_EMAIL);
    $telefono = sanitize($input['telefono']);
    $empresa = isset($input['empresa']) ? sanitize($input['empresa']) : null;
    $mensaje = isset($input['mensaje']) ? sanitize($input['mensaje']) : null;
    $origen = isset($input['origen']) ? sanitize($input['origen']) : 'web';
    
    // Validar email
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        jsonResponse([
            'success' => false,
            'message' => 'Email no válido'
        ], 400);
    }
    
    $db = Database::getInstance();
    
    // Verificar si ya existe un lead con este email
    $existing = $db->fetchOne(
        "SELECT Id FROM clientes WHERE LOWER(Email) = LOWER(?) OR LOWER(email) = LOWER(?) LIMIT 1",
        [$email, $email]
    );
    
    if ($existing) {
        jsonResponse([
            'success' => false,
            'message' => 'Ya existe un cliente con este email',
            'client_id' => $existing['Id']
        ], 409);
    }
    
    // Crear nuevo lead/cliente
    $sql = "INSERT INTO clientes (Nombre, Email, Telefono, Empresa, Mensaje, Origen, FechaCreacion, Estado) 
            VALUES (?, ?, ?, ?, ?, ?, NOW(), 'nuevo')";
    
    $db->query($sql, [
        $nombre,
        $email,
        $telefono,
        $empresa,
        $mensaje,
        $origen
    ]);
    
    $leadId = $db->lastInsertId();
    
    // Log de actividad (opcional)
    error_log("Nuevo lead creado: ID={$leadId}, Email={$email}, Nombre={$nombre}");
    
    jsonResponse([
        'success' => true,
        'message' => 'Lead creado exitosamente',
        'lead_id' => $leadId,
        'data' => [
            'id' => $leadId,
            'nombre' => $nombre,
            'email' => $email,
            'telefono' => $telefono,
            'empresa' => $empresa,
            'origen' => $origen
        ]
    ], 201);
    
} catch (PDOException $e) {
    error_log("Error creando lead: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error al crear el lead. Por favor, intente más tarde.'
    ], 500);
    
} catch (Exception $e) {
    error_log("Error inesperado: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error inesperado. Por favor, contacte al administrador.'
    ], 500);
}

