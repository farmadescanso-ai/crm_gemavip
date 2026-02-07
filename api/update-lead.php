<?php
/**
 * Endpoint para actualizar un lead
 * POST /api/update-lead.php
 * 
 * Parámetros:
 * - action: 'update' o 'update_estado'
 * - lead_id: ID del lead
 * - estado: Nuevo estado (para update_estado)
 * - nombre, email, telefono, empresa, mensaje: Campos a actualizar (para update)
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

// Solo aceptar POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse([
        'success' => false,
        'message' => 'Método no permitido. Use POST.'
    ], 405);
}

try {
    $action = isset($_POST['action']) ? $_POST['action'] : 'update';
    $leadId = isset($_POST['lead_id']) ? intval($_POST['lead_id']) : 0;
    
    if ($leadId <= 0) {
        jsonResponse([
            'success' => false,
            'message' => 'ID de lead no válido'
        ], 400);
    }
    
    $db = Database::getInstance();
    
    // Verificar que el lead existe
    $lead = $db->fetchOne(
        "SELECT Id FROM clientes WHERE Id = ? LIMIT 1",
        [$leadId]
    );
    
    if (!$lead) {
        jsonResponse([
            'success' => false,
            'message' => 'Lead no encontrado'
        ], 404);
    }
    
    if ($action === 'update_estado') {
        // Actualizar solo el estado
        $nuevoEstado = isset($_POST['estado']) ? sanitize($_POST['estado']) : '';
        
        if (empty($nuevoEstado)) {
            jsonResponse([
                'success' => false,
                'message' => 'Estado no válido'
            ], 400);
        }
        
        $db->query(
            "UPDATE clientes SET Estado = ?, FechaActualizacion = NOW() WHERE Id = ?",
            [$nuevoEstado, $leadId]
        );
        
        jsonResponse([
            'success' => true,
            'message' => 'Estado actualizado correctamente',
            'lead_id' => $leadId,
            'nuevo_estado' => $nuevoEstado
        ]);
        
    } else {
        // Actualizar todos los campos
        $nombre = isset($_POST['nombre']) ? sanitize($_POST['nombre']) : null;
        $email = isset($_POST['email']) ? filter_var($_POST['email'], FILTER_SANITIZE_EMAIL) : null;
        $telefono = isset($_POST['telefono']) ? sanitize($_POST['telefono']) : null;
        $empresa = isset($_POST['empresa']) ? sanitize($_POST['empresa']) : null;
        $mensaje = isset($_POST['mensaje']) ? sanitize($_POST['mensaje']) : null;
        $estado = isset($_POST['estado']) ? sanitize($_POST['estado']) : null;
        
        // Validar campos requeridos
        if (empty($nombre) || empty($email)) {
            jsonResponse([
                'success' => false,
                'message' => 'Nombre y email son requeridos'
            ], 400);
        }
        
        // Validar email
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            jsonResponse([
                'success' => false,
                'message' => 'Email no válido'
            ], 400);
        }
        
        // Verificar si el email ya existe en otro lead
        $existing = $db->fetchOne(
            "SELECT Id FROM clientes WHERE (LOWER(Email) = LOWER(?) OR LOWER(email) = LOWER(?)) AND Id != ? LIMIT 1",
            [$email, $email, $leadId]
        );
        
        if ($existing) {
            jsonResponse([
                'success' => false,
                'message' => 'Ya existe otro lead con este email'
            ], 409);
        }
        
        // Construir consulta UPDATE dinámica
        $updates = [];
        $params = [];
        
        if ($nombre !== null) {
            $updates[] = "Nombre = ?";
            $params[] = $nombre;
        }
        if ($email !== null) {
            $updates[] = "Email = ?";
            $params[] = $email;
        }
        if ($telefono !== null) {
            $updates[] = "Telefono = ?";
            $params[] = $telefono;
        }
        if ($empresa !== null) {
            $updates[] = "Empresa = ?";
            $params[] = $empresa;
        }
        if ($mensaje !== null) {
            $updates[] = "Mensaje = ?";
            $params[] = $mensaje;
        }
        if ($estado !== null) {
            $updates[] = "Estado = ?";
            $params[] = $estado;
        }
        
        $updates[] = "FechaActualizacion = NOW()";
        $params[] = $leadId;
        
        $sql = "UPDATE clientes SET " . implode(", ", $updates) . " WHERE Id = ?";
        
        $db->query($sql, $params);
        
        // Obtener lead actualizado
        $leadActualizado = $db->fetchOne(
            "SELECT * FROM clientes WHERE Id = ? LIMIT 1",
            [$leadId]
        );
        
        jsonResponse([
            'success' => true,
            'message' => 'Lead actualizado correctamente',
            'lead' => $leadActualizado
        ]);
    }
    
} catch (PDOException $e) {
    error_log("Error actualizando lead: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error al actualizar el lead. Por favor, intente más tarde.'
    ], 500);
    
} catch (Exception $e) {
    error_log("Error inesperado: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error inesperado. Por favor, contacte al administrador.'
    ], 500);
}

